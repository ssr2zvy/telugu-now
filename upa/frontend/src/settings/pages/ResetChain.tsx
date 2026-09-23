import { useState } from 'react';
import { resetQueue } from '../../api';
import type { ProfileStateResponse } from '../../../../shared/contracts';
export function ResetChain({profileCode,onState,scope='chain'}:{scope?:'chain'|'core'|'all';profileCode:string;onState?:(state:ProfileStateResponse)=>void}) {
  const [busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const reset=async()=>{if(busy)return;setBusy(true);setMessage('');try{
    const state=await resetQueue(profileCode,{visible:false,scope});onState?.(state);setMessage(scope==='chain'?'Current chain discarded. The next chain will open when ready.':'Progress reset. A new chain is being prepared.');
  }catch{setMessage('Could not reset. Try again.');}finally{setBusy(false);}};
  return <div className="parser-block"><p className="parser-muted">{scope==='chain'?'Discard the current chain. Saved answers and progress remain.':scope==='core'?'Clear completion and streaks for the current core and discard pending chains. Earlier cores and answer history remain.':'Clear completion and streaks for every core and restart Core 1. Answer history remains.'}</p>
    <button type="button" className="secondary-action" disabled={busy} onClick={()=>void reset()}>{busy?'Resetting…':'Reset'}</button>
    {message?<p role="status">{message}</p>:null}
  </div>;
}
