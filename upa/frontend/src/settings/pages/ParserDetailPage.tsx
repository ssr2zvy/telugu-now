import { useEffect, useState } from 'react';
import type { DisplayObservation, ProfileStateResponse } from '../../../../shared/contracts';
import type { DiagnosticEvent, SearchAttempt } from '../../../../shared/parsing-diagnostics';
import type { SettingsPage } from '../types';
import { useParsingDiagnostics } from '../useParsingDiagnostics';
import { chainWord, targetUnicode } from '../parser-display';
import { CurrentSearch } from './CurrentSearch';
import { SearchAttemptDetails } from './SearchAttemptDetails';
import { ParserLinks, type ParserNavigate } from './ParserLinks';
import { SelectedWordMatch } from './SelectedWordMatch';
import { ResetChain } from './ResetChain';
export function ParserDetailPage({page,profileCode,onNavigate,onState,observation,selectedAttempt,onAttempt}:{selectedAttempt:SearchAttempt|null;onAttempt:(attempt:SearchAttempt)=>void;page:SettingsPage;profileCode:string;onNavigate:ParserNavigate;onState:(state:ProfileStateResponse)=>void;observation:DisplayObservation|null}) {
  const {data,error}=useParsingDiagnostics(profileCode);
  const [query,setQuery]=useState(''),[core,setCore]=useState(1),[filter,setFilter]=useState('all'),[offset,setOffset]=useState(0);
  const [events,setEvents]=useState<DiagnosticEvent[]>([]),[eventsError,setEventsError]=useState('');
  useEffect(()=>{
    if(page!=='parserEvents')return;
    const abort=new AbortController();setEvents([]);setEventsError('');
    void fetch(`/api/profiles/${encodeURIComponent(profileCode)}/parsing/diagnostics/events?core=${core}`,{signal:abort.signal})
      .then(async response=>{if(!response.ok)throw new Error();return response.json() as Promise<{events:DiagnosticEvent[]}>;})
      .then(result=>{if(!abort.signal.aborted)setEvents(result.events);})
      .catch(()=>{if(!abort.signal.aborted)setEventsError('Could not load events.');});
    return ()=>abort.abort();
  },[page,profileCode,core]);
  if(!data)return <p role="status">{error||'Loading…'}</p>;
  let content;
  if(page==='currentReset')content=<ResetChain profileCode={profileCode} onState={onState}/>;
  else if(page==='nextChainSearch'||page==='currentSearches')content=<CurrentSearch data={data} onNavigate={onNavigate} onAttempt={onAttempt}/>;
  else if(page==='searchAttempt')content=<SearchAttemptDetails attempt={data.chainSearches?.flatMap(chain=>chain.searches).find(attempt=>attempt.id===selectedAttempt?.id)??(data.lastAttempt?.id===selectedAttempt?.id?data.lastAttempt:selectedAttempt)}/>;
  else if(page==='lastSearchAttempt')content=<SearchAttemptDetails attempt={data.lastAttempt}/>;
  else if(page==='currentChain')content=data.currentChain?<ol className="parser-chain">{data.currentChain.steps.map(step=><li key={step.observationId} aria-current={step.observationId===data.currentChain?.currentObservationId?'step':undefined}>
    <span lang="te">{chainWord(step.word,data.targets.find(target=>target.id===step.targetId))}</span><small>{step.observationId===data.currentChain?.currentObservationId?'Current':step.answered?'Answered':data.currentChain?.endReason==='chain-discarded'?'Discarded':step.displayed?'Shown':'Queued'}</small>
  </li>)}</ol>:<p>No current chain.</p>;
  else if(page==='coreProgress')content=<>{data.levels.map(level=><section className="parser-block" key={level.core}><div className="parser-line"><span>Core {level.core}</span><span>{level.mastered} / {level.total}</span></div><progress value={level.mastered} max={level.total||1} aria-label={`Core ${level.core}`}/></section>)}<p className="parser-muted">Three consecutive correct answers complete an object. An incorrect answer resets its streak.</p></>;
  else if(page==='allTimeSearches')content=<>
    <h2>This profile</h2><dl className="parser-metrics"><dt>Successful word searches</dt><dd>{data.allTime?.successfulSearches.toLocaleString()??'—'}</dd><dt>Words examined</dt><dd>{data.allTime?.examined.toLocaleString()??'—'}</dd></dl>
    <p className="parser-muted">A successful word search returns a playable match for the requested object. Repeated examinations count again.</p>
    <p className="parser-muted">Examination tracking {data.allTime?.trackedSince?`began ${new Date(data.allTime.trackedSince).toLocaleString()}`:'has not started'}. Older records contain {data.allTime?.legacyEvaluated.toLocaleString()??'—'} fresh parser evaluations; their cached examinations were not recorded.</p>
    <h2>Shared word cache</h2><dl className="parser-metrics"><dt>Words with valid parses</dt><dd>{data.cache?.parsed.toLocaleString()??'—'}</dd><dt>Valid parses</dt><dd>{data.cache?.validParses?.toLocaleString()??'—'}</dd></dl>
    <p className="parser-muted">Distinct words and distinct word-to-object matches across profiles, for the installed parser version. These totals survive redeploys; changing the parser can rebuild its cache.</p>
  </>;
  else if(page==='coverageNotes')content=<><p>Matches count distinct cached words across profiles. Zero can mean an object has not been searched; it does not prove the corpus has none.</p><p>Shown counts and search activity belong to this profile. Other words in a selected sentence are not automatically failed parses.</p><p>Where search forms are unavailable, an inventory example is shown.</p></>;
  else if(page==='objectCoverage'){
    const rows=data.targets.filter(target=>target.core===core&&`${target.label} ${target.id} ${targetUnicode(target).join(' ')}`.toLowerCase().includes(query.toLowerCase())&&(filter==='all'||(filter==='unmatched'?target.matchedWords===0:target.displayed===0))).sort((a,b)=>(a.matchedWords??Infinity)-(b.matchedWords??Infinity)||a.id.localeCompare(b.id));
    content=<><div className="parser-filters"><label>Core<select value={core} onChange={e=>{setCore(Number(e.target.value));setOffset(0);}}>{[1,2,3].map(n=><option key={n} value={n}>{n}</option>)}</select></label><label>Show<select value={filter} onChange={e=>{setFilter(e.target.value);setOffset(0);}}><option value="all">All objects</option><option value="unmatched">No matches</option><option value="unshown">Not shown</option></select></label><label>Find<input type="search" value={query} onChange={e=>{setQuery(e.target.value);setOffset(0);}}/></label></div>
      <p className="parser-muted">{rows.length} objects · Fewest matches first</p>
      {rows.slice(offset,offset+30).map(target=><section className="parser-block" key={target.id}><p lang="te">{targetUnicode(target).join(' · ')||target.label}</p><p className="parser-muted">{target.matchedWords??'—'} matches · {target.displayed} shown · {target.streak}/3{target.mastered?' · Complete':''}</p></section>)}
      <div className="parser-pagination"><button className="secondary-action" disabled={!offset} onClick={()=>setOffset(Math.max(0,offset-30))}>Previous</button><button className="secondary-action" disabled={offset+30>=rows.length} onClick={()=>setOffset(offset+30)}>Next</button></div><ParserLinks pages={['coverageNotes']} onNavigate={onNavigate}/></>;
  }else if(page==='cycleHistory')content=<><p className="parser-muted">{data.cycles.total} chains · {data.cycles.steps} selections. Latest 20 below; download includes all history.</p>{data.recentCycles?.map(cycle=><section className="parser-block" key={cycle.id}><h2>Core {cycle.core}</h2><p className="parser-muted">{new Date(cycle.startedAt).toLocaleString()} · {cycle.endReason?.replaceAll('-',' ')??'Open'}</p><ol>{cycle.words.map((word,index)=><li key={index} lang="te">{word}</li>)}</ol></section>)}</>;
  else if(page==='parserEvents')content=<><ParserLinks pages={['diagnosticsDownload']} onNavigate={onNavigate}/><label>Core <select value={core} onChange={e=>setCore(Number(e.target.value))}>{[1,2,3].map(n=><option key={n}>{n}</option>)}</select></label><p className="parser-muted">Latest 50 events. Download includes all observations, selections, searches and chains.</p>{eventsError?<p role="alert">{eventsError}</p>:null}{events.map(event=><section className="parser-block" key={event.seq}><h2>{event.type.replaceAll('-',' ').replaceAll('_',' ')}</h2><p className="parser-muted">{new Date(event.occurred_at).toLocaleString()}</p>{event.target_id?<p lang="te">{targetUnicode(data.targets.find(target=>target.id===event.target_id)).join(' · ')}</p>:null}</section>)}</>;
  else if(page==='parserDetails')content=<><SelectedWordMatch observation={observation}/><dl className="parser-metrics"><dt>Inventory</dt><dd>{data.inventoryId}</dd><dt>Selection</dt><dd>{data.selectionPolicy}</dd></dl></>;
  return <div className="parser-settings">{error?<p role="alert">{error}</p>:null}{content}</div>;
}
