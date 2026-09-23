import { useEffect, useState } from 'react';
import type { ParsingDiagnostics } from '../../../shared/parsing-diagnostics';

export function useParsingDiagnostics(profileCode: string) {
  const [snapshot, setSnapshot] = useState<{profile:string;data:ParsingDiagnostics} | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const abort = new AbortController();
    let running = false;
    setError('');
    const load = async () => {
      if (running) return;
      running = true;
      try {
        const response = await fetch(`/api/profiles/${encodeURIComponent(profileCode)}/parsing/diagnostics`, {signal:abort.signal});
        if (!response.ok) throw new Error('Could not update diagnostics.');
        const data = await response.json() as ParsingDiagnostics;
        if (!abort.signal.aborted) { setSnapshot({profile:profileCode,data}); setError(''); }
      } catch {
        if (!abort.signal.aborted) setError('Could not update. Retrying automatically.');
      } finally { running = false; }
    };
    void load();
    const timer = window.setInterval(() => void load(), 3000);
    return () => { abort.abort(); window.clearInterval(timer); };
  }, [profileCode]);
  return {data:snapshot?.profile === profileCode ? snapshot.data : null,error};
}
