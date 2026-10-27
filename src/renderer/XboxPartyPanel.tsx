import './xbox-party.css';
import {ui} from './i18n';
import { useEffect,useState } from 'react';
import { Headphones,LoaderCircle,Mic,MicOff,PhoneOff,UserPlus } from 'lucide-react';
import type { XboxFriend,XboxInvite,XboxPartyState,XboxPartyControlApi,XboxVoiceState } from '../shared/types';
import {XboxAvatar} from './XboxAvatar';

export function XboxPartyPanel({api,friends,hidden,invitee}:{api:XboxPartyControlApi;friends:XboxFriend[];hidden:boolean;invitee?:{xuid:string;gamertag:string}}) {
  const [party,setParty]=useState<XboxPartyState>({phase:'idle',members:[]});
  const [audio,setAudio]=useState<XboxVoiceState>({connected:false,muted:true,audioBlocked:false,mutedMembers:[]});
  const [busy,setBusy]=useState(false),[problem,setProblem]=useState<string>(),[recipient,setRecipient]=useState(''),[sent,setSent]=useState(false);
  const [existing,setExisting]=useState<string[]>([]),[existingId,setExistingId]=useState(''),[checking,setChecking]=useState(false);
  const [invites,setInvites]=useState<XboxInvite[]>([]);
  useEffect(()=>{if(invitee){setRecipient(invitee.xuid);setSent(false);}},[invitee]);
  const describe=(error:unknown)=>error instanceof Error?error.message.replace(/^Error invoking remote method '[^']+': Error: /,''):'Xbox party request failed.';
  useEffect(()=>{
    let alive=true,received=false;
    const unsubscribe=api.onXboxPartyState(state=>{
      received=true;if(!alive)return;setParty(state);
    });
    void api.getXboxParty().then(state=>{if(alive&&!received)setParty(state);},error=>{if(alive)setProblem(describe(error));});
    return()=>{alive=false;unsubscribe();};
  },[api]);
  useEffect(()=>{
    let alive=true,received=false;
    const unsubscribe=api.onXboxVoiceState(state=>{received=true;if(alive)setAudio(state);});
    void api.getXboxVoiceState().then(state=>{if(alive&&!received)setAudio(state);},error=>{if(alive)setProblem(describe(error));});
    return()=>{alive=false;unsubscribe();};
  },[api]);
  useEffect(()=>api.onXboxInvitesChanged(setInvites),[api]);
  useEffect(()=>{
    if(hidden)return;let alive=true;
    void api.getXboxInvites().then(value=>{if(alive)setInvites(value);},error=>{if(alive)setProblem(describe(error));});
    return()=>{alive=false;};
  },[api,hidden]);
  useEffect(()=>{
    if(hidden||party.id||party.phase==='connecting'||party.phase==='connected'||party.phase==='leaving')return;
    let alive=true;setChecking(true);
    void api.getXboxActiveParties().then(ids=>{if(alive){setExisting(ids);setExistingId(ids[0]??'');}},error=>{if(alive)setProblem(describe(error));}).finally(()=>{if(alive)setChecking(false);});
    return()=>{alive=false;};
  },[api,hidden,party.phase,party.id]);
  async function action(run:()=>Promise<unknown>){
    if(busy)return;setBusy(true);setProblem(undefined);setSent(false);
    try{await run();}catch(error){setProblem(describe(error));}finally{setBusy(false);}
  }
  const connected=party.phase==='connected'&&audio.connected;
  return <div className="social-party" hidden={hidden}>
    <h2>{ui("social.party_dfa82f")}</h2>
    <div className="social-party-status"><Headphones/><div><strong>{connected?'Xbox party connected':party.phase==='leaving'?'Leaving Xbox party…':party.phase==='connecting'?'Connecting Xbox party…':'Xbox voice party'}</strong><small>{connected?(audio.muted?'Microphone off':'Microphone on'):'Start an invite-only party with your microphone off.'}</small></div></div>
    {problem||party.error||audio.error?<p className="social-error" role="alert">{problem||party.error||audio.error}</p>:null}
    {invites.length?<div className="social-party-invitations"><h2>{ui("social.invitations_14210e")}</h2>{invites.filter(invite=>invite.kind==='party').map(invite=><article key={invite.id}>
      <span><strong>{invite.gamertag}</strong><small>{invite.kind==='party'?'Xbox voice party':invite.titleName??'Xbox game invite'}{invite.expiresAt<=Date.now()?' · Expired':''}</small></span>
      <button disabled={busy||Boolean(party.id)||party.phase==='connecting'||invite.expiresAt<=Date.now()} onClick={()=>void action(()=>api.controlXboxVoice({type:'accept',inviteId:invite.id}))}>{ui("social.join_party_f3b7ab")}</button>
    </article>)}</div>:null}
    {party.phase==='idle'||(party.phase==='error'&&!party.id)?existing.length?<div className="social-party-existing"><p>{ui("social.a_voice_party_is_already_active_on_this_account_ec77d1")}</p>{existing.length>1?<select aria-label={ui("social.existing_xbox_party_a9fbf8")} value={existingId} onChange={event=>setExistingId(event.target.value)}>{existing.map((id,index)=><option value={id} key={id}>{ui("social.xbox_party_0a5c6a")} {index+1}</option>)}</select>:null}<div className="social-party-controls"><button disabled={busy||checking} onClick={()=>void action(()=>api.controlXboxVoice({type:'start',partyId:existingId}))}>{ui("social.connect_here_e56500")}</button><button disabled={busy||checking} onClick={()=>void action(async()=>{await api.leaveExistingXboxParty(existingId);const ids=await api.getXboxActiveParties();setExisting(ids);setExistingId(ids[0]??'');})}>{ui("social.leave_existing_party_2c0ebf")}</button></div><small>{ui("social.leaving_also_disconnects_this_account_from_that_voice_p_d54582")}</small></div>:<button className="primary" disabled={busy||checking} onClick={()=>void action(()=>api.controlXboxVoice({type:'start'}))}>{busy||checking?<LoaderCircle className="spin"/>:<Headphones/>}{checking?'Checking Xbox party…':'Start voice party'}</button>:
      <div className="social-party-controls"><button disabled={busy||!connected} onClick={()=>void action(()=>api.controlXboxVoice({type:'setMuted',muted:!audio.muted}))}>{audio.muted?<MicOff/>:<Mic/>}{audio.muted?'Turn microphone on':'Turn microphone off'}</button>
        <button disabled={busy} onClick={()=>void action(()=>api.controlXboxVoice({type:'leave'}))}><PhoneOff/>{ui("social.leave_party_faf1e1")}</button></div>}
    {audio.audioBlocked?<button onClick={()=>void action(()=>api.controlXboxVoice({type:'resume'}))}>{ui("social.enable_party_audio_316130")}</button>:null}
    {party.members.length?<div className="social-party-members"><h2>{ui("social.party_members_aaf4a3")}</h2>{party.members.map(member=>{
      const self=member.xuid===party.selfXuid,name=self?'You':friends.find(friend=>friend.xuid===member.xuid)?.gamertag ?? 'Xbox player';
      const muted=audio.mutedMembers.includes(member.xuid);
      return <div className="social-party-member" key={member.xuid}><XboxAvatar src={friends.find(friend=>friend.xuid===member.xuid)?.avatarUrl} name={name}/><span>{name}{member.role==='owner'?<small>{ui("social.owner_4b1b8a")}</small>:null}</span>{self?(audio.muted?<MicOff aria-label={ui("social.your_microphone_is_off_def954")}/>:<Mic aria-label={ui("social.your_microphone_is_on_8d25fa")}/>):<button className="icon-button" aria-label={`${muted?'Unmute':'Mute'} ${name}`} aria-pressed={muted} onClick={()=>void action(()=>api.controlXboxVoice({type:'mute',xuid:member.xuid,muted:!muted}))}>{muted?<MicOff/>:<Mic/>}</button>}</div>;
    })}</div>:null}
    {connected?<form className="social-party-invite" onSubmit={event=>{event.preventDefault();if(recipient)void action(async()=>{await api.inviteXboxPartyFriend(recipient);setSent(true);});}}>
      <label htmlFor="party-friend">{ui("social.invite_an_xbox_friend_0f5ccf")}</label><div><select id="party-friend" aria-label={ui("social.friend_to_invite_to_xbox_party_8df275")} value={recipient} onChange={event=>{setRecipient(event.target.value);setSent(false);}}><option value="">{ui("social.choose_a_friend_35a26f")}</option>{invitee&&!friends.some(friend=>friend.xuid===invitee.xuid)?<option value={invitee.xuid}>{invitee.gamertag}</option>:null}{friends.map(friend=><option key={friend.xuid} value={friend.xuid}>{friend.gamertag}</option>)}</select><button className="primary" disabled={busy||!recipient}><UserPlus/>{ui("social.invite_1fd9ae")}</button></div>
      {sent?<small role="status">{ui("social.party_invite_sent_7b1573")}</small>:null}
    </form>:null}
  </div>;
}
