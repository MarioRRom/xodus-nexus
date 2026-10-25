import {expect,it,vi} from 'vitest';
import {desktopOverlayOptions,SocialOverlayWindow,type OverlayWindow} from './social-overlay';
it('uses a bounded sandboxed desktop window, not an injected game surface',()=>{
  const options=desktopOverlayOptions({x:-800,y:0,width:800,height:600},'/synthetic/preload.cjs');
  expect(options).toMatchObject({width:800,height:600,x:-800,y:0,alwaysOnTop:true,show:false,frame:false,webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true}});
  expect(options.webPreferences?.preload).toBe('/synthetic/preload.cjs');
});
function fixture(){
  let visible=false,destroyed=false;
  const callbacks:(()=>void)[]=[];
  const window:OverlayWindow={isDestroyed:()=>destroyed,isVisible:()=>visible,show:vi.fn(()=>{visible=true;}),hide:vi.fn(()=>{visible=false;}),focus:vi.fn(),destroy:vi.fn(()=>{destroyed=true;for(const callback of callbacks)callback();}),on:(_event,callback)=>callbacks.push(callback)};
  return window;
}
it('reuses one desktop window and hides it without touching a game',async()=>{
  const window=fixture(),create=vi.fn(async()=>window),hidden=vi.fn();const overlay=new SocialOverlayWindow(create,hidden);
  await overlay.toggle();expect(window.show).toHaveBeenCalledTimes(1);
  await overlay.toggle();expect(window.hide).toHaveBeenCalledOnce();expect(hidden).toHaveBeenCalled();
  await overlay.toggle();expect(create).toHaveBeenCalledOnce();expect(window.show).toHaveBeenCalledTimes(2);
  overlay.dispose();expect(window.destroy).toHaveBeenCalledOnce();
});
it('coalesces simultaneous opens and destroys a late open after shutdown',async()=>{
  const window=fixture();let complete!:(w:OverlayWindow)=>void;
  const create=vi.fn(()=>new Promise<OverlayWindow>(resolve=>{complete=resolve;}));
  const overlay=new SocialOverlayWindow(create,()=>{});const first=overlay.show(),second=overlay.show();
  expect(create).toHaveBeenCalledOnce();overlay.dispose();complete(window);await Promise.all([first,second]);
  expect(window.isDestroyed()).toBe(true);expect(window.show).not.toHaveBeenCalled();
});
it('can retry an unavailable compositor/window without a poisoned pending promise',async()=>{
  const window=fixture(),create=vi.fn().mockRejectedValueOnce(Error('failed')).mockResolvedValue(window);
  const overlay=new SocialOverlayWindow(create,()=>{});await expect(overlay.show()).rejects.toThrow('failed');
  await overlay.show();expect(create).toHaveBeenCalledTimes(2);
});
it('does not reveal a window that was closed while its renderer loaded',async()=>{
  const window=fixture();let complete!:(w:OverlayWindow)=>void;
  const overlay=new SocialOverlayWindow(()=>new Promise(resolve=>{complete=resolve;}),()=>{});
  const opening=overlay.show();overlay.hide();complete(window);await opening;
  expect(window.show).not.toHaveBeenCalled();expect(window.isDestroyed()).toBe(true);
});
it('reopening while loading does not let a stale show destroy the new request',async()=>{
  const window=fixture();let complete!:(w:OverlayWindow)=>void;
  const create=vi.fn(()=>new Promise<OverlayWindow>(resolve=>{complete=resolve;}));
  const overlay=new SocialOverlayWindow(create,()=>{});
  const old=overlay.show();overlay.hide();const current=overlay.show();complete(window);await Promise.all([old,current]);
  expect(window.isDestroyed()).toBe(false);expect(window.isVisible()).toBe(true);expect(create).toHaveBeenCalledOnce();
});
