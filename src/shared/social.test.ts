import { describe,expect,it } from 'vitest';
import { parseXboxFriends,parseXboxConversation,xboxUserId,xboxMessageText } from './social.js';
const friend={xuid:'42',gamertag:'<Example>',presence:'online',activity:'A game'};
const message={id:'one',sender:'42',at:'2026-10-25T00:00:00Z',hidden:false,text:'<script>plain</script>'};
describe('Xbox social boundaries',()=>{
  it.each(['0','01','-1','18446744073709551616','42/../../','42?token=x',42,null,''])('rejects invalid user %s',v=>expect(xboxUserId(v)).toBe(false));
  it.each(['1','42','18446744073709551615'])('keeps uint64 user %s lossless',v=>expect(xboxUserId(v)).toBe(true));
  it('validates message text by Unicode code points and never accepts controls or empty text',()=>{
    expect(xboxMessageText('🐱'.repeat(256))).toBe(true);expect(xboxMessageText('🐱'.repeat(257))).toBe(false);
    for(const v of ['',' \n\t','secret\0','secret\r','bad\u001b',null])expect(xboxMessageText(v)).toBe(false);
    expect(xboxMessageText('first\nsecond\t🐱')).toBe(true);
  });
  it('projects only friend fields and preserves unknown presence without inventing online state',()=>{
    expect(parseXboxFriends({friends:[{...friend,token:'private',realName:'private'}]})).toEqual([friend]);
    expect(parseXboxFriends({friends:[{...friend,presence:'unknown'}]})[0].presence).toBe('unknown');
    for(const value of [{friends:[friend,friend]},{friends:[{...friend,presence:'Away'}]},{friends:[{...friend,activity:{}}]},{friends:Array(1001).fill(friend)},null])expect(()=>parseXboxFriends(value)).toThrow();
  });
  it('removes filtered message text before any renderer can receive it and sorts by timestamp',()=>{
    const result=parseXboxConversation({xuid:'42',hasMore:true,messages:[{...message,id:'two',at:'2026-10-26T00:00:00Z',hidden:true,text:'FILTERED'},message]},'42');
    expect(result.messages.map(x=>x.id)).toEqual(['one','two']);expect(JSON.stringify(result)).not.toContain('FILTERED');
    expect(result.messages[0].text).toContain('<script>');expect(result.hasMore).toBe(true);
  });
  it('rejects mismatched, malformed, duplicate and oversized conversations',()=>{
    for(const v of [{xuid:'43',hasMore:false,messages:[]},{xuid:'42',hasMore:false,messages:[message,message]},
      {xuid:'42',hasMore:false,messages:[{...message,at:'not-a-date'}]}, {xuid:'42',hasMore:false,messages:[{...message,sender:42}]},
      {xuid:'42',hasMore:false,messages:[{...message,text:'bad\0'}]}, {xuid:'42',hasMore:false,messages:Array(101).fill(message)}])expect(()=>parseXboxConversation(v,'42')).toThrow();
  });
});
