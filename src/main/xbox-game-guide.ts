import {spawn,type ChildProcessWithoutNullStreams} from 'node:child_process';
import {createServer,createConnection,type Server,type Socket} from 'node:net';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import type {XboxProfileRequest} from '../shared/types.js';
import {externalLauncherEnvironment} from './launcher-environment.js';
import {XboxGuideServer,type GuideEvent,type GuideInitial} from './xbox-guide-server.js';

export type GuideMonitor={x:number;y:number;width:number;height:number};
type Options={directory:string;helper:string;account:()=>string|undefined;initial:()=>GuideInitial;invoke:(method:string,args:unknown[])=>Promise<unknown>;problem:(message:string)=>void;monitor:()=>GuideMonitor;enabled:()=>boolean;legacyShortcutOwned?:()=>boolean};
export function gameGuideMonitor(value:GuideMonitor):GuideMonitor{
 if(!value||!['x','y','width','height'].every(key=>Number.isSafeInteger(value[key as keyof GuideMonitor]))||Math.abs(value.x)>131072||Math.abs(value.y)>131072||value.width<=0||value.height<=0||value.width>32768||value.height>32768)throw Error('Nexus Guide monitor unavailable.');
 return {x:value.x,y:value.y,width:value.width,height:value.height};
}

/** A game-session view using standard display bounds. Desktop windows and shared audio have independent lifetimes. */
export class XboxGameGuide {
  private game?:{id:string;title:string};
  private view?:{monitor:GuideMonitor};
  private http?:XboxGuideServer;
  private child?:ChildProcessWithoutNullStreams;
  private opening?:Promise<void>;
  private visible=false;
  private wanted=false;
  private generation=0;
  private checking?:Promise<void>;
  private profile?:XboxProfileRequest;
  private profileClosed?:()=>void;
  private watch?:ReturnType<typeof setInterval>;
  private control?:Server;
  private readonly controlClients=new Set<Socket>();
  private controlPath?:string;
  constructor(private readonly options:Options){}
  get profileRequest():XboxProfileRequest|undefined{return this.profile?{...this.profile}:undefined;}
  get shown():boolean{return this.visible||this.wanted;}
  get bound():boolean{return Boolean(this.game);}
  bind(id:string,title:string):void{
    if(this.game?.id===id)return;
    this.unbind();this.game={id,title};
    void this.refresh();this.watch=setInterval(()=>void this.refresh(),1000);this.watch.unref();

  }
  unbind(id?:string):void{
    if(id&&this.game?.id!==id)return;
    this.game=undefined;this.view=undefined;clearInterval(this.watch);this.watch=undefined;
    this.reset();
  }
  reset():void{
    this.generation++;this.opening=undefined;this.hide(false);this.child?.stdin.end('quit\n');this.child=undefined;
    const server=this.http;this.http=undefined;void server?.stop();
  }
  private async refresh():Promise<void>{
    if(this.checking)return this.checking;if(!this.game)return;
    const bound=this.game;
    const checking=(async()=>{try{
      const next={monitor:gameGuideMonitor(this.options.monitor())};
      if(this.game!==bound)return;
      if(this.http&&this.view&&JSON.stringify(next.monitor)!==JSON.stringify(this.view.monitor))this.reset();
      this.view=next;
    }catch{if(this.shown)this.hide(false);this.view=undefined;}
    })();this.checking=checking;
    try{await checking;}finally{if(this.checking===checking)this.checking=undefined;}
  }
  async toggle():Promise<boolean>{
    if(this.shown){this.hide();return true;}
    if(!this.game||!this.options.enabled())return false;
    await this.refresh();if(!this.view)return false;
    const bound=this.game;
    void this.show().catch(()=>{if(this.game===bound)this.options.problem('Nexus Guide could not open. Reopen the guide and try again.');});
    return true;
  }
  showProfile(id:string,xuid:string,closed:()=>void):void{
    if(this.profile||!this.game||!this.options.enabled())throw Error('Enable the Nexus Guide in Nexus Settings to view game profiles.');
    this.profile={id,xuid};this.profileClosed=closed;this.publish('profile',this.profileRequest);
    void this.show().catch(()=>{if(this.profile?.id===id){this.hide(false);this.options.problem('Nexus Guide could not display the player profile.');}});
  }
  completeProfile(id:string,hide=true):void{
    if(this.profile?.id!==id)return;
    this.profile=undefined;const closed=this.profileClosed;this.profileClosed=undefined;closed?.();this.publish('profile',undefined);
    if(hide)this.hide();
  }
  private async show():Promise<void>{
    if(!this.view)await this.refresh();
    this.wanted=true;
    if(this.opening){await this.opening;if(this.wanted)this.child?.stdin.write('show\n');return;}
    if(this.child){this.child.stdin.write('show\n');return;}
    if(!this.game||!this.view||!this.options.account()){this.wanted=false;throw Error('Nexus Guide game session unavailable.');}
    const generation=this.generation,view=this.view;
    const opening=(async()=>{
      const server=new XboxGuideServer({...this.options,initial:()=>({...this.options.initial(),profile:this.profileRequest}),invoke:async(method,args)=>{
        if(method==='closeXboxGuide'){this.hide();return;}
        if(method==='getXboxProfileRequest')return this.profileRequest;
        if(method==='completeXboxProfileRequest'){
          if(typeof args[0]!=='string'||args[1]!==undefined&&typeof args[1]!=='boolean')throw Error('Invalid player profile request.');
          this.completeProfile(args[0],args[1] as boolean|undefined);return;
        }
        return this.options.invoke(method,args);
      }});this.http=server;
      const url=await server.start();
      if(generation!==this.generation){await server.stop();return;}
      const child=spawn('/usr/bin/python3',[this.options.helper],{env:externalLauncherEnvironment(process.env),stdio:['pipe','pipe','pipe']});this.child=child;
      child.stdin.on('error',()=>{});child.stderr.resume();
      await new Promise<void>((resolve,reject)=>{
        let ready=false,pending='';
        const timer=setTimeout(()=>{reject(Error('Nexus Guide load timed out.'));if(generation===this.generation)this.reset();else child.stdin.end('quit\n');},35_000);timer.unref();
        const failed=()=>{clearTimeout(timer);if(!ready)reject(Error('Nexus Guide host exited.'));if(this.child===child){this.child=undefined;this.hide(false);if(ready&&generation===this.generation)this.options.problem('Nexus Guide closed unexpectedly. Reopen the guide and try again.');}void server.stop();if(this.http===server)this.http=undefined;};
        child.once('error',failed);child.once('exit',failed);
        child.stdout.on('data',bytes=>{
          if(generation!==this.generation||this.child!==child)return;
          pending=(pending+bytes.toString()).slice(-8192);const lines=pending.split('\n');pending=lines.pop()??'';
          for(const line of lines){try{const value=JSON.parse(line);
            if(value.event==='ready'){ready=true;clearTimeout(timer);resolve();}
            if(value.event==='shown'){this.visible=true;if(!this.wanted)child.stdin.write('hide\n');}
            if(value.event==='hidden'){this.visible=false;this.wanted=false;if(this.profile)this.completeProfile(this.profile.id,false);}
            if(value.event==='error'){reject(Error('Nexus Guide host unavailable.'));this.reset();}
          }catch{}}
        });
        child.stdin.write(JSON.stringify({url,token:server.token,monitor:view.monitor})+'\n');
      });
      if(generation===this.generation&&this.wanted)child.stdin.write('show\n');
    })();this.opening=opening;
    try{await opening;}catch(error){if(generation===this.generation)this.reset();throw error;}
    finally{if(this.opening===opening)this.opening=undefined;}
  }
  hide(restore=true):void{
    const was=this.shown;this.wanted=false;this.visible=false;this.child?.stdin.write('hide\n');
    if(this.profile)this.completeProfile(this.profile.id,false);
    // Unmapping returns focus naturally; never raise the game from a desktop shortcut.
    if(restore&&was)void this.refresh();
  }
  publish(event:GuideEvent,value:unknown):void{this.http?.publish(event,value);}
  async startControl(socketPath:string):Promise<void>{
    const stat=await fs.lstat(socketPath).catch(()=>undefined);
    if(stat){
      if(!stat.isSocket()||stat.uid!==process.getuid?.())throw Error('Nexus Guide control socket unavailable.');
      const listening=await new Promise<boolean>(resolve=>{const client=createConnection(socketPath);client.once('connect',()=>{client.destroy();resolve(true);});client.once('error',()=>resolve(false));client.setTimeout(500,()=>{client.destroy();resolve(true);});});
      if(listening)throw Error('Another Nexus owns Nexus Guide.');await fs.unlink(socketPath);
    }
    const server=createServer(socket=>{this.controlClients.add(socket);socket.once('close',()=>this.controlClients.delete(socket));let input='';socket.setTimeout(3000,()=>socket.destroy());socket.on('error',()=>{});socket.on('data',bytes=>{
      input+=bytes.toString();if(input.length>128){socket.destroy();return;}if(!input.includes('\n'))return;
      socket.pause();let request:unknown;try{request=JSON.parse(input.trim());}catch{socket.end('{"handled":false}\n');return;}
      if(JSON.stringify(request)!=='{"command":"toggle"}'){socket.end('{"handled":false}\n');return;}
      // Old desktop scripts must not toggle a second time beside the app-owned shortcut.
      if(this.options.legacyShortcutOwned){socket.end(JSON.stringify({handled:this.options.legacyShortcutOwned()})+'\n');return;}
      void this.toggle().then(handled=>socket.end(JSON.stringify({handled})+'\n'),()=>socket.end('{"handled":true,"error":"Guide unavailable"}\n'));
    });});
    await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(socketPath,()=>{server.removeListener('error',reject);resolve();});});
    await fs.chmod(socketPath,0o600);this.control=server;this.controlPath=socketPath;
  }
  async shutdown():Promise<void>{
    this.unbind();const server=this.control;this.control=undefined;
    for(const client of this.controlClients)client.destroy();this.controlClients.clear();
    if(server)await new Promise<void>(resolve=>server.close(()=>resolve()));
    if(this.controlPath)await fs.unlink(this.controlPath).catch(()=>{});this.controlPath=undefined;
  }
}
