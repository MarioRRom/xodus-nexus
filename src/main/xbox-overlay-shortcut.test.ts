import {afterEach,expect,it,vi} from 'vitest';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {XboxOverlayShortcut,ensureOverlayDesktopEntry} from './xbox-overlay-shortcut.js';
import {xboxOverlaySettings,xboxOverlayShortcut,xboxOverlayPatch} from '../shared/xbox-overlay-settings.js';
import {HyprlandOverlayBinding,hyprlandOverlayAction,hyprlandOverlayBinding} from './xbox-overlay-hyprland.js';
import type {Settings} from '../shared/types.js';
const settings=(patch:Partial<Settings>={})=>({...patch} as Settings);
const directories:string[]=[];
afterEach(async()=>{await Promise.all(directories.splice(0).map(dir=>fs.rm(dir,{recursive:true,force:true})));});
it('defaults to the left edge and Super+G, and validates stored versus requested preferences',()=>{
 expect(xboxOverlaySettings({})).toEqual({overlayEnabled:true,overlaySide:'left',overlayShortcut:'Super+G'});
 expect(xboxOverlaySettings({overlayShortcut:'bad',overlaySide:'right'}).overlayShortcut).toBe('Super+G');
 expect(xboxOverlayShortcut('Shift + Control + G')).toBe('Control+Shift+G');expect(xboxOverlayShortcut('Shift+Tab')).toBe('Shift+Tab');
 for(const value of ['G','Super+G; exec bad','Super+Super+G','Super+','Control+alt+G','Super+G\n'])expect(()=>xboxOverlayShortcut(value)).toThrow();
 expect(()=>xboxOverlayPatch({overlaySide:'top' as 'left'})).toThrow();
});
it('owns registration, rebind and cleanup without desktop-specific code on ordinary Wayland sessions',async()=>{
 const callbacks=new Map<string,()=>void>(),api={register:vi.fn((key:string,cb:()=>void)=>{callbacks.set(key,cb);return true;}),unregister:vi.fn()},toggle=vi.fn(async()=>{}),changed=vi.fn();
 const shortcut=new XboxOverlayShortcut(api,toggle,changed,{environment:{WAYLAND_DISPLAY:'wayland-0'}});
 await shortcut.configure(settings());expect(shortcut.current.state).toBe('requested');callbacks.get('Super+G')!();await Promise.resolve();expect(toggle).toHaveBeenCalledOnce();
 await shortcut.configure(settings({overlaySide:'right'}));expect(api.register).toHaveBeenCalledOnce();
 await shortcut.configure(settings({overlayShortcut:'Control+Shift+G'}));expect(api.unregister).toHaveBeenCalledWith('Super+G');expect(api.register.mock.calls.at(-1)![0]).toBe('Control+Shift+G');
 await shortcut.configure(settings({overlayEnabled:false}));expect(shortcut.current.state).toBe('disabled');expect(api.unregister).toHaveBeenCalledWith('Control+Shift+G');await shortcut.shutdown();
});
it('reports failed registration instead of claiming a usable keybind',async()=>{
 const shortcut=new XboxOverlayShortcut({register:()=>false,unregister:vi.fn()},async()=>{},vi.fn(),{environment:{}});
 await shortcut.configure(settings());expect(shortcut.current.state).toBe('unavailable');await shortcut.shutdown();
});
it('isolates the optional Hyprland adapter and waits for its cleanup before rebinding',async()=>{
 const binding={start:vi.fn(async()=>true),stop:vi.fn(async()=>{})},factory=vi.fn(()=>binding),api={register:vi.fn(()=>true),unregister:vi.fn()};
 const shortcut=new XboxOverlayShortcut(api,async()=>{},vi.fn(),{environment:{WAYLAND_DISPLAY:'wayland-0',HYPRLAND_INSTANCE_SIGNATURE:'fixture'},bindingFactory:factory});
 await shortcut.configure(settings());expect(factory).toHaveBeenCalledWith('Super+G');expect(shortcut.current.state).toBe('registered');await shortcut.shutdown();expect(binding.stop).toHaveBeenCalledOnce();
 expect(hyprlandOverlayAction('org.other:action -> no\norg.xodusgaming.nexus:abc- -> overlay')).toBe('org.xodusgaming.nexus:abc-');
 expect(hyprlandOverlayAction('org.xodusgaming.nexus:a -> one\norg.xodusgaming.nexus:b -> two')).toBeUndefined();
 expect(hyprlandOverlayBinding('Super+G','org.xodusgaming.nexus:abc-')).toContain('hl.dsp.global("org.xodusgaming.nexus:abc-")');
 expect(hyprlandOverlayBinding('Control+Shift+F12','org.xodusgaming.nexus:abc-')).toContain('hl.bind("CTRL + SHIFT + F12"');
 expect(()=>hyprlandOverlayBinding('Super+G','other:action')).toThrow();
});
it('installs a valid hidden portal identity without replacing a user-managed desktop entry',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'nexus-desktop-identity-'));directories.push(root);
 await ensureOverlayDesktopEntry('/opt/Nexus $special.AppImage',root);
 const file=path.join(root,'applications/org.xodusgaming.nexus.desktop'),text=await fs.readFile(file,'utf8');
 expect(text).toContain('NoDisplay=true');expect(text).toContain('X-Nexus-Managed=true');expect(text).toContain('\\$special');
 await fs.writeFile(file,'[Desktop Entry]\nName=User entry\n');await ensureOverlayDesktopEntry('/opt/new.AppImage',root);expect(await fs.readFile(file,'utf8')).toContain('Name=User entry');
});

it('tracks this profile’s new portal action and reuses it without selecting stale actions',async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'nexus-portal-actions-'));directories.push(directory);
 let registered=false;const calls:string[][]=[];
 const fake=async(args:string[])=>{calls.push(args);return args[0]==='globalshortcuts'?'org.xodusgaming.nexus:stale -> old'+(registered?'\norg.xodusgaming.nexus:current-Ctrl+Shift+G -> current':''):args[0]==='binds'?'[]':'ok';};
 const make=()=>{const value=new HyprlandOverlayBinding('Control+Shift+G',{},directory);Object.assign(value,{run:fake});return value;};
 const first=make();await first.prepare();registered=true;expect(await first.start()).toBe(true);await first.stop();
 expect(calls.filter(args=>args[0]==='eval')[0][1]).toContain('hl.dsp.global("org.xodusgaming.nexus:current-Ctrl+Shift+G")');
 const second=make();await second.prepare();expect(await second.start()).toBe(true);await second.stop();
 expect(JSON.parse(await fs.readFile(path.join(directory,'overlay-shortcuts.json'),'utf8'))['Control+Shift+G']).toBe('org.xodusgaming.nexus:current-Ctrl+Shift+G');
});

it('releases the existing shortcut while recording and restores the saved binding on cancel or completion',async()=>{
 const binding={start:vi.fn(async()=>true),stop:vi.fn(async()=>{})},api={register:vi.fn(()=>true),unregister:vi.fn()};
 const shortcut=new XboxOverlayShortcut(api,async()=>{},vi.fn(),{environment:{HYPRLAND_INSTANCE_SIGNATURE:'fixture'},bindingFactory:()=>binding});
 await shortcut.configure(settings());
 await shortcut.record(settings(),true);expect(shortcut.current.state).toBe('recording');expect(binding.stop).toHaveBeenCalledOnce();expect(api.unregister).toHaveBeenCalledWith('Super+G');
 await shortcut.configure(settings({overlaySide:'right'}));expect(api.register).toHaveBeenCalledOnce();
 await shortcut.record(settings(),false);expect(shortcut.current.state).toBe('registered');expect(api.register).toHaveBeenCalledTimes(2);
 await shortcut.record(settings(),true);await shortcut.record(settings({overlayShortcut:'Control+Shift+G'}),false);
 expect(api.register.mock.calls.at(-1)?.[0]).toBe('Control+Shift+G');await shortcut.shutdown();
});
