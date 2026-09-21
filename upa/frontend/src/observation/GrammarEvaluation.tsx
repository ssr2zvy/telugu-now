import { useId, useRef, useState } from 'react';

export function GrammarEvaluation({ profileCode, observationId, result, target }: {
  profileCode: string; observationId: string; result: boolean | null; target: Record<string, unknown>;
}) {
  const labelId = useId();
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<boolean | null>(null);
  const [pending, setPending] = useState<boolean | null>(null);
  const [error, setError] = useState('');
  const inFlight = useRef(false);
  const committed = useRef(false);
  const value = result ?? saved;
  const selected = value ?? pending;
  const submit = async (correct: boolean) => {
    if (inFlight.current || committed.current || value !== null) return;
    inFlight.current = true;
    setBusy(true);
    setPending(correct);
    setError('');
    try {
      const response = await fetch(`/api/profiles/${encodeURIComponent(profileCode)}/grammar-evaluations/${encodeURIComponent(observationId)}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ result: correct }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error || 'Could not save evaluation');
      }
      committed.current = true;
      setSaved(correct);
    } catch (caught) {
      setPending(null);
      setError(caught instanceof Error ? caught.message : 'Could not save evaluation');
    } finally { inFlight.current = false; setBusy(false); }
  };
  const word = String((target.occurrence as { word?: string } | undefined)?.word ?? '');
  return <div className="grammar-evaluation" onClick={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()} onPointerDown={event => event.stopPropagation()}>
    <p id={labelId}>Was your answer correct? <span lang="te">{word}</span></p>
    <fieldset className="evaluation-switch" disabled={busy || value !== null} aria-labelledby={labelId} aria-busy={busy} data-value={selected === null ? 'unanswered' : String(selected)}>
      <span className="evaluation-switch-indicator" aria-hidden="true" />
      {[false, true].map(choice => <label key={String(choice)}>
        <input type="radio" name={`evaluation-${labelId}`} value={String(choice)} checked={selected === choice} onChange={() => void submit(choice)} />
        <span>{choice ? 'True' : 'False'}</span>
      </label>)}
    </fieldset>
    <p className="evaluation-status" role="status">{busy ? 'Saving…' : value !== null ? `${value ? 'True' : 'False'} saved. Continue when ready.` : 'Choose True or False.'}</p>
    {error ? <p role="alert">{error}</p> : null}
  </div>;
}
