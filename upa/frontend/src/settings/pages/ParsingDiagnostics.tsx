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

export function ParsingDiagnostics({profileCode,onDownload}:{profileCode:string;onDownload?:()=>void}) {
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
      <section className="parser-block" aria-label="Coverage">
        <div className="parser-line"><h2>Coverage</h2><span>Fewest matches first</span></div>
        <div className="parser-filters">
          <label>Core<select value={core} onChange={event => {setCore(Number(event.target.value));setPage(0);}}>{[1,2,3].map(value => <option key={value} value={value}>Core {value}</option>)}</select></label>
          <label>Show<select value={filter} onChange={event => {setFilter(event.target.value);setPage(0);}}><option value="all">All objects</option><option value="unmatched">No matches</option><option value="unshown">Not shown</option></select></label>
          <label className="parser-search">Find<input type="search" value={query} onChange={event => {setQuery(event.target.value);setPage(0);}} placeholder="Word or object"/></label>
        </div>
        <p className="parser-muted">{data.cache ? `${targets.filter(target => target.matchedWords === 0).length} without matches` : 'Match counts unavailable'} · {targets.filter(target => target.displayed === 0).length} not shown</p>
        <div className="parser-targets">{rows.slice(visiblePage * 30,(visiblePage + 1) * 30).map(target => {
          const forms = targetUnicode(target);
          return <ParserSection key={target.id} title={forms.join(' · ') || 'Unicode unavailable'} summary={`${target.matchedWords ?? '—'} matches · ${target.displayed} shown · ${target.streak}/3${target.mastered ? ' · Complete' : ''}`}>
            <dl className="parser-metrics"><dt>Searches</dt><dd>{target.searches}</dd><dt>Words checked</dt><dd>{target.checked}</dd><dt>Exhausted</dt><dd>{target.exhausted}</dd><dt>Selected / answered</dt><dd>{target.selected} / {target.answered}</dd><dt>Maximum length</dt><dd>{target.pattern?.maxCodepoints ?? '—'} code points</dd></dl>
            <p lang="te">{target.pattern?.needles.join(' · ')}</p>
            <p className="parser-muted">{target.label}</p><code>{target.id}</code>
            {target.chain.length ? <p className="parser-muted">{target.chain.join(' → ')}</p> : null}
          </ParserSection>;
        })}</div>
        {!rows.length ? <p className="parser-muted">No objects match these filters.</p> : null}
        {pages > 1 ? <div className="parser-pagination"><button type="button" className="secondary-action" disabled={visiblePage === 0} onClick={() => setPage(visiblePage - 1)}>Previous</button><span>{visiblePage + 1} / {pages}</span><button type="button" className="secondary-action" disabled={visiblePage + 1 >= pages} onClick={() => setPage(visiblePage + 1)}>Next</button></div> : null}
      </section>
      <ParserSection title="Coverage notes" summary="Counts reflect checked words">
        <p>Matches count distinct cached words across profiles. Zero matches can mean an object has not been searched yet; it does not prove the corpus has none.</p>
        <p>Shown counts and searches belong to this profile. Other words in a selected sentence are not marked as failed parses.</p>
        <p>{data.historyNotice}</p>
      </ParserSection>
      <ParserSection title="Preparation" summary={`${data.queue.ready} ready · ${data.queue.pending + data.queue.preparing} preparing`}><ParsingStatus data={data}/></ParserSection>
      <ParserSection title="Word cache" summary={data.cache ? `${data.cache.checked.toLocaleString()} checked` : 'Not available'}>
        {data.cache ? <dl className="parser-metrics"><dt>Total words</dt><dd>{data.cache.total.toLocaleString()}</dd><dt>Checked</dt><dd>{data.cache.checked.toLocaleString()}</dd><dt>Parsed</dt><dd>{data.cache.parsed.toLocaleString()}</dd><dt>Could not parse</dt><dd>{data.cache.rejected.toLocaleString()}</dd></dl> : <p>Counts appear when the frequency database is open.</p>}
      </ParserSection>
      <ParserSection title="Connection cycles" summary={`${data.cycles.total} cycles · ${data.cycles.steps} selections`}>
        <dl className="parser-metrics"><dt>Active</dt><dd>{data.cycles.active}</dd>{data.cycles.reasons.map(reason => <div className="parser-metric-pair" key={reason.reason}><dt>{reason.reason.replaceAll('_',' ').replaceAll('-',' ')}</dt><dd>{reason.count}</dd></div>)}</dl>
      </ParserSection>
      <details className="parser-section" onToggle={event => setEventsOpen(event.currentTarget.open)}><summary>Events · Core {core}</summary><div className="parser-section-body">{eventsOpen ? <RecentEvents profileCode={profileCode} core={core}/> : null}</div></details>
      <ParserSection title="Technical details"><dl className="parser-metrics"><dt>Inventory</dt><dd>{data.inventoryId ?? '—'}</dd><dt>Selection</dt><dd>{data.selectionPolicy}</dd><dt>History started</dt><dd>{new Date(data.auditStartedAt).toLocaleString()}</dd></dl>{data.catalogError ? <p role="alert">{data.catalogError}</p> : null}{data.progressError ? <p role="alert">{data.progressError}</p> : null}</ParserSection>
      {onDownload ? <button type="button" className="secondary-action" onClick={onDownload}>Download</button> : null}
      <p className="parser-muted">Updated {new Date(data.generatedAt).toLocaleTimeString()}</p>
    </>}
  </div>;
}
