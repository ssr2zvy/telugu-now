import { useEffect,useState } from 'react';
import { ParsingStatus } from './ParsingStatus';
import type { ParsingDiagnostics as Diagnostics, DiagnosticEvent } from '../../../../shared/parsing-diagnostics';
export function ParsingDiagnostics({profileCode,onDownload}:{profileCode:string;onDownload?:()=>void}){
  const base=`/api/profiles/${encodeURIComponent(profileCode)}/parsing/diagnostics`;
  const [data,setData]=useState<Diagnostics|null>(null),[error,setError]=useState(''),[core,setCore]=useState(1);
  const [events,setEvents]=useState<DiagnosticEvent[]>([]),[query,setQuery]=useState('');
  useEffect(()=>{const abort=new AbortController();let running=false;
    const load=async()=>{if(running)return;running=true;try{
      const response=await fetch(base,{signal:abort.signal});if(!response.ok)throw new Error('Diagnostics unavailable');
      const value=await response.json() as Diagnostics;
      const history=await fetch(`${base}/events?core=${core}`,{signal:abort.signal});if(!history.ok)throw new Error('History unavailable');
      const h=await history.json() as {events:DiagnosticEvent[]};
      if(!abort.signal.aborted){setData(value);setEvents(h.events);setError('');}
    }catch(e){if(!abort.signal.aborted)setError(String(e));}finally{running=false;}};
    void load();const timer=setInterval(()=>void load(),3000);return()=>{abort.abort();clearInterval(timer);};
  },[base,core]);
  const rows=data?.targets.filter(t=>t.core===core&&`${t.label} ${t.id} ${t.forms.join(' ')}`.toLowerCase().includes(query.toLowerCase()))
    .sort((a,b)=>(a.matchedWords??Infinity)-(b.matchedWords??Infinity)||a.id.localeCompare(b.id))??[];
  return <section aria-label="Live parsing diagnostics">
    <h2>Live parsing diagnostics</h2>
    <button type="button" onClick={onDownload}>Download full diagnostics</button>
    {error?<p role="alert">Could not update diagnostics. Retrying automatically every three seconds. {data?'The figures below are from the last successful update.':''} {error}</p>:null}
    {data?<>
      <h3>This observation’s connection chain</h3>
      {data.currentChain ? <>
        <p>Core {data.currentChain.core} · {data.currentChain.endReason?'Chain ended':'Chain open'} · {data.currentChain.steps.length} selections</p>
        <ol>{data.currentChain.steps.map(s=><li key={s.observationId} aria-current={s.observationId===data.currentChain?.currentObservationId?'step':undefined}>
          <strong>{s.label}</strong> — <span lang="te">{s.word??'Word not saved'}</span> · {s.observationId===data.currentChain?.currentObservationId?'current observation':s.answered?'answered':s.displayed?'shown':'queued'}
        </li>)}</ol>
      </> : <p>No connection chain was saved for the current observation.</p>}
      <ParsingStatus data={data}/>
      {data.progressError?<p role="alert">{data.progressError}</p>:null}
      <p>{data.historyNotice}</p>
      {data.cache?<p>{data.cache.checked.toLocaleString()} / {data.cache.total.toLocaleString()} distinct words checked · {data.cache.parsed.toLocaleString()} resolved · {data.cache.rejected.toLocaleString()} could not parse</p>:<p>Word counts will appear after the parser opens the frequency database.</p>}
      <p>These cache totals cover words checked across all selections. They do not classify the other words in your current sentence.</p>
      <p>Three consecutive True answers complete an object. False resets its streak. Each answer updates progress immediately; completed objects stay excluded.</p>
      {!data.progressError?data.levels.map(l=><div key={l.core}>
        <h3>Core {l.core}: {l.mastered}/{l.total} complete · {l.status}</h3>
        <progress max={l.total} value={l.mastered} aria-label={`Core ${l.core} completion`}/>
        <p>{l.withExamples??'—'} objects with cached matches · {l.withoutExamples??'—'} with none yet</p>
      </div>):null}
      <h3>Objects not yet represented and underrepresented</h3>
      <p>Core {core}: {data.cache?`${rows.filter(t=>t.matchedWords===0).length} objects have no cached word match`:'Word match counts are loading'} · {rows.filter(t=>t.displayed===0).length} have not been shown yet{query?' (filtered list)':''}.</p>
      <p>All objects are listed by distinct cached matching words, fewest first. Search counts distinguish unsearched objects from exhausted searches. These counts do not estimate unseen corpus coverage.</p>
      <label>Core <select value={core} onChange={e=>setCore(Number(e.target.value))}>{[1,2,3].map(n=><option key={n} value={n}>Core {n}</option>)}</select></label>
      <label>Find an object <input value={query} onChange={e=>setQuery(e.target.value)}/></label>
      <div style={{overflowX:'auto',maxHeight:'65vh'}}><table className="diagnostic-table">
        <thead><tr><th>Object</th><th>Matching words</th><th>Searches</th><th>New words checked</th><th>Exhausted searches</th><th>Shown</th><th>True streak</th></tr></thead>
        <tbody>{rows.map(t=><tr key={t.id}><th>{t.label}<details><summary>Search definition</summary><code>{t.id}</code><p>{t.forms.join(' / ')||t.chain.join(' → ')}</p><p>Maximum {t.pattern?.maxCodepoints??'—'} Unicode code points</p><p style={{overflowWrap:'anywhere'}}>{t.pattern?.needles.join(' / ')||'No single-word retrieval forms'}</p></details></th>
          <td>{t.matchedWords??'—'}{t.matchedWords===0?' · no match yet':''}</td><td>{t.searches}</td><td>{t.checked}</td><td>{t.exhausted}</td><td>{t.displayed}{t.displayed===0?' · not shown':''}</td><td>{t.streak}/3{t.mastered?' · done':''}</td></tr>)}</tbody>
      </table></div>
      <h3>Connection cycles</h3>
      <p>{data.cycles.total} cycles · {data.cycles.active} active · {data.cycles.steps} selected steps</p>
      <ul>{data.cycles.reasons.map(r=><li key={r.reason}>{r.reason}: {r.count}</li>)}</ul>
      <details><summary>Latest 50 events for Core {core}</summary>
        <p>The download contains all recorded cycles and searches, including those from previous app sessions.</p>
        <ol>{events.map(e=><li key={e.seq}><details><summary>{new Date(e.occurred_at).toLocaleString()} · {e.type}{e.target_id?` · ${e.target_id}`:''}</summary><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{JSON.stringify(e.details,null,2)}</pre></details></li>)}</ol>
      </details>
      <small>Updated {new Date(data.generatedAt).toLocaleTimeString()}</small>
    </>:!error?<p role="status">Loading diagnostics…</p>:null}
  </section>;
}
