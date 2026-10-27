import {afterEach,expect,it,vi} from 'vitest';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createConnection} from 'node:net';
import {gameGuideMonitor,XboxGameGuide} from './xbox-game-guide.js';
const guides:XboxGameGuide[]=[],directories:string[]=[];
afterEach(async()=>{await Promise.all(guides.splice(0).map(guide=>guide.shutdown()));await Promise.all(directories.splice(0).map(directory=>fs.rm(directory,{recursive:true,force:true})));});
it('uses portable logical display bounds and rejects invalid geometry',()=>{
 expect(gameGuideMonitor({x:-1920,y:0,width:1920,height:1080})).toEqual({x:-1920,y:0,width:1920,height:1080});
 for(const width of [0,-1,NaN,1.5,32769])expect(()=>gameGuideMonitor({x:0,y:0,width,height:1080})).toThrow('monitor');
});
it('opens and toggles only a bound game session without requiring compositor window metadata',async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'nexus-portable-guide-'));directories.push(directory);
 const helper=path.join(directory,'host.py'),events=path.join(directory,'events');
 await fs.writeFile(helper,`import json,sys,pathlib\nc=json.loads(sys.stdin.readline())\np=pathlib.Path(__file__).with_name('events')\np.write_text(json.dumps({'monitor':c['monitor']}))\nprint(json.dumps({'event':'ready'}),flush=True)\nfor line in sys.stdin:\n command=line.strip()\n with p.open('a') as f:f.write('\\n'+command)\n if command=='quit':break\n print(json.dumps({'event':'shown' if command=='show' else 'hidden'}),flush=True)\n`);
 let enabled=true;
 const guide=new XboxGameGuide({directory,helper,account:()=> 'synthetic',initial:()=>({auth:{},party:{},voice:{},invites:[],profile:null}),invoke:async()=>{},problem:vi.fn(),monitor:()=>({x:0,y:0,width:1920,height:1080}),enabled:()=>enabled});guides.push(guide);
 expect(await guide.toggle()).toBe(false);guide.bind('fixture','Synthetic game');expect(await guide.toggle()).toBe(true);
 await vi.waitFor(async()=>expect(await fs.readFile(events,'utf8')).toContain('\nshow'));
 expect(JSON.parse((await fs.readFile(events,'utf8')).split('\n')[0]).monitor).toEqual({x:0,y:0,width:1920,height:1080});
 expect(await guide.toggle()).toBe(true);await vi.waitFor(async()=>expect(await fs.readFile(events,'utf8')).toContain('\nhide'));
 enabled=false;expect(await guide.toggle()).toBe(false);guide.unbind();expect(await guide.toggle()).toBe(false);
});

it('acknowledges legacy scripts without toggling again beside the app-owned shortcut',async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'nexus-guide-legacy-'));directories.push(directory);let owned=true;
 const guide=new XboxGameGuide({directory,helper:'unused',account:()=>undefined,initial:()=>({auth:{},party:{},voice:{},invites:[],profile:null}),invoke:async()=>{},problem:vi.fn(),monitor:()=>({x:0,y:0,width:1920,height:1080}),enabled:()=>true,legacyShortcutOwned:()=>owned});guides.push(guide);
 const toggle=vi.spyOn(guide,'toggle'),socket=path.join(directory,'guide.sock');await guide.startControl(socket);
 const request=()=>new Promise<any>((resolve,reject)=>{const client=createConnection(socket);let output='';client.on('error',reject);client.on('connect',()=>client.write('{"command":"toggle"}\n'));client.on('data',bytes=>output+=bytes);client.on('end',()=>resolve(JSON.parse(output)));});
 expect(await request()).toEqual({handled:true});owned=false;expect(await request()).toEqual({handled:false});expect(toggle).not.toHaveBeenCalled();
});
