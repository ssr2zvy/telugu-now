import type { ParsingDiagnostics } from '../../../../shared/parsing-diagnostics';

export function ParsingStatus({data}:{data:ParsingDiagnostics}) {
  if (!data.worker || !data.queue || data.selectionPolicy !== 'shortest-codepoints-v1') return <section role="alert">
    <h3>Server update incomplete</h3><p>This screen is updated, but the server has not reported the shortest-word selection version. Deploy the updated frontend and backend together.</p>
  </section>;
  const {worker,activity,queue} = data;
  const target = data.targets.find(t=>t.id===activity.target);
  const label = target?.label ?? activity.target;
  const phase = activity.phase;
  return <section aria-label="Next question preparation">
    <h3>Preparing the next questions</h3>
    <p role="status">Parser: {worker.phase==='loading-parser' ? 'loading rules and opening the word cache. This happens automatically; wait here.' : worker.phase==='failed' ? 'stopped with an error.' : worker.phase==='ready' ? 'loaded and ready.' : 'not started yet.'}</p>
    {worker.phase==='ready' ? <p role="status">{phase==='searching' ? `Searching for the shortest matching word for ${label}. ${activity.checked} new words checked in this search.`
      : phase==='awaiting-answers' ? 'Waiting for answers to already selected questions. Continue with your current question.'
      : phase==='completed' ? 'All Core objects are complete.'
      : phase==='blocked' ? 'No usable word and observation were found for the remaining objects under their search rules. This is not loading.'
      : phase==='failed' ? 'Question selection stopped with an error.'
      : phase==='ready' ? 'Word matching for the queued questions is complete.'
      : 'Waiting to select the next question.'}</p> : null}
    <p>{queue.ready} next questions ready · {queue.pending+queue.preparing} selected and preparing audio{queue.failed ? ` · ${queue.failed} need a preparation retry` : ''}.</p>
    {queue.pending+queue.preparing>0 ? <p>These questions already have a matching word. Audio preparation is a separate step.</p> : null}
    {queue.failed>0 ? <p>Open Queue view and choose “Retry unavailable questions” to retry their preparation.</p> : null}
    {phase==='blocked' ? <p>Check the objects with exhausted searches below: their Unicode and length rules, audio availability, and your sentence blacklist can prevent selection. The app retries selection automatically while open.</p> : null}
    {phase==='failed'||worker.phase==='failed' ? <p>The app retries selection automatically while open. If it keeps failing, use the error below to correct the server configuration or data file.</p> : null}
    {worker.error||activity.error ? <p role="alert">{worker.error??activity.error}</p> : null}
    {queue.errors.map(error=><p role="alert" key={error}>Audio preparation: {error}</p>)}
    <small>Matched-word diagnostics v2 · Core 1: random among five shortest observations</small>
  </section>;
}
