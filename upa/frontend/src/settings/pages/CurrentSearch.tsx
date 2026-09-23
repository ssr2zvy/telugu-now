import { ChevronRight } from 'lucide-react';
import type { ParsingDiagnostics, SearchAttempt } from '../../../../shared/parsing-diagnostics';
import { chainWord, targetUnicode } from '../parser-display';
import { ParserLinks, type ParserNavigate } from './ParserLinks';

export function CurrentSearch({data,onNavigate,onAttempt}:{data:ParsingDiagnostics;onNavigate:ParserNavigate;onAttempt:(attempt:SearchAttempt)=>void}) {
  const active=data.chainSearches?.flatMap(chain=>chain.searches).find(search=>search.endedAt===null);
  const target=data.targets.find(target=>target.id===active?.targetId);
  return <div className="parser-settings">
    <dl className="parser-metrics">
      <dt>Guider</dt><dd>{data.guider?.generating?'Generating chain':'No chain to generate'}</dd>
      <dt>Searcher</dt><dd>{active?`Searching core ${active.core} · ${targetUnicode(target).join(' · ')||active.word||'…'}`:'No core in queue to search'}</dd>
      <dt>Parser</dt><dd>{active?.stage==='parsing'?'Parsing searches':'No searches to parse'}</dd>
    </dl>
    {data.chainSearches?.map((chain,index)=><section className="parser-block" key={chain.id}>
      <h2>{chain.id===data.currentChain?.id?'Current chain continuation':`Next chain ${index+1}`} · Core {chain.core}</h2>
      <ol className="parser-chain">{chain.searches.map(search=>{
        const selected=data.upcoming?.find(step=>step.cycleId===chain.id && step.targetId===search.targetId);
        return <li key={search.id} className="parser-search-step"><button type="button" className="parser-attempt-link" onClick={()=>onAttempt?.(search)}>
          <span lang="te">{chainWord(search.word,data.targets.find(target=>target.id===search.targetId))}</span>
          <small>{selected?(selected.error?'Audio preparation failed':selected.status==='ready'?'Ready':'Preparing audio'):search.endedAt?(search.word?'Selected':'No selection'):search.stage==='parsing'?'Parsing':'Searching'}</small>
        <ChevronRight size={16} aria-hidden="true"/></button></li>;
      })}</ol>
    </section>)}
    {!data.chainSearches?.length?<p className="parser-muted">No chain queued for search.</p>:null}
    {data.worker.error||data.activity.error?<p role="alert">{data.activity.error??data.worker.error}</p>:null}
    {data.queue.errors.map(error=><p key={error} role="alert">{error}</p>)}
    {onNavigate?<ParserLinks pages={['lastSearchAttempt']} onNavigate={onNavigate}/>:null}
  </div>;
}
