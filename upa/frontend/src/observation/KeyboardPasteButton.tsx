import { useEffect, useRef, useState } from 'react';
import { CircleAlert, ClipboardPaste, LoaderCircle } from 'lucide-react';

/** Read only from a user click, preserving the custom editor's selection. */
export function KeyboardPasteButton({ onPaste, active }: { onPaste: (text: string) => void; active: boolean }) {
  const [busy,setBusy] = useState(false);
  const [failed,setFailed] = useState(false);
  const pending = useRef(false);
  const generation = useRef(0);
  const latest = useRef({onPaste,active}); latest.current = {onPaste,active};
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    setBusy(false); pending.current = false;
    return () => { generation.current++; };
  },[active]);
  return <button ref={button} type="button" className="question-paste-key" aria-label={failed ? 'మళ్ళీ అతికించు' : 'అతికించు'}
    disabled={busy || !active} aria-busy={busy} onPointerDown={event => event.preventDefault()} onClick={async () => {
      if (pending.current || !latest.current.active) return;
      const token = generation.current;
      pending.current = true; setBusy(true); setFailed(false);
      try {
        // Do not defer this call: Safari requires the click's user activation.
        const text = await navigator.clipboard.readText();
        if (token !== generation.current || !latest.current.active || !button.current?.isConnected || button.current.closest('[inert]')) return;
        if (text) latest.current.onPaste(text);
      } catch {
        if (token === generation.current) setFailed(true);
      } finally {
        if (token === generation.current) { pending.current = false; setBusy(false); }
      }
    }}>{busy ? <LoaderCircle className="repository-spin" aria-hidden="true"/> : failed ? <CircleAlert aria-hidden="true"/> : <ClipboardPaste aria-hidden="true"/>}</button>;
}
