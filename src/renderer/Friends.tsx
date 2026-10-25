import { useEffect, useRef, useState, type FormEvent } from 'react';
import { LoaderCircle, Send, UserRound, X } from 'lucide-react';
import type { AppSnapshot } from '../shared/types';
import { xboxAvatarUrl, xboxMessageText, xboxSocialError, type XboxConversation, type XboxFriend } from '../shared/social';
import { FriendsRefresh } from './friends-refresh';
import './friends.css';

export function FriendAvatar({ friend }: { friend: XboxFriend }) {
  const url = xboxAvatarUrl(friend.avatarUrl);
  const [failed,setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  return <span className="friend-avatar">{url&&!failed?<img src={url} alt="" loading="lazy" referrerPolicy="no-referrer" onError={()=>setFailed(true)} />:<UserRound aria-hidden="true" />}</span>;
}

export function Friends({ data, close, docked=false }: { data: AppSnapshot; close: () => void; docked?: boolean }) {
  const [friends,setFriends]=useState<XboxFriend[]>([]),[selected,setSelected]=useState<XboxFriend>();
  const [conversation,setConversation]=useState<XboxConversation>(),[draft,setDraft]=useState('');
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const [sending,setSending]=useState(false);
  const [uncertain,setUncertain]=useState(false);
  const generation=useRef(0),pending=useRef(false),select=useRef('');
  const currentFriend=useRef<XboxFriend>(),lastFriends=useRef(0);
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
    setFriends([]);setSelected(undefined);currentFriend.current=undefined;select.current='';setConversation(undefined);setDraft('');setUncertain(false);setError('');pending.current=false;setBusy(false);setSending(false);lastFriends.current=0;
    if(available){
      setBusy(true);pending.current=true;
      void window.launcher.getXboxFriends().then(value=>{
        if(generation.current===active){setFriends(value);lastFriends.current=Date.now();}
      }).catch(error=>{if(generation.current===active)setError(xboxSocialError(error));})
        .finally(()=>{if(generation.current===active){setBusy(false);pending.current=false;}});
    }
    return ()=>{generation.current++;void window.launcher.closeXboxSocial().catch(()=>{});};
  },[available,data.auth.username]);

  async function refresh(friend=currentFriend.current,automatic=false): Promise<boolean> {
    if(pending.current)return true;
    if(automatic&&!friend&&Date.now()-lastFriends.current<60_000)return true;
    pending.current=true;setBusy(true);setError('');const active=generation.current;
    try{
      if(automatic&&Date.now()-lastFriends.current>=60_000){
        const value=await window.launcher.getXboxFriends();
        if(generation.current!==active)return true;
        setFriends(value);lastFriends.current=Date.now();
        const updated=value.find(value=>value.xuid===currentFriend.current?.xuid);
        if(updated){currentFriend.current=updated;setSelected(updated);}
      }
      if(friend){
        const value=await window.launcher.getXboxConversation(friend.xuid);
        if(generation.current===active&&select.current===friend.xuid){setConversation(value);setUncertain(false);}
      }else{
        if(!automatic||Date.now()-lastFriends.current>=60_000){
          const value=await window.launcher.getXboxFriends();if(generation.current===active){setFriends(value);lastFriends.current=Date.now();}
        }
      }
      return true;
    }catch(error){if(generation.current===active)setError(xboxSocialError(error));return false;}
    finally{if(generation.current===active){pending.current=false;setBusy(false);}}
  }
  useEffect(()=>{
    if(!available)return;
    const polling=new FriendsRefresh(()=>refresh(currentFriend.current,true),()=>document.visibilityState==='visible');
    polling.start();
    const visible=()=>{if(document.visibilityState==='visible')polling.wake();};
    document.addEventListener('visibilitychange',visible);
    return()=>{polling.stop();document.removeEventListener('visibilitychange',visible);};
  },[available,data.auth.username]);
  function choose(friend:XboxFriend){
    if(pending.current)return;
    setSelected(friend);currentFriend.current=friend;select.current=friend.xuid;setConversation(undefined);setDraft('');setUncertain(false);void refresh(friend);
  }
  async function send(event:FormEvent){
    event.preventDefault();if(!selected||pending.current||uncertain||!xboxMessageText(draft))return;
    const friend=selected,message=draft,active=generation.current;
    pending.current=true;setBusy(true);setSending(true);setError('');
    try{
      await window.launcher.sendXboxMessage(friend.xuid,message);
      if(generation.current!==active)return;
      setDraft('');
      try{const value=await window.launcher.getXboxConversation(friend.xuid);if(generation.current===active)setConversation(value);}
      catch{if(generation.current===active)setError('Message sent. The conversation could not refresh.');}
    }catch{if(generation.current===active){setUncertain(true);setError('Message delivery could not be confirmed. Check the conversation before sending again.');}}
    finally{if(generation.current===active){pending.current=false;setBusy(false);setSending(false);}}
  }
  async function invitationAction(action:()=>Promise<void>){
    if(pending.current)return;const active=generation.current;pending.current=true;setBusy(true);setError('');
    try{await action();}catch{if(generation.current===active)setError('The invitation could not be processed. Check that the game and account are still available.');}
    finally{if(generation.current===active){pending.current=false;setBusy(false);}}
  }
  const outgoing=data.social?.outgoing??[],incoming=data.social?.incoming??[];
  return <div className={docked?'friends-docked':'dialog-backdrop'} data-gamepad-layer>
    <section ref={dialog} className="friends-dialog" role="dialog" aria-modal={docked?undefined:true} aria-labelledby="friends-heading">
      <header><h2 id="friends-heading">Friends</h2>{busy?<span className="friends-loading" role="status"><LoaderCircle className="spin" /><span className="sr-only">Loading</span></span>:null}<button data-gamepad-initial data-gamepad-cancel aria-label="Close friends" onClick={close}><X /></button></header>
      {incoming.length||outgoing.length?<section className="friends-invitations" aria-label="Game invitations">
        {incoming.map(invite=><article key={invite.id}><div><strong>{invite.game}</strong><small>Invitation from {invite.sender}</small></div><button disabled={busy} onClick={()=>void invitationAction(()=>window.launcher.acceptGameInvite(invite.id))}>Accept</button></article>)}
        {outgoing.map(invite=><article key={invite.id}><div><strong>{invite.game}</strong><small>{invite.phase==='choosing'?'Choose a friend below, then send an invitation.':invite.phase==='sending'?'Waiting for the game to send the invitation…':invite.phase==='sent'?'Invitation sent.':invite.phase==='failed'?'The game could not confirm invitation delivery.':'Invitation cancelled.'}</small></div>{invite.phase==='choosing'?<><button disabled={busy||!selected} onClick={()=>selected&&void invitationAction(()=>window.launcher.chooseGameInviteRecipient(invite.id,selected.xuid))}>Invite {selected?.gamertag??'friend'}</button><button disabled={busy} onClick={()=>void invitationAction(()=>window.launcher.cancelGameInvite(invite.id))}>Cancel</button></>:null}</article>)}
      </section>:null}
      {!available?<p role="status">{data.auth.stored!==true?'Sign in to your Microsoft account in Settings first.':'This backend does not support Xbox friends and chat. Use a compatible Nexus backend.'}</p>:<>
        {error?<p className="friends-error" role="alert">{error}</p>:null}
        <div className="friends-columns">
          <aside aria-label="Friends list">
            {!busy&&!friends.length?<p>No friends returned by Xbox.</p>:null}
            {friends.map(friend=><button key={friend.xuid} className={selected?.xuid===friend.xuid?'selected':''} disabled={busy} onClick={()=>choose(friend)}>
              <FriendAvatar friend={friend} /><span className="friend-details"><strong>{friend.gamertag}</strong><small>{friend.presence==='online'?'Online':friend.presence==='offline'?'Offline':'Presence unavailable'}</small>{friend.activity?<small>{friend.activity}</small>:null}</span>
            </button>)}
          </aside>
          <section className="friends-chat" aria-label="Conversation">
            {selected?<><h3><FriendAvatar friend={selected} />{selected.gamertag}</h3>
              {(data.social?.active??[]).map(game=><button key={game.id} disabled={busy||(data.social?.outgoing??[]).some(value=>value.phase==='sending'&&value.id.startsWith(game.id+':'))} onClick={()=>void invitationAction(()=>window.launcher.inviteXboxFriend(game.id,selected.xuid))}>Invite to {game.game}</button>)}
              <div className="friends-messages" role="log" aria-live="polite">
                {conversation?.hasMore?<p>Showing the latest 100 messages. Older messages are not loaded.</p>:null}
                {conversation?.messages.map(message=><article key={message.id}>
                  <small>{message.sender===selected.xuid?selected.gamertag:'You'} · <time dateTime={message.at}>{new Date(message.at).toLocaleString()}</time></small>
                  <p>{message.hidden?'Message hidden or unsupported.':message.text}</p>
                </article>)}
                {conversation&&!conversation.messages.length?<p>No messages returned by Xbox.</p>:null}
              </div>
              <form onSubmit={event=>void send(event)}><label htmlFor="xbox-message">Message</label><textarea id="xbox-message" value={draft} maxLength={512} onChange={event=>setDraft(event.target.value)} disabled={sending} />
                <small>{Array.from(draft).length}/256 characters</small><button type="submit" disabled={busy||uncertain||!xboxMessageText(draft)}><Send />Send</button></form>
            </>:<div className="friends-empty"><UserRound aria-hidden="true" /><h3>Your conversations</h3><p>Select a friend to start chatting.</p></div>}
          </section>
        </div>
      </>}
    </section>
  </div>;
}
