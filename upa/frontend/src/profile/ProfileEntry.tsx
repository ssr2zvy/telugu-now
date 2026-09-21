import { useEffect, useRef, useState } from 'react';
import { CircleAlert, ClipboardPaste, Delete, ServerOff } from 'lucide-react';
interface ProfileEntryProps {
  invalidCode: boolean;
  loadUnavailable: boolean;
  onSubmit: (code: string) => Promise<boolean>;
  onInputChange: () => void;
}
export function ProfileEntry({ invalidCode, loadUnavailable, onSubmit, onInputChange }: ProfileEntryProps) {
  const [codeInput, setCodeInput] = useState('');
  const [activeDigit, setActiveDigit] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [pasteError, setPasteError] = useState('');
  const root = useRef<HTMLElement>(null);
  const code = useRef('');
  const caret = useRef(0);
  const submittingRef = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    root.current?.focus({ preventScroll: true });
    return () => { alive.current = false; };
  }, []);
  const placeCaret = (position: number) => {
    caret.current = Math.max(0, Math.min(position, code.current.length, 2));
    setActiveDigit(caret.current);
  };
  const commitInput = (value: string, position: number) => {
    if (submittingRef.current) return;
    const next = value.replace(/[^0-9]/g, '').slice(0, 3);
    code.current = next;
    setCodeInput(next);
    placeCaret(position);
    setPasteError('');
    onInputChange();
    if (next.length !== 3) return;
    submittingRef.current = true;
    setSubmitting(true);
    void onSubmit(next).catch(() => false).then(accepted => {
      if (!accepted && alive.current) {
        code.current = '';
        setCodeInput('');
        placeCaret(0);
        root.current?.focus({ preventScroll: true });
      }
    }).finally(() => {
      submittingRef.current = false;
      if (alive.current) setSubmitting(false);
    });
  };
  const enterDigit = (digit: string) => {
    const position = caret.current;
    commitInput(code.current.slice(0, position) + digit + code.current.slice(position + 1), position + 1);
  };
  const backspace = () => {
    const position = caret.current;
    if (position > 0) commitInput(code.current.slice(0, position - 1) + code.current.slice(position), position - 1);
  };
  const paste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (alive.current) commitInput(text, text.replace(/[^0-9]/g, '').length);
    } catch {
      if (alive.current) setPasteError('Paste unavailable. Use the keypad or your keyboard.');
    }
  };
  return <main ref={root} className="app-shell entry-screen entry-keypad-screen" tabIndex={-1}
    aria-label="Enter your three-digit profile code"
    onPaste={event => { event.preventDefault(); const text = event.clipboardData.getData('text'); commitInput(text, text.replace(/[^0-9]/g, '').length); }}
    onKeyDown={event => {
      if (event.nativeEvent.isComposing || event.ctrlKey || event.metaKey || event.altKey || submittingRef.current) return;
      if (/^[0-9]$/.test(event.key)) { event.preventDefault(); if (!event.repeat) enterDigit(event.key); }
      else if (event.key === 'Backspace') { event.preventDefault(); backspace(); }
      else if (event.key === 'Delete') { event.preventDefault(); commitInput(code.current.slice(0, caret.current) + code.current.slice(caret.current + 1), caret.current); }
      else if (event.key === 'ArrowLeft') { event.preventDefault(); placeCaret(caret.current - 1); }
      else if (event.key === 'ArrowRight') { event.preventDefault(); placeCaret(caret.current + 1); }
      else if (event.key === 'Home') { event.preventDefault(); placeCaret(0); }
      else if (event.key === 'End') { event.preventDefault(); placeCaret(code.current.length); }
    }}>
    <div className="entry-wrap">
      {!submitting && (invalidCode || loadUnavailable) ? <div className="entry-status" data-state={invalidCode ? 'invalid' : 'unavailable'} role="status" aria-label={invalidCode ? 'Invalid profile code' : 'Profile server unavailable'}>
        {invalidCode ? <CircleAlert aria-hidden="true" /> : <ServerOff aria-hidden="true" />}
      </div> : null}
      <div className="entry-code" data-invalid={invalidCode} aria-busy={submitting}>
        <div className="entry-digits" role="group" aria-label="Profile code">
          {[0, 1, 2].map(index => <button key={index} type="button" className="entry-digit" data-active={activeDigit === index} data-filled={index < codeInput.length}
            disabled={submitting} aria-label={`Digit ${index + 1}: ${codeInput[index] ?? 'empty'}`} onClick={() => placeCaret(index)}>{codeInput[index] ?? ''}</button>)}
        </div>
      </div>
      <div className="entry-keypad" role="group" aria-label="Numeric keypad" aria-busy={submitting}>
        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(digit => <button key={digit} type="button" disabled={submitting} onClick={() => enterDigit(String(digit))}><span>{digit}</span></button>)}
        <button type="button" aria-label="Paste profile code" disabled={submitting} onClick={() => void paste()}><ClipboardPaste aria-hidden="true" /></button>
        <button type="button" disabled={submitting} onClick={() => enterDigit('0')}><span>0</span></button>
        <button type="button" aria-label="Backspace" disabled={submitting} onClick={backspace}><Delete aria-hidden="true" /></button>
      </div>
      <span className="entry-keypad-message" role="status">{submitting ? 'Opening profile…' : pasteError}</span>
    </div>
  </main>;
}
