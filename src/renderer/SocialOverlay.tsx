import { useEffect, useState } from 'react';
import type { AppSnapshot } from '../shared/types';
import { Friends } from './Friends';

export function SocialOverlay(){
  const [data,setData]=useState<AppSnapshot>();
  useEffect(()=>{
    let active=true;
    void window.launcher.getSnapshot().then(value=>{if(active)setData(value);}).catch(()=>{});
    const dispose=window.launcher.onSnapshot(value=>{if(active)setData(value);});
    return()=>{active=false;dispose();};
  },[]);
  return data?<Friends data={data} overlay close={()=>void window.launcher.closeSocialOverlay()} />:<div role="status">Loading friends…</div>;
}
