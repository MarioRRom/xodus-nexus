import { expect,it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Friends } from './Friends';
import { TopStatus } from './App';
import { demoSnapshot } from '../shared/demo-data';
it('shows honest capability and account prerequisites instead of fake friends or invites',()=>{
  const data=demoSnapshot();data.auth.stored=false;
  let html=renderToStaticMarkup(<Friends data={data} close={()=>{}} />);
  expect(html).toContain('Sign in to your Microsoft account');expect(html).not.toContain('<textarea');
  data.auth.stored=true;data.backend.capabilities.commands=[];
  html=renderToStaticMarkup(<Friends data={data} close={()=>{}} />);
  expect(html).toContain('does not support Xbox friends and chat');expect(html).not.toContain('<textarea');
  expect(html).toContain('aria-modal="true"');expect(html).toContain('data-gamepad-cancel');
});
it('keeps chat, in-game presence, invitations and overlay capabilities separate',()=>{
  const data=demoSnapshot();data.auth.stored=true;data.auth.running=false;data.backend.available=true;data.backend.capabilities.commands.push('social');
  const html=renderToStaticMarkup(<Friends data={data} close={()=>{}} />);
  expect(html).toContain('Nothing is sent automatically');
  expect(html).toContain('Game invitations require a running game using a compatible Nexus runtime');
  expect(html).toContain('may not appear over exclusive fullscreen or Steam Game Mode');
  expect(html).toContain('Chat does not change your in-game online status');
  expect(html).not.toMatch(/Invitation sent\.|<iframe|<webview/);
});
it('keeps friends out of the top bar and preserves existing navigation',()=>{
  const html=renderToStaticMarkup(<TopStatus data={demoSnapshot()} go={()=>{}} openFriends={()=>{}} />);
  expect(html).not.toContain('Xbox friends and chat');expect(html).toContain('Settings');
});
it('supports a bottom-right dock and an independent desktop overlay surface',()=>{
  const data=demoSnapshot();
  expect(renderToStaticMarkup(<Friends data={data} docked close={()=>{}} />)).toContain('friends-docked');
  expect(renderToStaticMarkup(<Friends data={data} overlay close={()=>{}} />)).toContain('friends-overlay-content');
});
