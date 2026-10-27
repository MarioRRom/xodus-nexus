import {promises as fs} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type {AppSnapshot,Settings} from '../shared/types.js';
import {xboxOverlaySettings} from '../shared/xbox-overlay-settings.js';
import {HyprlandOverlayBinding} from './xbox-overlay-hyprland.js';
const desktopId='org.xodusgaming.nexus.desktop';
type ShortcutApi={register:(key:string,callback:()=>void)=>boolean;unregister:(key:string)=>void};
type Binding={prepare?:()=>Promise<void>;start:()=>Promise<boolean>;stop:()=>Promise<void>};
export async function ensureOverlayDesktopEntry(appImage:string,dataRoot=process.env.XDG_DATA_HOME||path.join(os.homedir(),'.local/share')):Promise<void>{
 if(!path.isAbsolute(appImage)||!path.isAbsolute(dataRoot)||/[\x00-\x1f]/.test(appImage))throw Error('Nexus desktop identity unavailable.');
 const directory=path.join(dataRoot,'applications'),file=path.join(directory,desktopId);
 const previous=await fs.lstat(file).catch((e:NodeJS.ErrnoException)=>{if(e.code!=='ENOENT')throw e;return undefined;});
 if(previous&&(!previous.isFile()||previous.uid!==process.getuid?.()))throw Error('Nexus desktop identity unavailable.');
 if(previous&&!(await fs.readFile(file,'utf8')).includes('X-Nexus-Managed=true'))return;
 const quoted=appImage.replaceAll('\\','\\\\').replaceAll('"','\\"').replaceAll('`','\\`').replaceAll('$','\\$').replaceAll('%','%%');
 await fs.mkdir(directory,{recursive:true});const temporary=file+'.tmp';
 await fs.writeFile(temporary,`[Desktop Entry]\nType=Application\nName=Xodus Nexus\nExec="${quoted}" %U\nNoDisplay=true\nStartupWMClass=org.xodusgaming.nexus\nX-Nexus-Managed=true\n`,{mode:0o600});await fs.rename(temporary,file);
}
export class XboxOverlayShortcut {
 private recording=false;private key?:string;private binding?:Binding;private work=Promise.resolve();private configured?:string;
 current:NonNullable<AppSnapshot['overlayShortcut']>={state:'disabled'};
 private readonly environment:NodeJS.ProcessEnv;
 private readonly bindingFactory:(key:string)=>Binding;
 constructor(private readonly api:ShortcutApi,private readonly toggle:()=>Promise<unknown>,private readonly changed:()=>void,
  options:{environment?:NodeJS.ProcessEnv;bindingFactory?:(key:string)=>Binding;profileDirectory?:string}={}){
  this.environment=options.environment??process.env;
  this.bindingFactory=options.bindingFactory??(key=>new HyprlandOverlayBinding(key,this.environment,options.profileDirectory));
 }
 record(settings:Settings,recording:boolean):Promise<void>{this.recording=recording;return this.configure(settings);}
 configure(settings:Settings):Promise<void>{
  const preference=xboxOverlaySettings(settings),recording=this.recording,id=JSON.stringify([preference.overlayEnabled,preference.overlayShortcut,recording]);
  const operation=this.work.then(async()=>{
   if(this.configured===id)return;await this.clear();this.configured=id;
   if(recording){this.current={state:'recording'};this.changed();return;}
   if(!preference.overlayEnabled){this.current={state:'disabled'};this.changed();return;}
   try{
    if(this.environment.HYPRLAND_INSTANCE_SIGNATURE){this.binding=this.bindingFactory(preference.overlayShortcut);await this.binding.prepare?.();}
    if(!this.api.register(preference.overlayShortcut,()=>{void this.toggle().catch(()=>{});})){throw Error('unavailable');}
    this.key=preference.overlayShortcut;
    this.current={state:this.environment.WAYLAND_DISPLAY?'requested':'registered',backend:this.environment.WAYLAND_DISPLAY?'Desktop portal':'Desktop shortcut'};
    if(this.binding){
     const bound=await this.binding.start();this.current=bound?{state:'registered',backend:'Desktop portal + Hyprland compatibility'}:{state:'requested',backend:'Desktop portal',message:'The desktop has not assigned the shortcut yet. Check shortcut permissions.'};
    }
   }catch{this.current={state:'unavailable',message:'This shortcut could not be registered. Choose another combination or check desktop shortcut permissions.'};}
   this.changed();
  });this.work=operation.catch(()=>{});return operation;
 }
 private async clear():Promise<void>{await this.binding?.stop();this.binding=undefined;if(this.key)this.api.unregister(this.key);this.key=undefined;}
 async shutdown():Promise<void>{await this.work;await this.clear();this.configured=undefined;}
}
