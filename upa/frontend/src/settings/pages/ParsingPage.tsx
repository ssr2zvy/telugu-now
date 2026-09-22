import { ParsingDiagnostics } from './ParsingDiagnostics';
import { useEffect, useRef, useState } from 'react';
import type { ProfileStateResponse } from '../../../../shared/contracts';
import type { ParsingStatus, SelectionMode } from '../../../../shared/parsing';

export function ParsingPage({ profileCode, onState }: { profileCode: string; onState: (state: ProfileStateResponse) => void }) {
  const [status, setStatus] = useState<ParsingStatus | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const base = `/api/profiles/${encodeURIComponent(profileCode)}/parsing`;
  useEffect(() => {
    let disposed = false, fetching = false;
    const refresh = async () => {
      if (fetching) return;
      fetching = true;
      try {
        const response = await fetch(`${base}/status`);
        const data = await response.json() as ParsingStatus & { error?: string };
        if (!response.ok) throw new Error(data.error ?? 'Could not load parsing statistics');
        if (!disposed) setStatus(data);
      } catch (e) { if (!disposed) setError(e instanceof Error ? e.message : 'Could not load statistics'); }
      finally { fetching = false; }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 2000);
    return () => { disposed = true; clearInterval(timer); };
  }, [base]);
  const setMode = async (mode: SelectionMode) => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError('');
    try {
      const response = await fetch(`${base}/mode`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode }) });
      const data = await response.json() as ProfileStateResponse & { error?: string };
      if (!response.ok) throw new Error(data.error ?? 'Could not switch mode');
      onState(data);
      setStatus(old => old ? { ...old, mode } : old);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not switch mode'); }
    finally { inFlight.current = false; setBusy(false); }
  };
  const parse = async () => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError('');
    try {
      const response = await fetch(`${base}/build`, { method: 'POST' });
      const data = await response.json() as ParsingStatus & { error?: string };
      if (!response.ok) throw new Error(data.error ?? 'Could not start parsing');
      setStatus(data);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not start parsing'); }
    finally { inFlight.current = false; setBusy(false); }
  };
  const resume = ['failed', 'interrupted'].includes(status?.job.phase ?? '');
  return <div className="settings-form">
    <p>Choose how the next observations are selected. Each mode keeps its own queue. Every observation is a question.</p>
    <label><input type="checkbox" role="switch" checked={status?.mode === 'core'} disabled={busy || !status || (!status.ready && status.mode !== 'core')}
      onChange={e => void setMode(e.target.checked ? 'core' : 'weighted')} />Parsing mode</label>
    <label><input type="checkbox" role="switch" checked={status?.mode === 'random'} disabled={busy || !status}
      onChange={e => void setMode(e.target.checked ? 'random' : 'weighted')} />Full random mode</label>
    <p role="status">{status?.mode === 'core' ? 'Core progression is active.' : status?.mode === 'random' ? 'Every available audio observation has the same selection probability.' : 'Normal complexity and source weighting are active.'}</p>
    <hr />
    <p>Parse the entire corpus once. Repeated words reuse their saved analysis. You may leave this page while parsing continues.</p>
    <button type="button" disabled={busy || !status || status.running} onClick={() => void parse()}>
      {status?.running ? 'Parsing corpus…' : resume ? 'Resume corpus parsing' : status?.ready ? 'Reparse entire corpus' : 'Parse entire corpus'}
    </button>
    <p role="status">{status?.job.phase ?? 'Not started'}{status?.job.total ? ` — ${(status.job.processed ?? 0).toLocaleString()} / ${status.job.total.toLocaleString()} observations` : ''}</p>
    {status?.job.total ? <progress aria-label="Corpus parsing progress" value={status.job.processed ?? 0} max={status.job.total} /> : null}
    {status?.job.uniqueWords !== undefined ? <p>{status.job.uniqueWords.toLocaleString()} distinct words analyzed</p> : null}
    {status?.stats ? <>
      <p>{status.stats.tokens.toLocaleString()} word occurrences · {status.stats.uniqueWords.toLocaleString()} distinct words · {status.stats.parseableWords.toLocaleString()} distinct words accepted by the parser</p>
      <table className="diagnostic-table"><thead><tr><th>Core</th><th>Observations</th><th>With audio</th><th>Mastered targets</th></tr></thead><tbody>
        {status.stats.coreStats.map(row => { const p = status.progress?.levels.find(x => x.core === row.core); return <tr key={row.core}>
          <th>{row.core}</th><td>{row.observations.toLocaleString()}</td><td>{row.observationsWithAudio.toLocaleString()}</td><td>{p?.mastered ?? 0} / {row.targets}</td>
        </tr>; })}
      </tbody></table>
      <p>An observation counts once per core. It can count in several cores. Several matching words do not increase its count.</p>
      <p>{status.progress?.completed ? 'All three cores are complete.' : `Current core: ${status.progress?.core ?? 1}. Each target needs three consecutive True answers. Answers are applied when the batch ends.`}</p>
      <p>Sentences have no minimum length. A displayed sentence can return in another core, and cannot be selected again within its original core.</p>
    </> : null}
    {(error || status?.job.error) ? <p role="alert">{error || status?.job.error}</p> : null}
    {status?.error && status.stats ? <p role="alert">{status.error}</p> : null}
    <ParsingDiagnostics key={profileCode} profileCode={profileCode} />
  </div>;
}
