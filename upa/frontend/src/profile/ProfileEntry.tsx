import { useRef, useState, type CSSProperties, type ChangeEvent } from 'react';
import { CircleAlert, ServerOff } from 'lucide-react';
interface ProfileEntryProps {
  invalidCode: boolean;
  loadUnavailable: boolean;
  onSubmit: (code: string) => Promise<boolean>;
  onInputChange: () => void;
}
export function ProfileEntry({
  invalidCode,
  loadUnavailable,
  onSubmit,
  onInputChange,
}: ProfileEntryProps) {
  const [codeInput, setCodeInput] = useState('');
  const [activeDigit, setActiveDigit] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const entryLayoutHeightRef = useRef<number>(window.innerHeight);
  const handleChange = (value: string) => {
    if (submittingRef.current) return;
    const next = value.replace(/\D/g, '').slice(0, 3);
    setCodeInput(next);
    setActiveDigit(Math.min(next.length, 2));
    onInputChange();
    if (next.length === 3) {
      submittingRef.current = true;
      setSubmitting(true);
      void onSubmit(next).catch(() => false).then((accepted) => {
        if (!accepted) {
          setCodeInput('');
          setActiveDigit(0);
          inputRef.current?.focus({ preventScroll: true });
        }
      }).finally(() => {
        submittingRef.current = false;
        setSubmitting(false);
      });
    }
  };
  return (
    <main
      className="app-shell entry-screen"
      style={{
        '--entry-layout-height': `${entryLayoutHeightRef.current}px`,
      } as CSSProperties}
    >
      <div className="entry-wrap">
        {!submitting && (invalidCode || loadUnavailable) ? <div
          className="entry-status"
          data-state={invalidCode ? 'invalid' : 'unavailable'}
          role="status"
          aria-label={invalidCode ? 'Invalid profile code' : 'Profile server unavailable'}
          title={loadUnavailable ? 'Profile server unavailable' : undefined}
        >
          {invalidCode ? <CircleAlert aria-hidden="true" /> : <ServerOff aria-hidden="true" />}
        </div> : null}
        <div className="entry-code" data-invalid={invalidCode} aria-busy={submitting}>
          <input
            ref={inputRef}
            className="profile-input"
            aria-label="ప్రొఫైల్ కోడ్"
            aria-invalid={invalidCode}
            inputMode="numeric"
            autoComplete="off"
            spellCheck={false}
            pattern="[0-9]*"
            maxLength={3}
            value={codeInput}
            readOnly={submitting}
            onSelect={(event) => setActiveDigit(Math.min(event.currentTarget.selectionStart ?? codeInput.length, 2))}
            onChange={(event: ChangeEvent<HTMLInputElement>) => handleChange(event.target.value)}
          />
          <div className="entry-digits" aria-hidden="true">
            {[0, 1, 2].map(index => (
              <span key={index} className="entry-digit" data-active={activeDigit === index} data-filled={index < codeInput.length}>
                {codeInput[index] ?? ''}
              </span>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
