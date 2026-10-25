/** Desktop-owned window only. No hooks, DLL injection or game process changes. */
import type {BrowserWindowConstructorOptions} from 'electron';
export function desktopOverlayOptions(area:{x:number;y:number;width:number;height:number},preload:string):BrowserWindowConstructorOptions{
  const width=Math.min(820,area.width),height=Math.min(620,area.height);
  return {width,height,x:area.x+area.width-width,y:area.y+area.height-height,
    title:'Nexus friends overlay',frame:false,transparent:true,backgroundColor:'#00000000',alwaysOnTop:true,skipTaskbar:true,show:false,
    webPreferences:{preload,contextIsolation:true,nodeIntegration:false,sandbox:true}};
}
export interface OverlayWindow {
  isDestroyed():boolean; isVisible():boolean; show():void; hide():void; focus():void; destroy():void;
  on(event:'closed',listener:()=>void):unknown;
}
export class SocialOverlayWindow {
  private window?:OverlayWindow;
  private opening?:Promise<OverlayWindow>;
  private generation=0;
  private showGeneration=-1;
  constructor(private create:()=>Promise<OverlayWindow>,private hidden:()=>void){}
  async show():Promise<void>{
    const generation=this.generation;
    this.showGeneration=generation;
    let window=this.window;
    if(!window||window.isDestroyed()){
      this.opening??=this.create().finally(()=>{this.opening=undefined;});
      window=await this.opening;
    }
    if(generation!==this.generation){if(this.showGeneration!==this.generation&&!window.isDestroyed())window.destroy();return;}
    const created=window;
    if(this.window!==created){this.window=created;created.on('closed',()=>{if(this.window===created){this.window=undefined;this.hidden();}});}
    window.show();window.focus();
  }
  async toggle():Promise<void>{if(this.window?.isVisible()){this.hide();return;}await this.show();}
  hide():void{this.generation++;if(this.window&&!this.window.isDestroyed())this.window.hide();this.hidden();}
  dispose():void{this.generation++;const window=this.window;this.window=undefined;if(window&&!window.isDestroyed())window.destroy();this.hidden();}
}
