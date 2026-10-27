import {useEffect,useState} from 'react';
import type {AuthStatus} from '../shared/types';
import {XboxChat} from './XboxChat';
import './xbox-social.css';

export function XboxChatDesktop({xuid}:{xuid:string}){
 const [auth,setAuth]=useState<AuthStatus>(),[problem,setProblem]=useState<string>();
 useEffect(()=>{
  let alive=true;void window.launcher.getSnapshot().then(value=>{if(alive)setAuth(value.auth);},()=>{if(alive)setProblem('Nexus could not load the account. Reopen this chat to try again.');});
  const unsubscribe=window.launcher.onSnapshot(value=>{if(alive)setAuth(value.auth);});
  return()=>{alive=false;unsubscribe();};
 },[]);
 const account=auth?.stored===true&&!auth.running?auth.username:undefined;
 return <main className="xbox-social xbox-guide social-overlay xbox-chat-desktop">
  {account?<XboxChat key={account} api={window.launcher.nativeSocial} account={account} xuid={xuid} close={()=>void window.launcher.closeXboxChat()}
   openProfile={id=>{void window.launcher.nativeSocial.openXboxPlayerProfile(id).catch(()=>setProblem('The profile could not be opened in Nexus.'));}}/>:<p className="social-notice">{problem??(auth?'Sign in through Nexus to open this chat.':'Loading Xbox chat…')}</p>}
  {problem&&account?<p role="alert" className="social-error">{problem}</p>:null}
 </main>;
}
