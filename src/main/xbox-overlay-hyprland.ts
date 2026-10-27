import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {externalLauncherEnvironment} from './launcher-environment.js';
const execute=promisify(execFile);
const identity='org.xodusgaming.nexus';
/** Optional workaround for portal backends which expose actions but ignore preferred_trigger. */
export function hyprlandOverlayAction(output:string):string|undefined{
 const matches=output.split('\n').map(line=>line.split(' -> ')[0]).filter(id=>id.startsWith(identity+':')&&/^[A-Za-z0-9_.:+-]+$/.test(id));
 return matches.length===1?matches[0]:undefined;
}
export function hyprlandOverlayBinding(accelerator:string,action:string):string{
 if(!action.startsWith(identity+':')||!/^[A-Za-z0-9_.:+-]+$/.test(action))throw Error('Invalid overlay shortcut action.');
 const modifiers:Record<string,string>={Super:'SUPER',Control:'CTRL',Alt:'ALT',Shift:'SHIFT'};
 const keys=accelerator.split('+').map(key=>modifiers[key]??key).join(' + ');
 return `if _G.nexus_overlay_shortcut then pcall(function() _G.nexus_overlay_shortcut:remove() end) end; _G.nexus_overlay_shortcut=hl.bind(${JSON.stringify(keys)},hl.dsp.global(${JSON.stringify(action)}),{desc="Nexus Xbox overlay (app managed)"}); _G.nexus_overlay_shortcut_action=${JSON.stringify(action)}; return "bound"`;
}
export class HyprlandOverlayBinding {
 private timer?:ReturnType<typeof setInterval>;
 private stopped=false;
 private busy?:Promise<boolean>;
 private before=new Set<string>();private known:Record<string,string>={};private selected?:string;
 constructor(private readonly accelerator:string,private readonly environment:NodeJS.ProcessEnv=process.env,private readonly profileDirectory?:string){}
 private async run(args:string[]):Promise<string>{return (await execute('hyprctl',args,{env:externalLauncherEnvironment(this.environment),timeout:1500,maxBuffer:300_000})).stdout;}
 private actions(output:string):string[]{return output.split('\n').map(line=>line.split(' -> ')[0]).filter(id=>id.startsWith(identity+':')&&/^[A-Za-z0-9_.:+-]+$/.test(id));}
 async prepare():Promise<void>{
  this.before=new Set(this.actions(await this.run(['globalshortcuts']).catch(()=>'')));
  if(this.profileDirectory)try{
   const text=await fs.readFile(path.join(this.profileDirectory,'overlay-shortcuts.json'),'utf8');if(text.length>65536)return;
   const value=JSON.parse(text);if(value&&typeof value==='object'&&!Array.isArray(value))this.known=Object.fromEntries(Object.entries(value).filter(([key,id])=>key.length<=80&&typeof id==='string'&&id.startsWith(identity+':')&&/^[A-Za-z0-9_.:+-]+$/.test(id)).slice(-32)) as Record<string,string>;
  }catch{}
 }
 async sync():Promise<boolean>{
  if(this.stopped)return false;if(this.busy)return this.busy;
  this.busy=(async()=>{try{
   const actions=this.actions(await this.run(['globalshortcuts'])),fresh=actions.filter(id=>!this.before.has(id));
   const owned=[...new Set(Object.values(this.known))].filter(id=>actions.includes(id));
   const action=this.selected&&actions.includes(this.selected)?this.selected:fresh.length===1?fresh[0]:actions.includes(this.known[this.accelerator])?this.known[this.accelerator]:owned.length===1?owned[0]:actions.length===1?actions[0]:undefined;
   if(!action||this.stopped)return false;
   if(this.selected!==action){
    this.selected=action;this.known=Object.fromEntries(Object.entries({...this.known,[this.accelerator]:action}).slice(-32));
    if(this.profileDirectory){const file=path.join(this.profileDirectory,'overlay-shortcuts.json');await fs.writeFile(file+'.tmp',JSON.stringify(this.known)+'\n',{mode:0o600});await fs.rename(file+'.tmp',file);}
   }
   const binds=JSON.parse(await this.run(['binds','-j']));
   if(!Array.isArray(binds))return false;
   if(!binds.some(b=>b.description==='Nexus Xbox overlay (app managed)'))await this.run(['eval',hyprlandOverlayBinding(this.accelerator,action)]);
   return !this.stopped;
  }catch{return false;}})();try{return await this.busy;}finally{this.busy=undefined;}
 }
 async start():Promise<boolean>{
  let result=false;
  for(let attempt=0;attempt<20&&!this.stopped;attempt++){result=await this.sync();if(result)break;await new Promise(resolve=>setTimeout(resolve,100));}
  this.timer=setInterval(()=>void this.sync(),2500);this.timer.unref();return result;
 }
 async stop():Promise<void>{
  this.stopped=true;clearInterval(this.timer);await this.busy;
  if(!this.selected)return;
  await this.run(['eval',`if _G.nexus_overlay_shortcut and _G.nexus_overlay_shortcut_action==${JSON.stringify(this.selected)} then pcall(function() _G.nexus_overlay_shortcut:remove() end); _G.nexus_overlay_shortcut=nil; _G.nexus_overlay_shortcut_action=nil end`]).catch(()=>{});
 }
}
