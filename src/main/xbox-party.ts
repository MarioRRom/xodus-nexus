import { EventEmitter } from 'node:events';
import { XboxChatSocket } from './xbox-chat-socket.js';
import { readXboxSocial } from './xbox-native-social.js';
import type { XboxPartyState } from '../shared/types.js';

type Connection={binary:string;account:string};
export type PartyMember={xuid:string;role:string|null};
export type PartyState=XboxPartyState;
type Document={id:string;members:PartyMember[];transportResponse:string|null};
const string=(v:unknown,max:number):v is string=>typeof v==='string'&&v.length>0&&v.length<=max&&!/[\x00-\x1f\x7f]/.test(v);
function document(value:unknown):Document {
  const v=value as Document;
  if(!v || !string(v.id,128) || !Array.isArray(v.members) || v.members.length>128
    || !v.members.every(m=>m&&typeof m.xuid==='string'&&/^[1-9][0-9]{0,19}$/.test(m.xuid)&&(m.role===null||string(m.role,64)))
    || (v.transportResponse!==null && (typeof v.transportResponse!=='string'||v.transportResponse.length>128*1024)))throw Error('Invalid Xbox party response.');
  return {id:v.id,members:v.members.map(({xuid,role})=>({xuid,role})),transportResponse:v.transportResponse};
}

/** Owns only parties explicitly started or joined in this Nexus session. */
export class XboxParty extends EventEmitter {
  private state:PartyState={phase:'idle',members:[]};
  private generation=0;
  private readonly controllers=new Set<AbortController>();
  private account?:string;
  private readonly chat:XboxChatSocket;
  private starting?:Promise<{id:string;answer:unknown}>;
  private leaving?:Promise<void>;
  constructor(private readonly connection:()=>Connection|undefined,private readonly read=readXboxSocial,chat?:XboxChatSocket){
    super();this.chat=chat??new XboxChatSocket(connection);
    this.chat.on('party-changed',event=>{if(event.partyId===this.state.id)void this.refresh().catch(()=>{});});
    this.chat.on('party-removed',()=>{this.clear();this.publish({phase:'error',members:[],error:'You were removed from the Xbox party.'});});
    this.chat.on('disconnected',()=>{
      if(this.state.phase==='connected')this.publish({...this.state,phase:'error',error:'Xbox party notifications disconnected. Leave and reconnect.'});
    });
  }
  get current():PartyState{return structuredClone(this.state);}
  get active():boolean{return this.state.phase==='connecting'||this.state.phase==='connected'||this.state.phase==='leaving';}
  private publish(state:PartyState):void{this.state=state;this.emit('state',this.current);}
  private async rpc(operation:string,fields:Record<string,unknown>={}):Promise<any>{
    const connection=this.connection();if(!connection)throw Error('Sign in to use Xbox voice parties.');
    if(this.account && this.account!==connection.account)throw Error('Xbox account changed. Reconnect your party.');
    const controller=new AbortController();this.controllers.add(controller);
    try{
      const output=await this.read(connection.binary,['party'],JSON.stringify({account:connection.account,operation,...fields}),controller.signal);
      controller.signal.throwIfAborted();
      if(output.length>2*1024*1024 || this.connection()?.account!==connection.account)throw Error('Xbox party account changed or response is invalid.');
      const value=JSON.parse(output);
      if(value.schema!==1 || value.kind!=='party' || value.account!==connection.account || value.operation!==operation)throw Error('Xbox party response has the wrong account or operation.');
      return value.result;
    }finally{this.controllers.delete(controller);}
  }
  async start(offer:string,partyId?:string):Promise<{id:string;answer:unknown}>{
    return this.begin(offer,partyId);
  }
  async accept(offer:string,inviteId:string):Promise<{id:string;answer:unknown}>{
    if((await this.activeParties()).length)throw Error('Leave the Xbox party active on your account before accepting another invitation.');
    return this.begin(offer,undefined,inviteId);
  }
  private async begin(offer:string,partyId?:string,inviteId?:string):Promise<{id:string;answer:unknown}>{
    if(this.active || this.state.id)throw Error('Leave the existing Xbox party before connecting another one.');
    if(typeof offer!=='string' || offer.length>128*1024)throw Error('Invalid party connection offer.');
    const job=this.connect(offer,partyId,inviteId);this.starting=job;
    try{return await job;}finally{if(this.starting===job)this.starting=undefined;}
  }
  private async connect(offer:string,partyId?:string,inviteId?:string):Promise<{id:string;answer:unknown}>{
    const generation=++this.generation;this.account=this.connection()?.account;
    this.publish({phase:'connecting',members:[]});
    try{
      const identity=await this.chat.connect();
      if(generation!==this.generation)throw Error('Party connection cancelled.');
      let result=document(await this.rpc(inviteId?'accept-invite':partyId?'join':'create',{offer,partyId,inviteId,connectionId:identity.connectionId,serverNonce:identity.serverNonce}));
      this.publish({phase:'connecting',id:result.id,selfXuid:identity.xuid,members:result.members});
      if(generation!==this.generation)throw Error('Party connection cancelled.');
      const deadline=Date.now()+30_000;
      while(!result.transportResponse && Date.now()<deadline){
        await new Promise<void>(resolve=>setTimeout(resolve,1000));
        if(generation!==this.generation)throw Error('Party connection cancelled.');
        result=document(await this.rpc('get',{partyId:result.id}));
      }
      if(!result.transportResponse)throw Error('Xbox did not provide a voice relay connection.');
      const answer=JSON.parse(result.transportResponse);
      if(answer.status!=='success' || answer.sdpType!=='answer' || typeof answer.sdp!=='string' || !answer.sdp.startsWith('v=0\r\n')
        || !Array.isArray(answer.iceCandidates) || answer.iceCandidates.length>128)throw Error('Xbox rejected the voice relay connection.');
      this.publish({phase:'connecting',id:result.id,selfXuid:identity.xuid,members:result.members});
      return {id:result.id,answer:{status:answer.status,sdpType:answer.sdpType,sdp:answer.sdp,iceCandidates:answer.iceCandidates}};
    }catch(error){
      if(generation===this.generation){
        const id=this.state.id;
        let retained=id;
        if(id)await this.rpc('leave',{partyId:id}).then(()=>{retained=undefined;},()=>{});
        this.chat.close();this.publish({phase:'error',id:retained,members:[],error:error instanceof Error?error.message:'Xbox party failed to connect.'});
      }
      throw error;
    }
  }
  connected(id:string):void{
    if(this.state.phase!=='connecting'||id!==this.state.id)throw Error('This Xbox party is no longer connecting.');
    this.publish({...this.state,phase:'connected'});
  }
  async refresh():Promise<void>{
    const id=this.state.id;if(!id)return;
    const generation=this.generation;const result=document(await this.rpc('get',{partyId:id}));
    if(generation===this.generation&&result.id===id)this.publish({...this.state,members:result.members});
  }
  async voiceAllowed(xuid:string):Promise<boolean>{
    if(!/^[1-9][0-9]{0,19}$/.test(xuid))throw Error('Invalid Xbox party member.');
    const result=await this.rpc('voice-policy',{xuid});return result?.isAllowed===true;
  }
  async activeParties():Promise<string[]>{
    const result=await this.rpc('active');
    if(!Array.isArray(result?.ids)||result.ids.length>16||!result.ids.every((id:unknown)=>typeof id==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(id)))throw Error('Invalid active Xbox party response.');
    return [...new Set(result.ids)] as string[];
  }
  async leaveExisting(id:string):Promise<void>{
    if(this.active||this.state.id)throw Error('Leave the party in this panel first.');
    if(typeof id!=='string'||!(await this.activeParties()).includes(id))throw Error('That Xbox party is no longer active on this account.');
    await this.rpc('leave',{partyId:id});this.publish({phase:'idle',members:[]});
  }
  async invite(xuid:string):Promise<void>{
    if(this.state.phase!=='connected'||!this.state.id)throw Error('Connect to an Xbox party before inviting a friend.');
    if(!/^[1-9][0-9]{0,19}$/.test(xuid))throw Error('Select an Xbox friend to invite.');
    await this.rpc('invite',{partyId:this.state.id,xuid});
  }
  async leave():Promise<void>{
    if(this.leaving)return this.leaving;
    const job=this.disconnect();this.leaving=job;
    try{await job;}finally{if(this.leaving===job)this.leaving=undefined;}
  }
  private async disconnect():Promise<void>{
    // Let a mutating create return its owned ID before cancelling its follow-up reads.
    this.generation++;await this.starting?.catch(()=>{});
    const id=this.state.id;
    this.publish({...this.state,phase:'leaving'});
    for(const controller of this.controllers)controller.abort();this.controllers.clear();
    try{
      if(id)await this.rpc('leave',{partyId:id});
      this.account=undefined;this.publish({phase:'idle',members:[]});
    }catch(error){
      this.publish({phase:'error',id,members:[],error:'Xbox could not confirm that you left the party. Retry Leave.'});
      throw error;
    }finally{this.chat.close();}
  }
  clear():void{
    this.generation++;for(const controller of this.controllers)controller.abort();this.controllers.clear();
    this.chat.close();this.account=undefined;this.publish({phase:'idle',members:[]});
  }
  suspend():void{
    this.generation++;for(const controller of this.controllers)controller.abort();this.controllers.clear();this.chat.close();
    if(this.state.id)this.publish({...this.state,phase:'error',error:'Xbox account is unavailable. Restore sign-in, then leave or reconnect the party.'});
    else this.publish({phase:'idle',members:[]});
  }
}
