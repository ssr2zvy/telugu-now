import type { SearchAttempt } from '../../../../shared/parsing-diagnostics';
export function searchStopReason(attempt:SearchAttempt):string {
  const reasons:Record<string,string>={'new-parse':'Match found','cached-parse':'Cached match found',exhausted:'Candidates exhausted','chain-discarded':'Chain discarded','process-restarted':'Server restarted','worker-error':'Search or parser failed','manual-retry':'Search restarted'};
  if(attempt.error?.toLowerCase().includes('timed out'))return 'Parser timed out';
  return attempt.outcome ? reasons[attempt.outcome]??attempt.outcome : 'Still running';
}
export function SearchAttemptDetails({attempt}:{attempt:SearchAttempt|null|undefined}) {
  if(!attempt)return <p className="parser-muted">No completed attempt recorded.</p>;
  const count=(value:number|null)=>value===null?'Not recorded':value.toLocaleString();
  return <div className="parser-block"><dl className="parser-metrics">
    <dt>Started</dt><dd>{new Date(attempt.startedAt).toLocaleString()}</dd>
    <dt>Finished</dt><dd>{attempt.endedAt?new Date(attempt.endedAt).toLocaleString():'Still running'}</dd>
    <dt>Search request</dt><dd>{attempt.searchSucceeded===null?'Not recorded':attempt.searchSucceeded?'Success':'Failure'}</dd>
    <dt>Words returned</dt><dd>{count(attempt.returned)}</dd>
    <dt>Words examined</dt><dd>{count(attempt.examined)}</dd>
    <dt>Words evaluated by parser</dt><dd>{count(attempt.checked)}</dd>
    <dt>Words parsed successfully</dt><dd>{count(attempt.parsed)}</dd>
    <dt>Cached results examined</dt><dd>{count(attempt.reused)}</dd>
    <dt>Words matching this object</dt><dd>{count(attempt.matching)}</dd>
    <dt>Stopped because</dt><dd>{searchStopReason(attempt)}</dd>
  </dl>{attempt.word?<p lang="te">{attempt.word}</p>:null}{attempt.error?<p role="alert">{attempt.error}</p>:null}</div>;
}
