import { useRef, useState, type CSSProperties, type ChangeEvent } from 'react';
interface ProfileEntryProps {
  invalidCode: boolean;
  onSubmit: (code: string) => Promise<boolean>;
  onInputChange: () => void;
}
export function ProfileEntry({
  invalidCode,
  onSubmit,
  onInputChange,
}: ProfileEntryProps) {
  const [codeInput, setCodeInput] = useState('');
  const entryLayoutHeightRef = useRef<number>(window.innerHeight);
  const handleChange = (value: string) => {
    const next = value.replace(/\D/g, '').slice(0, 3);
    setCodeInput(next);
    onInputChange();
    if (next.length === 3) {
      void onSubmit(next).then((accepted) => {
        if (!accepted) {
          setCodeInput('');
        }
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
        <input
          className="profile-input"
          aria-label="ప్రొఫైల్ కోడ్"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={3}
          value={codeInput}
          onChange={(event: ChangeEvent<HTMLInputElement>) =>
            handleChange(event.target.value)
          }
        />
        <div
          className="telugu-error"
          role={invalidCode ? 'status' : undefined}
        >
          {invalidCode ? 'చెల్లని కోడ్' : '\u00A0'}
        </div>
      </div>
    </main>
  );
}
