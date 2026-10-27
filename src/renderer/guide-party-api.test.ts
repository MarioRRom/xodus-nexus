import {afterEach,expect,it,vi} from 'vitest';
const rpc=vi.hoisted(()=>vi.fn(async(..._args:unknown[])=>undefined));
const events=vi.hoisted(()=>vi.fn((..._args:unknown[])=>()=>{}));
vi.mock('./xbox-guide-api',()=>({guideRpc:rpc,onGuideEvent:events}));
import {guidePartyApi} from './guide-party-api';
afterEach(()=>vi.clearAllMocks());
it('routes Guide party controls to the existing shared media owner without owning audio',async()=>{
 await guidePartyApi.getXboxParty();await guidePartyApi.controlXboxVoice({type:'leave'});await guidePartyApi.inviteXboxPartyFriend('2');
 expect(rpc.mock.calls).toEqual([['getXboxParty'],['controlXboxVoice',{type:'leave'}],['inviteXboxPartyFriend','2']]);
 guidePartyApi.onXboxPartyState(()=>{});guidePartyApi.onXboxVoiceState(()=>{});guidePartyApi.onXboxInvitesChanged(()=>{});
 expect(events.mock.calls.map(call=>call[0])).toEqual(['party','voice','invites']);
 expect(guidePartyApi).not.toHaveProperty('xboxVoiceHostReady');expect(guidePartyApi).not.toHaveProperty('acceptXboxGameInvite');
});
