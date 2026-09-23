import type { DisplayObservation } from '../../../../shared/contracts';
import { CurrentSearch } from './CurrentSearch';
import { SelectedWordMatch } from './SelectedWordMatch';
import { useEffect, useState } from 'react';
import type { DiagnosticEvent } from '../../../../shared/parsing-diagnostics';
import { useParsingDiagnostics } from '../useParsingDiagnostics';
import { targetUnicode } from '../parser-display';
import { ParserSection } from './ParserSection';
import { ParsingStatus } from './ParsingStatus';

function RecentEvents({profileCode,core}:{profileCode:string;core:number}) {
  const [events,setEvents] = useState<DiagnosticEvent[]>([]);
  const [error,setError] = useState('');
  useEffect(() => {
    const abort = new AbortController();
    setEvents([]); setError('');
    void fetch(`/api/profiles/${encodeURIComponent(profileCode)}/parsing/diagnostics/events?core=${core}`,{signal:abort.signal})
      .then(async response => {if(!response.ok) throw new Error(); return response.json() as Promise<{events:DiagnosticEvent[]}>;})
      .then(result => {if(!abort.signal.aborted)setEvents(result.events);})
      .catch(() => {if(!abort.signal.aborted)setError('Could not load events. Reopen to retry.');});
    return () => abort.abort();
  },[profileCode,core]);
  return <>{error ? <p role="alert">{error}</p> : null}<p className="parser-muted">Latest 50 events. The download includes all recorded history.</p>
    {events.map(event => <ParserSection key={event.seq} title={event.type.replaceAll('_',' ')} summary={new Date(event.occurred_at).toLocaleString()}>
      <pre>{JSON.stringify(event,null,2)}</pre>
    </ParserSection>)}{!events.length && !error ? <p className="parser-muted">No events loaded yet.</p> : null}</>;
}

export function ParsingDiagnostics({profileCode,onDownload,observation}:{profileCode:string;onDownload?:()=>void;observation?:DisplayObservation|null}) {
  const {data,error} = useParsingDiagnostics(profileCode);
  const [core,setCore] = useState(1), [query,setQuery] = useState('');
  const [filter,setFilter] = useState('all'), [page,setPage] = useState(0), [eventsOpen,setEventsOpen] = useState(false);
  const targets = data?.targets.filter(target => target.core === core) ?? [];
  const rows = targets.filter(target => `${target.label} ${target.id} ${targetUnicode(target).join(' ')}`.toLowerCase().includes(query.toLowerCase())
    && (filter === 'all' || (filter === 'unmatched' ? target.matchedWords === 0 : target.displayed === 0)))
    .sort((a,b) => (a.matchedWords ?? Infinity) - (b.matchedWords ?? Infinity) || a.id.localeCompare(b.id));
  const pages = Math.max(1,Math.ceil(rows.length / 30));
  const visiblePage = Math.min(page,pages - 1);
  return <div className="parser-settings">
    {error ? <p role="alert">{error}{data ? ' Showing the last update.' : ''}</p> : null}
    {!data ? <p role="status">Loading diagnostics…</p> : <>
      <ParserSection title="Object coverage" summary="Matches and representation">
        <div className="parser-line"><h2>Coverage</h2><span>Fewest matches first</span></div>
        <div className="parser-filters">
          <label>Core<select value={core} onChange={event => {setCore(Number(event.target.value));setPage(0);}}>{[1,2,3].map(value => <option key={value} value={value}>Core {value}</option>)}</select></label>
          <label>Show<select value={filter} onChange={event => {setFilter(event.target.value);setPage(0);}}><option value="all">All objects</option><option value="unmatched">No matches</option><option value="unshown">Not shown</option></select></label>
          <label className="parser-search">Find<input type="search" value={query} onChange={event => {setQuery(event.target.value);setPage(0);}} placeholder="Word or object"/></label>
        </div>
        <p className="parser-muted">{data.cache ? `${targets.filter(target => target.matchedWords === 0).length} without matches` : 'Match counts unavailable'} · {targets.filter(target => target.displayed === 0).length} not shown</p>
        <div className="parser-targets">{rows.slice(visiblePage * 30,(visiblePage + 1) * 30).map(target => {
          const forms = targetUnicode(target);
          return <ParserSection key={target.id} title={forms.join(' · ') || 'Unicode unavailable'} summary={`${!target.forms.length && !target.pattern?.needles.length ? 'Example · ' : ''}${target.matchedWords ?? '—'} matches · ${target.displayed} shown · ${target.streak}/3${target.mastered ? ' · Complete' : ''}`}>
            <dl className="parser-metrics"><dt>Searches</dt><dd>{target.searches}</dd><dt>Words checked</dt><dd>{target.checked}</dd><dt>Exhausted</dt><dd>{target.exhausted}</dd><dt>Selected / answered</dt><dd>{target.selected} / {target.answered}</dd><dt>Maximum length</dt><dd>{target.pattern?.maxCodepoints ?? '—'} code points</dd></dl>
            <p lang="te">{target.pattern?.needles.join(' · ')}</p>
            <p className="parser-muted">{target.label}</p><code>{target.id}</code>
            {target.chain.length ? <p className="parser-muted">{target.chain.join(' → ')}</p> : null}
          </ParserSection>;
        })}</div>
        {!rows.length ? <p className="parser-muted">No objects match these filters.</p> : null}
        {pages > 1 ? <div className="parser-pagination"><button type="button" className="secondary-action" disabled={visiblePage === 0} onClick={() => setPage(visiblePage - 1)}>Previous</button><span>{visiblePage + 1} / {pages}</span><button type="button" className="secondary-action" disabled={visiblePage + 1 >= pages} onClick={() => setPage(visiblePage + 1)}>Next</button></div> : null}
      <ParserSection title="Coverage notes" summary="Counts reflect checked words">
        <p>Matches count distinct cached words across profiles. Zero matches can mean an object has not been searched yet; it does not prove the corpus has none.</p>
        <p>Shown counts and searches belong to this profile. Other words in a selected sentence are not marked as failed parses.</p>
        <p>{data.historyNotice}</p>
      </ParserSection>
      </ParserSection>
      <ParserSection title="Search and parse" summary={data.activity.phase.replaceAll('-',' ')}>
      <CurrentSearch data={data}/>
      {data.searchTotals ? <dl className="parser-metrics"><dt>Searches</dt><dd>{data.searchTotals.total}</dd><dt>Words checked</dt><dd>{data.searchTotals.checked}</dd><dt>Matched searches</dt><dd>{data.searchTotals.matched}</dd><dt>Exhausted</dt><dd>{data.searchTotals.exhausted}</dd><dt>Interrupted</dt><dd>{data.searchTotals.interrupted}</dd></dl> : null}
      <ParserSection title="Word cache" summary={data.cache ? `${data.cache.checked.toLocaleString()} checked` : 'Not available'}>
        {data.cache ? <dl className="parser-metrics"><dt>Total words</dt><dd>{data.cache.total.toLocaleString()}</dd><dt>Checked</dt><dd>{data.cache.checked.toLocaleString()}</dd><dt>Parsed</dt><dd>{data.cache.parsed.toLocaleString()}</dd><dt>Could not parse</dt><dd>{data.cache.rejected.toLocaleString()}</dd></dl> : <p>Counts appear when the frequency database is open.</p>}
      </ParserSection>
      <ParserSection title="Selection details"><SelectedWordMatch observation={observation ?? null}/></ParserSection>
      <ParserSection title="Technical details"><dl className="parser-metrics"><dt>Inventory</dt><dd>{data.inventoryId ?? '—'}</dd><dt>Selection</dt><dd>{data.selectionPolicy}</dd></dl>{data.catalogError ? <p role="alert">{data.catalogError}</p> : null}{data.progressError ? <p role="alert">{data.progressError}</p> : null}</ParserSection>
      </ParserSection>
      <ParserSection title="Cycle history" summary={`${data.cycles.total} chains · ${data.cycles.steps} selections`}>
        <p className="parser-muted">Latest 20 chains. Full history is in the event download.</p>
        {data.recentCycles?.map(cycle=><ParserSection key={cycle.id} title={`Core ${cycle.core} · ${new Date(cycle.startedAt).toLocaleString()}`} summary={cycle.endReason?.replaceAll('-',' ') ?? 'Open'}>
          <ol className="parser-chain">{cycle.words.map((word,index)=><li key={index} lang="te">{word}</li>)}</ol>
          {!cycle.words.length?<p className="parser-muted">No selections in this chain.</p>:null}
        </ParserSection>)}
      </ParserSection>
      <details className="parser-section" onToggle={event => setEventsOpen(event.currentTarget.open)}><summary>Events</summary><div className="parser-section-body">
        <label>Core <select value={core} onChange={event=>setCore(Number(event.target.value))}>{[1,2,3].map(value=><option key={value} value={value}>{value}</option>)}</select></label>
        {onDownload ? <button type="button" className="secondary-action" onClick={onDownload}>Download all history</button> : null}
        {eventsOpen ? <RecentEvents profileCode={profileCode} core={core}/> : null}
      </div></details>
      <p className="parser-muted">Updated {new Date(data.generatedAt).toLocaleTimeString()}</p>
    </>}
  </div>;
}
