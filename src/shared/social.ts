export interface XboxFriend { xuid: string; gamertag: string; presence: 'online' | 'offline' | 'unknown'; activity?: string }
export interface XboxChatMessage { id: string; sender: string; at: string; text?: string; hidden: boolean }
export interface XboxConversation { xuid: string; messages: XboxChatMessage[]; hasMore: boolean }
export type SocialRequest = { op: 'friends' } | { op: 'conversation'; xuid: string } | { op: 'send'; xuid: string; text: string };

export function xboxUserId(value: unknown): value is string {
  return typeof value === 'string' && /^[1-9][0-9]{0,19}$/.test(value) && BigInt(value) <= 18446744073709551615n;
}
export function xboxMessageText(value: unknown): value is string {
  return typeof value === 'string' && Boolean(value.trim()) && Array.from(value).length <= 256 && !/[\x00-\x08\x0b-\x1f\x7f]/.test(value);
}
const label = (s: unknown, max: number): s is string => typeof s === 'string' && Array.from(s).length <= max && !/[\x00-\x1f\x7f]/.test(s);

/** Explicit field projection. Backend data and account identifiers never become markup or URLs. */
export function parseXboxFriends(value: unknown): XboxFriend[] {
  const friends=(value as {friends?:unknown} | null)?.friends;
  if(!Array.isArray(friends)||friends.length>1000) throw Error('Invalid friends response.');
  const seen=new Set<string>();
  return friends.map(friend=>{
    if(!friend||!xboxUserId(friend.xuid)||seen.has(friend.xuid)||!label(friend.gamertag,128)||!friend.gamertag.trim()
      || !['online','offline','unknown'].includes(friend.presence) || (friend.activity!=null&&!label(friend.activity,512))) throw Error('Invalid friends response.');
    seen.add(friend.xuid);
    return {xuid:friend.xuid,gamertag:friend.gamertag,presence:friend.presence,activity:friend.activity??undefined};
  });
}
export function parseXboxConversation(value: unknown, expected: string): XboxConversation {
  const v=value as XboxConversation | null;
  if(!v||v.xuid!==expected||!Array.isArray(v.messages)||v.messages.length>100||typeof v.hasMore!=='boolean') throw Error('Invalid conversation response.');
  const seen=new Set<string>();
  const messages=v.messages.map(message=>{
    if(!message||!label(message.id,128)||!message.id||seen.has(message.id)||!xboxUserId(message.sender)||!label(message.at,64)
      ||!/^\d{4}-\d{2}-\d{2}T/.test(message.at)||!Number.isFinite(Date.parse(message.at))||typeof message.hidden!=='boolean'
      ||(!message.hidden&&(typeof message.text!=='string'||message.text.length>262144||/[\x00-\x08\x0b-\x1f\x7f]/.test(message.text)))) throw Error('Invalid conversation response.');
    seen.add(message.id);
    return {id:message.id,sender:message.sender,at:message.at,hidden:message.hidden,text:message.hidden?undefined:message.text};
  });
  messages.sort((a,b)=>Date.parse(a.at)-Date.parse(b.at));
  return {xuid:expected,messages,hasMore:v.hasMore};
}
