import {promises as fs} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type {AppSnapshot,Settings} from '../shared/types.js';
import {xboxOverlaySettings} from '../shared/xbox-overlay-settings.js';
const desktopId='org.xodusgaming.nexus.desktop';
type ShortcutApi={register:(key:string,callback:()=>void)=>boolean;unregister:(key:string)=>void};
export async function ensureOverlayDesktopEntry(appImage:string,dataRoot=process.env.XDG_DATA_HOME||path.join(os.homedir(),'.local/share')):Promise<void>{
 if(!path.isAbsolute(appImage)||!path.isAbsolute(dataRoot)||/[\x00-\x1f]/.test(appImage))throw Error('Nexus desktop identity unavailable.');
 const directory=path.join(dataRoot,'applications'),file=path.join(directory,desktopId);
 const previous=await fs.lstat(file).catch((e:NodeJS.ErrnoException)=>{if(e.code!=='ENOENT')throw e;return undefined;});
 if(previous&&(!previous.isFile()||previous.uid!==process.getuid?.()))throw Error('Nexus desktop identity unavailable.');
 if(previous&&!(await fs.readFile(file,'utf8')).includes('X-Nexus-Managed=true'))return;
 const quoted=appImage.replaceAll('\\','\\\\').replaceAll('"','\\"').replaceAll('`','\\`').replaceAll('$','\\$').replaceAll('%','%%');
 await fs.mkdir(directory,{recursive:true});const temporary=await fs.mkdtemp(path.join(directory,'.nexus-guide-'));
 try{
  const entry=path.join(temporary,'entry.desktop');
  await fs.writeFile(entry,`[Desktop Entry]\nType=Application\nName=Xodus Nexus\nExec="${quoted}" %U\nNoDisplay=true\nStartupWMClass=org.xodusgaming.nexus\nX-Nexus-Managed=true\n`,{mode:0o600,flag:'wx'});await fs.rename(entry,file);
 }finally{await fs.rm(temporary,{recursive:true,force:true});}
}
export class XboxOverlayShortcut {
 private recording=false;private key?:string;private work=Promise.resolve();private configured?:string;
 private stopped=false;
 current:NonNullable<AppSnapshot['overlayShortcut']>={state:'disabled'};
 private readonly environment:NodeJS.ProcessEnv;
 constructor(private readonly api:ShortcutApi,private readonly toggle:()=>Promise<unknown>,private readonly changed:()=>void,
  private readonly options:{environment?:NodeJS.ProcessEnv;prepare?:()=>Promise<void>}={}){
  this.environment=options.environment??process.env;
  // Desktop configuration belongs to the user. Never run compositor Lua or
  // select another profile's portal action automatically.
 }
 record(settings:Settings,recording:boolean):Promise<void>{this.recording=recording;return this.configure(settings);}
 configure(settings:Settings):Promise<void>{
  const preference=xboxOverlaySettings(settings),recording=this.recording,id=JSON.stringify([preference.overlayEnabled,preference.overlayShortcut,recording]);
  const operation=this.work.then(async()=>{
   if(this.stopped)return;
   if(this.configured===id&&this.current.state!=='unavailable')return;await this.clear();this.configured=id;
   if(recording){this.current={state:'recording'};this.changed();return;}
   if(!preference.overlayEnabled){this.current={state:'disabled'};this.changed();return;}
   try{
    await this.options.prepare?.();
    if(this.stopped)return;
    if(!this.api.register(preference.overlayShortcut,()=>{
      if(this.current.state==='requested'){this.current={state:'registered',backend:'Desktop portal'};this.changed();}
      void this.toggle().catch(()=>{});
    })){throw Error('This shortcut could not be registered. Choose another combination or check desktop shortcut permissions.');}
    this.key=preference.overlayShortcut;
    this.current={state:this.environment.WAYLAND_DISPLAY?'requested':'registered',backend:this.environment.WAYLAND_DISPLAY?'Desktop portal':'Desktop shortcut'};
   }catch(error){this.current={state:'unavailable',message:error instanceof Error?error.message:'This shortcut could not be registered. Choose another combination or check desktop shortcut permissions.'};}
   this.changed();
  });this.work=operation.catch(()=>{});return operation;
 }
 private async clear():Promise<void>{if(this.key)this.api.unregister(this.key);this.key=undefined;}
 async shutdown():Promise<void>{this.stopped=true;await this.work;await this.clear();this.configured=undefined;this.current={state:'disabled'};}
}
