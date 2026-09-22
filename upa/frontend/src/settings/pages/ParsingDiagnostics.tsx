import { useEffect, useState } from 'react';
import type { ParsingDiagnostics as Diagnostics, TargetDiagnostic, DiagnosticEvent } from '../../../../shared/parsing-diagnostics';

const percentage=(n:number|null)=>n===null?'Unavailable':`${n.toFixed(1)}%`;
const count=(n:number|null)=>n===null?'—':n.toLocaleString();
const eventNames:Record<string,string>={
  'walk-started':'Random start','walk-closed':'Movement chain ended','walk-truncated':'Movement chain shortened',
  'walk-blocked':'No available random start','observation-selected':'Queued','observation-prepared':'Prepared',
  'observation-displayed':'Displayed','answer-recorded':'Answer saved','progress-applied':'Progress applied',
  'observation-replaced':'Observation replaced','observation-discarded':'Reservation discarded',
  'batch-applied':'Batch applied','core-advanced':'Core complete','legacy-observation':'Earlier retained observation',
};
function RareTargets({kind,rows,rank}:{kind:'vocabulary'|'chain';rows:TargetDiagnostic[];rank:'corpusTexts'|'displayed'}) {
  const sorted=rows.filter(t=>t.kind===kind).sort((a,b)=>(a[rank]??Infinity)-(b[rank]??Infinity)||(a.id<b.id?-1:a.id>b.id?1:0)).slice(0,30);
  return <details><summary>30 least-appearing {kind==='vocabulary'?'vocabulary targets':'modifier-chain targets'}</summary>
    <p>Zero appearances come first. {rank==='corpusTexts'?'Ranked by distinct accepted corpus sentences.':'Ranked by distinct observations first displayed to this profile.'}</p>
    <div style={{overflowX:'auto'}}><table className="diagnostic-table">
      <caption>{kind==='vocabulary'?'Vocabulary':'Complete modifier chains'} — {sorted.length} of {rows.filter(t=>t.kind===kind).length} targets</caption>
      <thead><tr><th scope="col">Target</th><th scope="col">Corpus sentences</th><th scope="col">Source rows</th><th scope="col">Audio references</th><th scope="col">Selected</th><th scope="col">Displayed</th><th scope="col">Answered</th><th scope="col">True streak</th></tr></thead>
      <tbody>{sorted.map(t=><tr key={t.id}><th scope="row">{t.label}<br /><small>{t.forms.join(' / ') || t.chain.join(' → ') || t.chainAlternatives.map(c=>c.join(' → ')).join(' / ')}</small><details><summary>Target ID</summary><code>{t.id}</code></details></th>
        <td>{count(t.corpusTexts)}</td><td>{count(t.corpusRows)}</td><td>{count(t.audioReferenceRows)}</td><td>{count(t.selected)}</td><td>{count(t.displayed)}</td><td>{count(t.answered)}</td><td>{t.streak}/3{t.mastered?' · mastered':''}{t.pendingAnswers?` · ${t.pendingAnswers} pending`:''}</td></tr>)}</tbody>
    </table></div>
  </details>;
}
export function ParsingDiagnostics({profileCode}:{profileCode:string}) {
  const base=`/api/profiles/${encodeURIComponent(profileCode)}/parsing/diagnostics`;
  const [data,setData]=useState<Diagnostics|null>(null),[error,setError]=useState('');
  const [core,setCore]=useState(1),[rank,setRank]=useState<'corpusTexts'|'displayed'>('corpusTexts');
  const [events,setEvents]=useState<DiagnosticEvent[]>([]),[before,setBefore]=useState<number|null>(null);
  const [historyOpen,setHistoryOpen]=useState(false),[historyError,setHistoryError]=useState(''),[loadingHistory,setLoadingHistory]=useState(false);
  const [refresh,setRefresh]=useState(0),[historyRefresh,setHistoryRefresh]=useState(0);
  useEffect(()=>{
    const controller=new AbortController();let running=false,first=true;
    setData(null);setError('');
    const load=async()=>{
      if(running)return;running=true;
      try {const r=await fetch(base,{signal:controller.signal});const d=await r.json() as Diagnostics & {error?:string};
        if(!r.ok)throw new Error(d.error??'Diagnostics unavailable');
        if(!controller.signal.aborted){setData(d);setError('');if(first){setCore(Math.min(3,d.currentCore));first=false;}}
      }catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:'Diagnostics unavailable');}finally{running=false;}
    };
    void load();const timer=setInterval(()=>void load(),5000);
    return()=>{controller.abort();clearInterval(timer);};
  },[base,refresh]);
  useEffect(()=>{
    setEvents([]);setBefore(null);setHistoryError('');
    if(!historyOpen)return;
    const controller=new AbortController();setLoadingHistory(true);
    void fetch(`${base}/events?core=${core}`,{signal:controller.signal}).then(async r=>{
      const d=await r.json() as {events:DiagnosticEvent[];nextBefore:number|null;error?:string};
      if(!r.ok)throw new Error(d.error??'History unavailable');
      if(!controller.signal.aborted){setEvents(d.events);setBefore(d.nextBefore);}
    }).catch(e=>{if(!controller.signal.aborted)setHistoryError(String(e));}).finally(()=>{if(!controller.signal.aborted)setLoadingHistory(false);});
    return()=>controller.abort();
  },[base,core,historyOpen,historyRefresh]);
  // Pagination requests are cancelled when the selected core/profile changes.
  const [olderCursor,setOlderCursor]=useState<number|null>(null);
  useEffect(()=>{
    if(olderCursor===null)return;
    const controller=new AbortController();setLoadingHistory(true);
    void fetch(`${base}/events?core=${core}&before=${olderCursor}`,{signal:controller.signal}).then(async r=>{
      const d=await r.json() as {events:DiagnosticEvent[];nextBefore:number|null;error?:string};
      if(!r.ok)throw new Error(d.error??'History unavailable');
      if(!controller.signal.aborted){setEvents(old=>[...old,...d.events.filter(e=>!old.some(x=>x.seq===e.seq))]);setBefore(d.nextBefore);setHistoryError('');}
    }).catch(e=>{if(!controller.signal.aborted)setHistoryError(String(e));}).finally(()=>{if(!controller.signal.aborted){setLoadingHistory(false);setOlderCursor(null);}});
    return()=>controller.abort();
  },[base,core,olderCursor]);
  return <section aria-labelledby="core-diagnostic-heading" style={{marginTop:'1.5rem'}}>
    <h2 id="core-diagnostic-heading">Core diagnostics</h2>
    <p>Completion means every required target has three consecutive True answers. False resets that target to zero. Answers update progress together when the batch ends.</p>
    <button type="button" onClick={()=>setRefresh(n=>n+1)}>Refresh diagnostics</button>{' '}
    <a href={`${base}/export`} download>Export all Core progress and movement history (JSON)</a>
    <p>The export includes all three cores for this profile, all retained batches and observations, target definitions, parser evidence, queued and displayed states, answers, replacements, and movement reset reasons.</p>
    {error?<p role="alert">{error}{data?' — showing the last successful snapshot.':''}</p>:null}
    {data?<>
      {data.catalogError?<p role="alert">Corpus counts unavailable: {data.catalogError}</p>:null}
      {data.progressError?<p role="alert">{data.progressError} Progress percentages are hidden until the inventory is reconciled.</p>:null}
      {!data.progressError?<div>{data.levels.map(l=><div key={l.core} style={{padding:'0.75rem 0',borderBottom:'1px solid currentColor'}}>
        <h3>Core {l.core} · {l.status} · {percentage(l.percent)} complete</h3>
        <progress aria-label={`Core ${l.core} mastery`} max={l.total||1} value={l.mastered} style={{width:'100%'}} />
        <p><strong>{l.mastered} / {l.total} mastered</strong> · {l.total-l.mastered} remaining</p>
        <p>Vocabulary: {l.vocabulary.mastered}/{l.vocabulary.total} ({percentage(l.vocabulary.percent)})<br />
          Modifier chains: {l.modifiers.mastered}/{l.modifiers.total} ({percentage(l.modifiers.percent)})</p>
        <p>Targets with corpus examples: {count(l.withExamples)} · No examples: {count(l.withoutExamples)} · Answers awaiting batch application: {l.pendingAnswers}</p>
      </div>)}</div>:null}
      <p>Mastery uses the full target inventory, including targets with no examples. Corpus coverage is separate from learning completion. Audio references do not guarantee playable or unused examples.</p>
      <label>Inspect core <select value={core} onChange={e=>{setOlderCursor(null);setCore(Number(e.target.value));}}>{[1,2,3].map(c=><option key={c} value={c}>Core {c}</option>)}</select></label>
      <label>Least appearing by <select value={rank} onChange={e=>setRank(e.target.value as typeof rank)}><option value="corpusTexts">Distinct corpus sentences</option><option value="displayed">Displayed to me</option></select></label>
      <p>Modifier rows are the complete selectable chains in this core, including single modifiers. Their components do not receive separate mastery credit. Reopening an observation does not add another display count.</p>
      <RareTargets kind="vocabulary" rows={data.targets.filter(t=>t.core===core)} rank={rank}/>
      <RareTargets kind="chain" rows={data.targets.filter(t=>t.core===core)} rank={rank}/>
      <details onToggle={e=>setHistoryOpen(e.currentTarget.open)}><summary>Movement chains and loaded observations</summary>
        <p>A movement chain is one batch path. A modifier chain is the grammatical target. Ending a movement chain does not reset target streaks.</p>
        <button type="button" disabled={loadingHistory} onClick={()=>{setOlderCursor(null);setHistoryRefresh(n=>n+1);}}>Refresh history</button>
        {historyError?<p role="alert">{historyError}</p>:null}
        <ol>{events.map(e=><li key={e.seq}><details><summary>{new Date(e.occurred_at).toLocaleString()} · {eventNames[e.type]??e.type}{e.target_id?` · ${e.target_id}`:''}{e.details.reason?` · ${String(e.details.reason)}`:''}</summary>
          <p>Batch: {e.batch_id??'—'} · Slot: {e.slot===null?'—':e.slot+1}<br />Observation: {e.observation_id??'—'}</p>
          <pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{JSON.stringify(e.details,null,2)}</pre>
        </details></li>)}</ol>
        {loadingHistory?<p role="status">Loading history…</p>:!events.length?<p>No recorded events for this core yet.</p>:null}
        {before!==null?<button type="button" disabled={loadingHistory} onClick={()=>setOlderCursor(before)}>Load older events</button>:null}
      </details>
      <p>{data.historyNotice}</p>
      <small>Event recording began {new Date(data.auditStartedAt).toLocaleString()}. Updated {new Date(data.generatedAt).toLocaleString()}.</small>
    </>:!error?<p role="status">Loading Core diagnostics…</p>:null}
  </section>;
}
