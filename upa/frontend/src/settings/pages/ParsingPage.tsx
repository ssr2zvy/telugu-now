import { useEffect, useState } from 'react';
import type { ProfileStateResponse } from '../../../../shared/contracts';
export function ParsingPage({profileCode,onState}:{profileCode:string;onState:(state:ProfileStateResponse)=>void}) {
  const [percent,setPercent] = useState<number | null>(null), [busy,setBusy] = useState(false);
  const [error,setError] = useState(''), [saved,setSaved] = useState(false);
  const [retry,setRetry] = useState(0);
  useEffect(() => {
    const abort = new AbortController(); setError('');
    void fetch(`/api/profiles/${encodeURIComponent(profileCode)}/state`,{signal:abort.signal}).then(async response => {
      if(!response.ok) throw new Error('Could not load questions.'); return response.json() as Promise<ProfileStateResponse>;
    }).then(state => {if(!abort.signal.aborted)setPercent(Math.round((state.selectionSettings.audioGivenQuestionProbability ?? .6) * 100));})
      .catch(() => {if(!abort.signal.aborted)setError('Could not load questions.');});
    return () => abort.abort();
  },[profileCode,retry]);
  const save = async () => {
    if(percent === null || busy) return;
    setBusy(true); setError(''); setSaved(false);
    try {
      const response = await fetch(`/api/profiles/${encodeURIComponent(profileCode)}/settings`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({audioGivenQuestionProbability:percent / 100})});
      if(!response.ok) throw new Error('Could not save.');
      const next = await fetch(`/api/profiles/${encodeURIComponent(profileCode)}/state`);
      if(!next.ok) throw new Error('Saved. Reopen Questions to reload.');
      onState(await next.json() as ProfileStateResponse); setSaved(true);
    } catch(caught) {setError(caught instanceof Error ? caught.message : 'Could not save.');}
    finally {setBusy(false);}
  };
  return <div className="parser-settings question-mix">
    {percent === null ? <p role="status">{error || 'Loading questions…'}</p> : <>
      <label htmlFor="question-mix">Question mix</label>
      <div className="parser-line"><span>Audio given <strong>{percent}%</strong></span><span>Text given <strong>{100 - percent}%</strong></span></div>
      <input id="question-mix" type="range" min="0" max="100" step="1" value={percent} disabled={busy}
        aria-valuetext={`${percent}% audio given, ${100 - percent}% text given`}
        onChange={event => {setPercent(Number(event.target.value));setSaved(false);setError('');}}/>
      <p className="parser-muted">Applies to new selections. Queued questions keep their type.</p>
      <button type="button" className="primary-action" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save'}</button>
      {saved ? <p role="status">Saved</p> : null}
      {error ? <p role="alert">{error}</p> : null}
    </>}
    {percent === null && error ? <button type="button" className="secondary-action" onClick={() => setRetry(value => value + 1)}>Retry</button> : null}
  </div>;
}
