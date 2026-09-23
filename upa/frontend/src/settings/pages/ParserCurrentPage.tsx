import { CurrentSearch } from './CurrentSearch';
import { ResetChain } from './ResetChain';
import type { DisplayObservation, ProfileStateResponse } from '../../../../shared/contracts';
import { useParsingDiagnostics } from '../useParsingDiagnostics';
import { completion, chainWord } from '../parser-display';
import { matchedWordEvidence } from './SelectedWordMatch';
import { ParserSection } from './ParserSection';

export function ParserCurrentPage({profileCode,observation,onState}:{profileCode:string;observation:DisplayObservation|null;onState?:(state:ProfileStateResponse)=>void}) {
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
      <ParserSection title="Chain" summary={data.currentChain ? `Core ${data.currentChain.core} · ${data.currentChain.steps.length} steps` : 'No saved chain'}>
        {data.currentChain ? <ol className="parser-chain">{data.currentChain.steps.map(step => {
          const word = chainWord(step.word,data.targets.find(target => target.id === step.targetId));
          const isCurrent = step.observationId === data.currentChain?.currentObservationId;
          return <li key={step.observationId} aria-current={isCurrent ? 'step' : undefined}>
            <span lang="te">{word}</span>
            <small>{isCurrent ? 'Current' : step.answered ? 'Answered' : step.displayed ? 'Shown' : 'Queued'}</small>
          </li>;
        })}</ol> : <p className="parser-muted">No chain recorded for this observation.</p>}
        {data.currentChain?.endReason ? <p className="parser-muted">Chain ended.</p> : null}
      </ParserSection>
      <ParserSection title="Search" summary={`${data.queue.ready} ready · ${data.queue.pending + data.queue.preparing} preparing`}><CurrentSearch data={data}/></ParserSection>
      <ParserSection title="Reset"><ResetChain profileCode={profileCode} {...(onState?{onState}:{})}/></ParserSection>
      {!data.progressError ? <ParserSection title="Progress by core" summary="Three consecutive correct answers per object">
        {data.levels.map(level => <div className="parser-block" key={level.core}>
          <div className="parser-line"><span>Core {level.core}</span><span>{level.mastered} / {level.total}</span></div>
          <progress value={level.mastered} max={level.total || 1} aria-label={`Core ${level.core} completion`}/>
        </div>)}
        <p className="parser-muted">An incorrect answer resets that object’s streak. Chain entries show saved matched words in selection order.</p>
      </ParserSection> : null}
    </>}
  </div>;
}
