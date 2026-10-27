import {afterEach,expect,it} from 'vitest';
import {spawn,spawnSync} from 'node:child_process';
import {createServer,type Server} from 'node:net';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {xboxGuideSocketPath,xboxGuideToggleCommand} from './xbox-overlay-hotkey.js';

const servers:Server[]=[],directories:string[]=[];
afterEach(async()=>{await Promise.all(servers.splice(0).map(server=>new Promise<void>(resolve=>server.close(()=>resolve()))));await Promise.all(directories.splice(0).map(directory=>fs.rm(directory,{recursive:true,force:true})));});
const script=path.resolve('assets/overlay/toggle-guide.py');
async function fixture(reply:string|undefined,delay=0,partial?:string){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'nexus-guide-toggle-'));directories.push(directory);
  const socketPath=path.join(directory,'guide.sock'),requests:string[]=[];
  const server=createServer(socket=>{socket.on('error',()=>{});socket.on('data',data=>{requests.push(data.toString());if(partial)socket.write(partial);if(reply!==undefined)setTimeout(()=>{if(!socket.destroyed)socket.end(reply);},delay);else socket.end();});});servers.push(server);
  await new Promise<void>(resolve=>server.listen(socketPath,resolve));await fs.chmod(socketPath,0o600);
  return {socketPath,requests};
}
async function invoke(socketPath:string,timeout=.2){
  const driver=`import importlib.util,json,sys\nspec=importlib.util.spec_from_file_location('guide_toggle',sys.argv[1]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)\ncalled=[]\nm.desktop_overlay=lambda:called.append(True) or 0\noriginal=m.request_toggle\nm.request_toggle=lambda p:original(p,${timeout})\ncode=m.main([sys.argv[2]])\nprint(json.dumps({'exitCode':code,'fallbacks':len(called)}))`;
  const child=spawn('/usr/bin/python3',['-B','-c',driver,script,socketPath],{stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',data=>{output+=data;});child.stderr.resume();
  const code=await new Promise<number|null>((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});expect(code).toBe(0);return JSON.parse(output);
}
it('uses the per-user socket and quotes paths without executing shell expansions',()=>{
  expect(xboxGuideSocketPath({},1000)).toBe('/run/user/1000/xodus-nexus-guide.sock');expect(xboxGuideSocketPath({XDG_RUNTIME_DIR:'/run/custom'},1000)).toBe('/run/custom/xodus-nexus-guide.sock');
  expect(()=>xboxGuideSocketPath({XDG_RUNTIME_DIR:'relative'},1000)).toThrow();
  expect(xboxGuideToggleCommand("/tmp/a' $(touch nope).py",'/run/user/1000/a.sock')).toContain(`a'"'"' $(touch nope).py`);
});
it('uses Nyx native global-shortcut dispatch for the desktop fallback',()=>{
  const driver=`import importlib.util,json,sys,types\nspec=importlib.util.spec_from_file_location('guide_toggle',sys.argv[1]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)\ncalled=[]\nm.subprocess.run=lambda args,**kwargs:called.append(args) or types.SimpleNamespace(returncode=0)\ncode=m.desktop_overlay()\nprint(json.dumps({'exitCode':code,'calls':called}))`;
  const result=spawnSync('/usr/bin/python3',['-B','-c',driver,script],{encoding:'utf8'});
  expect(result.status).toBe(0);expect(JSON.parse(result.stdout)).toEqual({exitCode:0,calls:[['hyprctl','eval','hl.dispatch(hl.dsp.global("quickshell:overlayToggle"))']]});
});
it('sends one toggle and leaves a claimed request entirely with Nexus',async()=>{
  const f=await fixture('{"handled":true}\n');expect(await invoke(f.socketPath)).toEqual({exitCode:0,fallbacks:0});expect(f.requests).toEqual(['{"command":"toggle"}\n']);
});
it('uses the desktop fallback on explicit decline or unavailable socket before sending',async()=>{
  const f=await fixture('{"handled":false}\n');expect(await invoke(f.socketPath)).toEqual({exitCode:0,fallbacks:1});
  expect(await invoke(path.join(path.dirname(f.socketPath),'missing.sock'))).toEqual({exitCode:0,fallbacks:1});
  const stale=path.join(path.dirname(f.socketPath),'stale.sock');
  const bound=spawnSync('/usr/bin/python3',['-B','-c','import os,socket,sys;s=socket.socket(socket.AF_UNIX);s.bind(sys.argv[1]);os.chmod(sys.argv[1],0o600);s.close()',stale]);
  expect(bound.status).toBe(0);expect(await invoke(stale)).toEqual({exitCode:0,fallbacks:1});
});
it('does not double-toggle after errors, malformed replies, EOF, or late responses',async()=>{
  for(const reply of ['{"handled":true,"error":"unavailable"}\n','{"handled":"false"}\n','not-json\n','{"handled":false',undefined,'{"handled":false}\n{"handled":true}\n']){
    const f=await fixture(reply);expect(await invoke(f.socketPath)).toEqual({exitCode:1,fallbacks:0});
  }
  const late=await fixture('{"handled":false}\n',350);expect(await invoke(late.socketPath,.08)).toEqual({exitCode:1,fallbacks:0});
  const partial=await fixture('false}\n',350,'{"handled":');expect(await invoke(partial.socketPath,.08)).toEqual({exitCode:1,fallbacks:0});
  const unsafe=await fixture('{"handled":false}\n');await fs.chmod(unsafe.socketPath,0o666);expect(await invoke(unsafe.socketPath)).toEqual({exitCode:1,fallbacks:0});expect(unsafe.requests).toEqual([]);
});
