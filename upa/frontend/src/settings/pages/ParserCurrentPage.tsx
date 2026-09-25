import { ParserLinks, type ParserNavigate } from './ParserLinks';
import type { DisplayObservation, ProfileStateResponse } from '../../../../shared/contracts';
import { useParsingDiagnostics } from '../useParsingDiagnostics';
import { completion } from '../parser-display';
import { matchedWordEvidence } from './SelectedWordMatch';

export function ParserCurrentPage({profileCode,observation,onState,onNavigate}:{onNavigate:ParserNavigate;profileCode:string;observation:DisplayObservation|null;onState?:(state:ProfileStateResponse)=>void}) {
  const {data,error} = useParsingDiagnostics(profileCode);
  const evidence = observation?.grammar ? matchedWordEvidence(observation.grammar.target,observation.text) : null;
  const progress = data ? completion(data) : null;
  const current = data?.levels.find(level => level.core === data.currentCore);
  return <div className="parser-settings">
    {error ? <p role="alert">{error}{data ? ' Showing the last update.' : ''}</p> : null}
    {!data ? <p role="status">Loading current progress…</p> : <>
      <section className="parser-block" aria-label="Completion">
        <div className="parser-line"><h2>{data.currentCore > 3 ? 'Complete' : `Core ${data.currentCore}`}</h2>{!data.progressError ? <span>{progress!.percent}% overall</span> : null}</div>
        {data.progressError ? <p role="alert">{data.progressError}</p> : <>
          <progress value={progress!.done} max={progress!.total || 1} aria-label="Overall completion"/>
          <p className="parser-muted">{progress!.done.toLocaleString()} of {progress!.total.toLocaleString()} objects complete</p>
          {current ? <p>{current.mastered} of {current.total} complete in Core {current.core}</p> : null}
        </>}
      </section>
      <section className="parser-block" aria-label="Current word">
        <h2>Word</h2>
        <p className="parser-word" lang="te">{evidence?.word || '—'}</p>
        {observation ? <p className="parser-sentence" lang="te">{evidence?.parts ? <>{evidence.parts[0]}<mark>{evidence.parts[1]}</mark>{evidence.parts[2]}</> : observation.text}</p> : <p className="parser-muted">No observation loaded.</p>}
        {observation && !evidence?.word ? <p className="parser-muted">No matched word saved for this observation.</p> : null}
      </section>
      <ParserLinks pages={['currentChain','nextChainSearch','currentReset','coreProgress']} onNavigate={onNavigate}/>

    </>}
  </div>;
}
