import { useEffect,useState } from 'react';
import type { ProfileStateResponse } from '../../../../shared/contracts';
import { ParsingDiagnostics } from './ParsingDiagnostics';
export function ParsingPage({profileCode,onState}:{profileCode:string;onState:(state:ProfileStateResponse)=>void}){
  const [percent,setPercent]=useState(60),[busy,setBusy]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState(false);
  useEffect(()=>{const abort=new AbortController();
    void fetch(`/api/profiles/${encodeURIComponent(profileCode)}/state`,{signal:abort.signal}).then(async r=>{
      if(!r.ok)throw new Error('Could not load question settings');return r.json() as Promise<ProfileStateResponse>;
    }).then(s=>{if(!abort.signal.aborted)setPercent(Math.round((s.selectionSettings.audioGivenQuestionProbability??0.6)*100));})
      .catch(e=>{if(!abort.signal.aborted)setError(String(e));});return()=>abort.abort();
  },[profileCode]);
  const save=async()=>{setBusy(true);setError('');setSaved(false);try{
    const r=await fetch(`/api/profiles/${encodeURIComponent(profileCode)}/settings`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({audioGivenQuestionProbability:percent/100})});
    if(!r.ok)throw new Error('Could not save question type');
    const response=await fetch(`/api/profiles/${encodeURIComponent(profileCode)}/state`);
    if(!response.ok)throw new Error('Saved, but could not refresh the app');
    onState(await response.json() as ProfileStateResponse);setSaved(true);
  }catch(e){setError(String(e));}finally{setBusy(false);}};
  return <div className="settings-form">
    <p>Every observation is a question. Words are parsed as needed while the next questions are prepared.</p>
    <label>Question type: audio given {percent}% · text given {100-percent}%
      <input type="range" min="0" max="100" step="1" value={percent} onChange={e=>{setPercent(Number(e.target.value));setSaved(false);}} />
    </label>
    <button type="button" disabled={busy} onClick={()=>void save()}>Save question type</button>
    <p>Applies to newly selected questions. Already queued questions keep their type.</p>
    {saved?<p role="status">Saved.</p>:null}{error?<p role="alert">{error}</p>:null}
    <ParsingDiagnostics profileCode={profileCode}/>
  </div>;
}
