import type { ParsingDiagnostics } from '../../../../shared/parsing-diagnostics';
import { chainWord } from '../parser-display';
import { ParsingStatus } from './ParsingStatus';
export function CurrentSearch({data}:{data:ParsingDiagnostics}) {
  const search=data.activeSearch;
  return <div className="parser-settings">
    <ParsingStatus data={data}/>
    {search ? <div className="parser-block"><p>Current search target</p><p lang="te">{chainWord(null,data.targets.find(target=>target.id===search.targetId))}</p><p className="parser-muted">Unicode forms or an inventory example. Started {new Date(search.startedAt).toLocaleTimeString()} · {search.checked} words checked</p></div> : null}
    <div className="parser-block"><h2>Next selections</h2>
      {data.upcoming?.length ? <ol className="parser-chain">{data.upcoming.map((step,index)=><li key={step.observationId}>
        <span lang="te">{index+1}. {chainWord(step.word,data.targets.find(target=>target.id===step.targetId))}</span>
        <small>{step.error ? 'Retry needed' : step.status==='ready' ? 'Ready' : 'Preparing'}</small>
      </li>)}</ol> : <p className="parser-muted">No next selections saved yet.</p>}
      <p className="parser-muted">Saved order. Further connections are chosen as matching words are found.</p>
      {data.upcoming?.some(step=>step.cycleId!==data.currentChain?.id) ? <p className="parser-muted">The next selections include a new chain.</p> : null}
    </div>
  </div>;
}
