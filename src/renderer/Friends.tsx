import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ExternalLink, LoaderCircle, RefreshCw, Send, X } from 'lucide-react';
import type { AppSnapshot } from '../shared/types';
import { xboxMessageText, type XboxConversation, type XboxFriend } from '../shared/social';
import './friends.css';

export function Friends({ data, close, docked=false, overlay=false }: { data: AppSnapshot; close: () => void; docked?: boolean; overlay?: boolean }) {
  const [friends,setFriends]=useState<XboxFriend[]>([]),[selected,setSelected]=useState<XboxFriend>();
  const [conversation,setConversation]=useState<XboxConversation>(),[draft,setDraft]=useState('');
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const [uncertain,setUncertain]=useState(false);
  const generation=useRef(0),pending=useRef(false),select=useRef('');
  const dialog=useRef<HTMLElement>(null),onClose=useRef(close);onClose.current=close;
  const available=data.auth.stored===true&&!data.auth.running&&data.backend.available&&data.backend.capabilities.commands.includes('social');
  useEffect(()=>{
    const origin=document.activeElement instanceof HTMLElement?document.activeElement:undefined;
    dialog.current?.querySelector<HTMLElement>('[data-gamepad-initial]')?.focus({preventScroll:true});
    const key=(event:KeyboardEvent)=>{
      if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();onClose.current();}
      if(event.key==='Tab'&&!docked){
        const controls=[...dialog.current!.querySelectorAll<HTMLElement>('button:not(:disabled),textarea:not(:disabled)')];
        if(!dialog.current?.contains(document.activeElement)||event.shiftKey&&document.activeElement===controls[0]||!event.shiftKey&&document.activeElement===controls.at(-1)){
          event.preventDefault();(event.shiftKey?controls.at(-1):controls[0])?.focus();
        }
      }
    };
    window.addEventListener('keydown',key,true);
    return()=>{window.removeEventListener('keydown',key,true);if(origin?.isConnected)origin.focus({preventScroll:true});};
  },[docked]);

  useEffect(()=>{
    const active=++generation.current;
    setFriends([]);setSelected(undefined);select.current='';setConversation(undefined);setDraft('');setUncertain(false);setError('');pending.current=false;setBusy(false);
    if(available){
      setBusy(true);pending.current=true;
      void window.launcher.getXboxFriends().then(value=>{
        if(generation.current===active)setFriends(value);
      }).catch(()=>{if(generation.current===active)setError('Xbox friends could not be loaded. Check your connection and account permissions, then refresh.');})
        .finally(()=>{if(generation.current===active){setBusy(false);pending.current=false;}});
    }
    return ()=>{generation.current++;void window.launcher.closeXboxSocial().catch(()=>{});};
  },[available,data.auth.username]);

  async function refresh(friend=selected) {
    if(pending.current)return;
    pending.current=true;setBusy(true);setError('');const active=generation.current;
    try{
      if(friend){
        const value=await window.launcher.getXboxConversation(friend.xuid);
        if(generation.current===active&&select.current===friend.xuid){setConversation(value);setUncertain(false);}
      }else{
        const value=await window.launcher.getXboxFriends();if(generation.current===active)setFriends(value);
      }
    }catch{if(generation.current===active)setError('Xbox could not refresh this view. Check your connection and communication permissions.');}
    finally{if(generation.current===active){pending.current=false;setBusy(false);}}
  }
  function choose(friend:XboxFriend){
    if(pending.current)return;
    setSelected(friend);select.current=friend.xuid;setConversation(undefined);setDraft('');setUncertain(false);void refresh(friend);
  }
  async function send(event:FormEvent){
    event.preventDefault();if(!selected||pending.current||uncertain||!xboxMessageText(draft))return;
    const friend=selected,message=draft,active=generation.current;
    pending.current=true;setBusy(true);setError('');
    try{
      await window.launcher.sendXboxMessage(friend.xuid,message);
      if(generation.current!==active)return;
      setDraft('');
      try{const value=await window.launcher.getXboxConversation(friend.xuid);if(generation.current===active)setConversation(value);}
      catch{if(generation.current===active)setError('Message sent. The conversation could not refresh.');}
    }catch{if(generation.current===active){setUncertain(true);setError('Message delivery could not be confirmed. Refresh the conversation before trying again.');}}
    finally{if(generation.current===active){pending.current=false;setBusy(false);}}
  }
  async function invitationAction(action:()=>Promise<void>){
    if(pending.current)return;const active=generation.current;pending.current=true;setBusy(true);setError('');
    try{await action();}catch{if(generation.current===active)setError('The invitation could not be processed. Check that the game and account are still available.');}
    finally{if(generation.current===active){pending.current=false;setBusy(false);}}
  }
  const outgoing=data.social?.outgoing??[],incoming=data.social?.incoming??[];
  return <div className={docked?'friends-docked':overlay?'friends-overlay-content':'dialog-backdrop'} data-gamepad-layer>
    <section ref={dialog} className="friends-dialog" role="dialog" aria-modal={docked?undefined:true} aria-labelledby="friends-heading">
      <header><h2 id="friends-heading">Xbox friends</h2><div>{!overlay?<button title="Open desktop overlay (Ctrl+Shift+F10)" aria-label="Open desktop overlay" onClick={()=>void window.launcher.toggleSocialOverlay().catch(()=>setError('The desktop overlay could not be opened.'))}><ExternalLink /></button>:null}<button data-gamepad-initial data-gamepad-cancel aria-label="Close friends" onClick={close}><X /></button></div></header>
      {incoming.length||outgoing.length?<section className="friends-invitations" aria-label="Game invitations">
        {incoming.map(invite=><article key={invite.id}><div><strong>{invite.game}</strong><small>Invitation from {invite.sender}</small></div><button disabled={busy} onClick={()=>void invitationAction(()=>window.launcher.acceptGameInvite(invite.id))}>Accept</button></article>)}
        {outgoing.map(invite=><article key={invite.id}><div><strong>{invite.game}</strong><small>{invite.phase==='choosing'?'Choose a friend below, then send an invitation.':invite.phase==='sending'?'Waiting for the game to send the invitation…':invite.phase==='sent'?'Invitation sent.':invite.phase==='failed'?'The game could not confirm invitation delivery.':'Invitation cancelled.'}</small></div>{invite.phase==='choosing'?<><button disabled={busy||!selected} onClick={()=>selected&&void invitationAction(()=>window.launcher.chooseGameInviteRecipient(invite.id,selected.xuid))}>Invite {selected?.gamertag??'friend'}</button><button disabled={busy} onClick={()=>void invitationAction(()=>window.launcher.cancelGameInvite(invite.id))}>Cancel</button></>:null}</article>)}
      </section>:null}
      {!available?<p role="status">{data.auth.stored!==true?'Sign in to your Microsoft account in Settings first.':'This backend does not support Xbox friends and chat. Use a compatible Nexus backend.'}</p>:<>
        <div className="friends-tools"><button disabled={busy} onClick={()=>void refresh()}><RefreshCw />Refresh {selected?'conversation':'friends'}</button>{busy?<span role="status"><LoaderCircle className="spin" />Loading</span>:null}</div>
        {error?<p className="friends-error" role="alert">{error}</p>:null}
        <div className="friends-columns">
          <aside aria-label="Friends list">
            {!busy&&!friends.length?<p>No friends returned by Xbox.</p>:null}
            {friends.map(friend=><button key={friend.xuid} className={selected?.xuid===friend.xuid?'selected':''} disabled={busy} onClick={()=>choose(friend)}>
              <strong>{friend.gamertag}</strong><small>{friend.presence==='online'?'Online':friend.presence==='offline'?'Offline':'Presence unavailable'}</small>{friend.activity?<small>{friend.activity}</small>:null}
            </button>)}
          </aside>
          <section className="friends-chat" aria-label="Conversation">
            {selected?<><h3>{selected.gamertag}</h3>
              {(data.social?.active??[]).map(game=><button key={game.id} disabled={busy||(data.social?.outgoing??[]).some(value=>value.phase==='sending'&&value.id.startsWith(game.id+':'))} onClick={()=>void invitationAction(()=>window.launcher.inviteXboxFriend(game.id,selected.xuid))}>Invite to {game.game}</button>)}
              <div className="friends-messages" role="log" aria-live="polite">
                {conversation?.hasMore?<p>Showing the latest 100 messages. Older messages are not loaded.</p>:null}
                {conversation?.messages.map(message=><article key={message.id}>
                  <small>{message.sender===selected.xuid?selected.gamertag:'You'} · <time dateTime={message.at}>{new Date(message.at).toLocaleString()}</time></small>
                  <p>{message.hidden?'Message hidden or unsupported.':message.text}</p>
                </article>)}
                {conversation&&!conversation.messages.length?<p>No messages returned by Xbox.</p>:null}
              </div>
              <form onSubmit={event=>void send(event)}><label htmlFor="xbox-message">Message</label><textarea id="xbox-message" value={draft} maxLength={512} onChange={event=>setDraft(event.target.value)} disabled={busy} />
                <small>{Array.from(draft).length}/256 characters</small><button type="submit" disabled={busy||uncertain||!xboxMessageText(draft)}><Send />Send</button></form>
            </>:<p>Select a friend to open a conversation. Nothing is sent automatically.</p>}
          </section>
        </div>
        <p className="friends-limitation">Game invitations require a running game using a compatible Nexus runtime. Use the game's Invite friends action to choose a recipient here. The desktop overlay may not appear over exclusive fullscreen or Steam Game Mode. Chat does not change your in-game online status.</p>
      </>}
    </section>
  </div>;
}
