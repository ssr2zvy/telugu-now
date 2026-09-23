import type { ParsingDiagnostics } from '../../../../shared/parsing-diagnostics';
import { targetUnicode } from '../parser-display';
export function ParsingStatus({data}:{data:ParsingDiagnostics}) {
  const {worker,activity,queue} = data;
  const target = targetUnicode(data.targets.find(item => item.id === activity.target)).join(' · ');
  const status:Record<string,string> = {
    searching:'Finding a matching word', 'awaiting-answers':'Waiting for answers', completed:'All cores complete',
    blocked:'No usable match under the current search rules', failed:'Selection failed', ready:'Questions selected',
  };
  return <div className="parser-settings">
    <dl className="parser-metrics"><dt>Parser</dt><dd>{worker.phase === 'loading-parser' ? 'Loading' : worker.phase.replaceAll('-',' ')}</dd><dt>Selection</dt><dd>{status[activity.phase] ?? 'Waiting'}</dd><dt>Ready</dt><dd>{queue.ready}</dd><dt>Preparing</dt><dd>{queue.pending + queue.preparing}</dd><dt>Failed</dt><dd>{queue.failed}</dd></dl>
    {target ? <p lang="te">{target}</p> : null}
    {activity.phase === 'searching' ? <p>{activity.checked} new words checked in this search.</p> : null}
    {queue.pending + queue.preparing > 0 ? <p className="parser-muted">Matches found; audio is preparing.</p> : null}
    {queue.failed > 0 ? <p>Retry unavailable questions in Queue.</p> : null}
    {activity.phase === 'blocked' ? <p>Check exhausted searches, Unicode rules, audio availability and the blacklist. Selection retries automatically.</p> : null}
    {worker.error || activity.error ? <p role="alert">{worker.error ?? activity.error}</p> : null}
    {queue.errors.map(error => <p role="alert" key={error}>{error}</p>)}
  </div>;
}
