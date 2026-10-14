import { useEffect, useRef, useState } from 'react';
import { Check, Copy, CircleAlert } from 'lucide-react';
import { copyText } from './copy-text';

export function KeyboardCopyButton({ text, active = true }: { text: string; active?: boolean }) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; clearTimeout(timer.current); }; }, []);
  return <button type="button" className="question-copy-key keyboard-copy" aria-label={error ? 'నకలు కాలేదు' : copied ? 'Copied' : 'Copy'}
      disabled={!text || !active} onPointerDown={event => event.preventDefault()}
      onClick={async event => {
        event.stopPropagation();
        try {
          await copyText(text);
          if (!alive.current) return;
          setError(false); setCopied(true); clearTimeout(timer.current);
          timer.current = setTimeout(() => setCopied(false), 800);
        } catch { if (alive.current) setError(true); }
      }}>{error ? <CircleAlert aria-hidden="true"/> : copied ? <Check aria-hidden="true"/> : <Copy aria-hidden="true"/>}</button>;
}
