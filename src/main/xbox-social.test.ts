import { describe,expect,it,vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { XboxSocial } from './xbox-social.js';
import type { SocialRequest } from '../shared/social.js';
const identity={account:'synthetic@example.test',binary:'/fixture/backend'};
const friend={xuid:'42',gamertag:'Example',presence:'unknown'};
const output=(result:unknown,account=identity.account)=>JSON.stringify({schema:1,account,result});
describe('explicit account-bound Xbox friends/chat',()=>{
  it('does not call anything at construction or without a supported signed-in account',async()=>{
    const read=vi.fn();const social=new XboxSocial(()=>undefined,read);expect(read).not.toHaveBeenCalled();
    await expect(social.friends()).rejects.toThrow('Sign in');expect(read).not.toHaveBeenCalled();
  });
  it('coalesces overlapping reads and never caches friends or messages on disk',async()=>{
    let finish!:(v:string)=>void;
    const read=vi.fn(()=>new Promise<string>(resolve=>{finish=resolve;}));const social=new XboxSocial(()=>identity,read);
    const first=social.friends(),second=social.friends();expect(first).toBe(second);expect(read).toHaveBeenCalledOnce();
    finish(output({friends:[friend]}));expect(await first).toEqual([{...friend,activity:undefined}]);await second;expect(social.busy).toBe(false);
  });
  it('rejects stale account/backend results, including switch-away-and-back',async()=>{
    let current=identity,finish!:(v:string)=>void;const read=vi.fn(()=>new Promise<string>(resolve=>{finish=resolve;}));
    const social=new XboxSocial(()=>current,read);const pending=social.friends();current={...identity,account:'other'};
    finish(output({friends:[friend]}));await expect(pending).rejects.toThrow('changed');
    current=identity;const next=social.friends();social.close();current={...identity};finish(output({friends:[friend]}));await expect(next).rejects.toThrow('cancelled');await social.settled();
  });
  it.each([output({friends:[]},'wrong'),'{bad',output({friends:[{...friend,xuid:'../escape'}]}),'x'.repeat(2*1024*1024+1)])('rejects malformed data without publishing payloads',async raw=>{
    const social=new XboxSocial(()=>identity,async()=>raw);await expect(social.friends()).rejects.toThrow(/response/);
  });
  it('validates input before the backend and sends only once while awaiting acknowledgement',async()=>{
    let finish!:(v:string)=>void;const read=vi.fn(()=>new Promise<string>(resolve=>{finish=resolve;}));const social=new XboxSocial(()=>identity,read);
    await expect(social.send('../bad','hello')).rejects.toThrow();await expect(social.send('42','x'.repeat(257))).rejects.toThrow();expect(read).not.toHaveBeenCalled();
    const first=social.send('42','hello');await expect(social.send('42','hello')).rejects.toThrow('already');
    finish(output({sent:true}));await first;expect(read).toHaveBeenCalledOnce();expect(read.mock.calls[0][1]).toEqual({op:'send',xuid:'42',text:'hello'});
  });
  it('never exposes arbitrary transport errors or retries an ambiguous send',async()=>{
    const read=vi.fn(async()=>{throw Error('Invalid Xbox response. PRIVATE_TOKEN');});const social=new XboxSocial(()=>identity,read);
    await expect(social.send('42','hello')).rejects.toThrow('unavailable');expect(read).toHaveBeenCalledOnce();
  });
  it('keeps a cancelled operation in shutdown draining until its child finishes',async()=>{
    let finish!:(v:string)=>void;const social=new XboxSocial(()=>identity,()=>new Promise(resolve=>{finish=resolve;}));
    const first=social.friends();social.close();expect(social.busy).toBe(true);const drained=social.settled();finish(output({friends:[]}));
    await expect(first).rejects.toThrow('cancelled');await drained;expect(social.busy).toBe(false);
  });
  it('uses a real synthetic subprocess with private stdin, no message or account in argv',async()=>{
    const root=await fs.mkdtemp(path.join(os.tmpdir(),'nexus-social-cli-'));
    try{
      const binary=path.join(root,'xodus-cli'),capture=path.join(root,'request.json');
      const source=`#!${process.execPath}\nlet raw='';process.stdin.on('data',b=>raw+=b);process.stdin.on('end',()=>{const request=JSON.parse(raw);require('node:fs').writeFileSync(${JSON.stringify(capture)},JSON.stringify({args:process.argv.slice(2),request}));console.log(JSON.stringify({schema:1,account:${JSON.stringify(identity.account)},result:{sent:true}}));});\n`;
      await fs.writeFile(binary,source,{mode:0o700});const social=new XboxSocial(()=>({...identity,binary}));
      await social.send('42','TEST_ONLY_message');
      const captured=JSON.parse(await fs.readFile(capture,'utf8'));expect(captured.args).toEqual(['social','--json']);
      expect(captured.request).toEqual({op:'send',xuid:'42',text:'TEST_ONLY_message'});
      await social.settled();
    }finally{await fs.rm(root,{recursive:true,force:true});}
  });
});
