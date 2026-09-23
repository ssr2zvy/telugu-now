import { useState } from 'react';
import { resetQueue } from '../../api';
import type { ProfileStateResponse } from '../../../../shared/contracts';
export function ResetChain({profileCode,onState}:{profileCode:string;onState?:(state:ProfileStateResponse)=>void}) {
  const [busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const reset=async()=>{if(busy)return;setBusy(true);setMessage('');try{
    const state=await resetQueue(profileCode,{visible:false});onState?.(state);setMessage('Current chain discarded. The next chain will open when ready.');
  }catch{setMessage('Could not reset. Try again.');}finally{setBusy(false);}};
  return <div className="parser-block"><p className="parser-muted">Discard the current chain and its unused selections. Continue with the next prepared chain, or wait for it. Saved answers and progress remain.</p>
    <button type="button" className="secondary-action" disabled={busy} onClick={()=>void reset()}>{busy?'Resetting…':'Reset'}</button>
    {message?<p role="status">{message}</p>:null}
  </div>;
}
