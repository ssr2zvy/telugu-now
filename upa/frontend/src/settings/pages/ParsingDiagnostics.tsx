import { useEffect,useState } from 'react';
import type { ParsingDiagnostics as Diagnostics, DiagnosticEvent } from '../../../../shared/parsing-diagnostics';
export function ParsingDiagnostics({profileCode}:{profileCode:string}){
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
    <a href={`${base}/export`} download>Download all cycles, searches and progress (JSON)</a>
    {error?<p role="alert">{error}</p>:null}
    {data?<>
      <p role="status">{data.activity.phase}{data.activity.target?` · ${data.activity.target} · ${data.activity.checked} new words checked`:''}</p>
      {data.activity.error||data.catalogError?<p role="alert">{data.activity.error??data.catalogError}</p>:null}
      {data.progressError?<p role="alert">{data.progressError}</p>:null}
      <p>{data.historyNotice}</p>
      {data.cache?<p>{data.cache.checked.toLocaleString()} / {data.cache.total.toLocaleString()} distinct words checked · {data.cache.parsed.toLocaleString()} resolved · {data.cache.rejected.toLocaleString()} could not parse</p>:<p>Loading the word cache…</p>}
      <p>Three consecutive True answers complete an object. False resets its streak. Each answer updates progress immediately; completed objects stay excluded.</p>
      {!data.progressError?data.levels.map(l=><div key={l.core}>
        <h3>Core {l.core}: {l.mastered}/{l.total} complete · {l.status}</h3>
        <progress max={l.total} value={l.mastered} aria-label={`Core ${l.core} completion`}/>
        <p>{l.withExamples??'—'} objects with cached matches · {l.withoutExamples??'—'} with none yet</p>
      </div>):null}
      <h3>Underrepresented objects</h3>
      <p>All objects are listed by distinct cached matching words, fewest first. Search counts distinguish unsearched objects from exhausted searches. These counts do not estimate unseen corpus coverage.</p>
      <label>Core <select value={core} onChange={e=>setCore(Number(e.target.value))}>{[1,2,3].map(n=><option key={n} value={n}>Core {n}</option>)}</select></label>
      <label>Find an object <input value={query} onChange={e=>setQuery(e.target.value)}/></label>
      <div style={{overflowX:'auto',maxHeight:'65vh'}}><table className="diagnostic-table">
        <thead><tr><th>Object</th><th>Matching words</th><th>Searches</th><th>New words checked</th><th>Exhausted searches</th><th>Shown</th><th>True streak</th></tr></thead>
        <tbody>{rows.map(t=><tr key={t.id}><th>{t.label}<details><summary>Search definition</summary><code>{t.id}</code><p>{t.forms.join(' / ')||t.chain.join(' → ')}</p><p>Maximum {t.pattern?.maxCodepoints??'—'} Unicode code points</p><p style={{overflowWrap:'anywhere'}}>{t.pattern?.needles.join(' / ')||'No single-word retrieval forms'}</p></details></th>
          <td>{t.matchedWords??'—'}</td><td>{t.searches}</td><td>{t.checked}</td><td>{t.exhausted}</td><td>{t.displayed}</td><td>{t.streak}/3{t.mastered?' · done':''}</td></tr>)}</tbody>
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
