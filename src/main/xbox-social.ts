import { spawnTracked } from './process.js';
import { parseXboxFriends, parseXboxConversation, xboxMessageText, xboxUserId, type SocialRequest, type XboxConversation, type XboxFriend } from '../shared/social.js';

type Identity = { account: string; binary: string };
type Reader = (binary: string, request: SocialRequest, signal: AbortSignal) => Promise<string>;
const failures: Record<string,string> = {
  'privacy-or-access-denied':'Xbox denied this request. Check your account privacy and communication permissions.',
  'sign-in-required':'Xbox requires sign-in again. Open Settings to check your account.',
  'rate-limited':'Xbox is limiting requests. Wait before refreshing again.',
  'not-found':'This conversation is not available from Xbox.',
};
const uiErrors = new Set([...Object.values(failures),
  'Message delivery could not be confirmed. Refresh the conversation before trying again.',
  'Message delivery could not be confirmed. Refresh before trying again.',
  'Xbox social services are unavailable. Try again later.',
  'The account or backend changed. Open Friends again.', 'Invalid Xbox response.',
  'Invalid friends response.', 'Invalid conversation response.',
  'Xbox response does not match the signed-in account.',
]);
async function command(binary: string, request: SocialRequest, signal: AbortSignal): Promise<string> {
  signal.throwIfAborted();
  // Never put message bodies, friends or tokens in command lines or diagnostics.
  const tracked=spawnTracked(binary,['social','--json'],{maxOutput:2*1024*1024,stdoutOnly:true});
  const stop=()=>{tracked.child.kill('SIGKILL');};
  signal.addEventListener('abort',stop,{once:true});if(signal.aborted)stop();
  const timer=setTimeout(stop,65_000);timer.unref();
  let stage='';let stderr='';let oversized=false,outputBytes=0,outputTooLarge=false;
  tracked.child.stdout.on('data',(chunk:Buffer)=>{outputBytes+=chunk.length;if(outputBytes>2*1024*1024){outputTooLarge=true;stop();}});
  tracked.child.stderr?.on('data',(chunk:Buffer)=>{
    if(oversized)return;
    stderr+=chunk.toString('utf8');if(stderr.length>4096){stderr='';oversized=true;return;}
    for(const line of stderr.split('\n').slice(0,-1)){
      const match=/^NEXUS_SOCIAL_ERROR_V1 ([a-z-]+)\r?$/.exec(line);
      if(match&&Object.hasOwn(failures,match[1]))stage=match[1];
    }
    stderr=stderr.slice(stderr.lastIndexOf('\n')+1);
  });
  // Handle a closed child stdin without leaking its raw error into the UI.
  tracked.child.stdin?.on('error',()=>{});
  tracked.child.stdin?.end(JSON.stringify(request));
  try{
    const result=await tracked.result;signal.throwIfAborted();
    if(outputTooLarge)throw Error('Invalid Xbox response.');
    if(result.code!==0)throw Error(request.op==='send'
      ? 'Message delivery could not be confirmed. Refresh the conversation before trying again.'
      : failures[stage]??'Xbox social services are unavailable. Try again later.');
    return result.output;
  }finally{clearTimeout(timer);signal.removeEventListener('abort',stop);stderr='';}
}

/** No startup queries, disk cache, polling, automatic message retries or fake presence. */
export class XboxSocial {
  private jobs=new Map<string,{controller:AbortController;result:Promise<unknown>}>();
  private sending=false;
  private generation=0;
  private draining=new Set<Promise<unknown>>();
  constructor(private identity:()=>Identity|undefined,private reader:Reader=command){}
  close():void{this.generation++;for(const job of this.jobs.values())job.controller.abort();this.jobs.clear();}
  get busy():boolean{return this.draining.size>0;}
  async settled():Promise<void>{await Promise.allSettled([...this.draining]);}
  friends():Promise<XboxFriend[]>{return this.request({op:'friends'},parseXboxFriends);}
  conversation(xuid:unknown):Promise<XboxConversation>{
    if(!xboxUserId(xuid))return Promise.reject(Error('Invalid Xbox user.'));
    return this.request({op:'conversation',xuid},v=>parseXboxConversation(v,xuid));
  }
  async send(xuid:unknown,text:unknown):Promise<void>{
    if(!xboxUserId(xuid)||!xboxMessageText(text))throw Error('Enter a message of up to 256 characters.');
    if(this.sending)throw Error('A message is already being sent.');
    this.sending=true;
    try{await this.request({op:'send',xuid,text},v=>{
      if(!v||typeof v!=='object'||(v as {sent?:unknown}).sent!==true)throw Error('Message delivery could not be confirmed. Refresh before trying again.');
    });}finally{this.sending=false;}
  }
  private request<T>(request:SocialRequest,parse:(v:unknown)=>T):Promise<T>{
    const identity=this.identity();
    if(!identity)return Promise.reject(Error('Sign in and use a backend with Xbox friends and chat support.'));
    const key=JSON.stringify([identity.account,identity.binary,request.op,request.op==='friends'?'':request.xuid]);
    const pending=this.jobs.get(key);if(pending)return pending.result as Promise<T>;
    if(this.jobs.size>=4)return Promise.reject(Error('Wait for the current Xbox requests to finish.'));
    const controller=new AbortController(),generation=this.generation;
    const result=(async()=>{
      try{
        const output=await this.reader(identity.binary,request,controller.signal);
        const current=this.identity();
        if(controller.signal.aborted||generation!==this.generation||current?.account!==identity.account||current.binary!==identity.binary)
          throw Error('The account or backend changed. Open Friends again.');
        if(output.length>2*1024*1024)throw Error('Invalid Xbox response.');
        let value:{schema?:unknown;account?:unknown;result?:unknown};
        try{value=JSON.parse(output);}catch{throw Error('Invalid Xbox response.');}
        if(!value||value.schema!==1||value.account!==identity.account)throw Error('Xbox response does not match the signed-in account.');
        return parse(value.result);
      }catch(error){
        if(controller.signal.aborted)throw Error('Xbox request was cancelled.');
        // A test/transport may throw arbitrary payloads. Only our fixed UI messages escape.
        const message=error instanceof Error?error.message:'';
        if(uiErrors.has(message))throw error;
        throw Error('Xbox social services are unavailable. Try again later.');
      }finally{if(this.jobs.get(key)?.controller===controller)this.jobs.delete(key);}
    })();
    this.draining.add(result);
    void result.then(()=>this.draining.delete(result),()=>this.draining.delete(result));
    this.jobs.set(key,{controller,result});return result;
  }
}
