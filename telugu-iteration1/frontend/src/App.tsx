import { useEffect, useMemo, useRef, useState } from 'react';
import type { ProfileStateResponse } from '../../shared/contracts';
import { getProfileState, loadProfile, navigate, setVisibility } from './api';
import './styles.css';

function formatTime(timestamp: number | null): string {
  if (timestamp === null) return '—';
  return new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function Diagnostic({ state }: { state: ProfileStateResponse }) {
  const diagnostic = state.currentObservation?.diagnostic;
  if (!diagnostic) return null;

  return (
    <div className="diagnostic" aria-hidden="true">
      <div>{diagnostic.groupKind}</div>
      <div>group {diagnostic.groupPosition}/{diagnostic.groupSize}</div>
      <div>start {formatTime(diagnostic.requestStartedAt)}</div>
      <div>end {formatTime(diagnostic.requestCompletedAt)}</div>
      <div>duration {diagnostic.requestDurationMs ?? '—'} ms</div>
    </div>
  );
}

export function App() {
  const [codeInput, setCodeInput] = useState('');
  const [profileCode, setProfileCode] = useState<string | null>(null);
  const [state, setState] = useState<ProfileStateResponse | null>(null);
  const [invalidCode, setInvalidCode] = useState(false);
  const [busy, setBusy] = useState(false);
  const activeCodeRef = useRef<string | null>(null);

  useEffect(() => {
    activeCodeRef.current = profileCode;
  }, [profileCode]);

  useEffect(() => {
    if (!profileCode) return;

    let cancelled = false;

    const refresh = async () => {
      try {
        const next = await getProfileState(
          profileCode,
          document.visibilityState === 'visible',
        );

        if (!cancelled) setState(next);
      } catch {
        // Keep the last known state. The next poll will retry.
      }
    };

    void refresh();

    const interval = window.setInterval(() => void refresh(), 1_000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [profileCode]);

  useEffect(() => {
    const onVisibility = () => {
      const code = activeCodeRef.current;
      if (!code) return;

      void setVisibility(code, {
        visible: document.visibilityState === 'visible',
      });
    };

    const onPageHide = () => {
      const code = activeCodeRef.current;
      if (!code) return;

      const body = new Blob(
        [JSON.stringify({ visible: false })],
        { type: 'application/json' },
      );

      navigator.sendBeacon(`/api/profiles/${code}/visibility`, body);
    };

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, []);

  const canBack = Boolean(state?.canBack) && !busy;
  const canNext = Boolean(state?.canNext) && !busy;

  const observationStyle = useMemo(() => {
    const length = state?.currentObservation?.text.length ?? 0;

    const size =
      length <= 4
        ? 'clamp(4rem, 13vw, 10rem)'
        : 'clamp(2.4rem, 8vw, 6rem)';

    return { fontSize: size };
  }, [state?.currentObservation?.text]);

  const submitCode = async (value: string) => {
    if (!/^\d{3}$/.test(value)) return;

    setBusy(true);
    setInvalidCode(false);

    try {
      const loaded = await loadProfile({
        code: value,
        visible: document.visibilityState === 'visible',
      });

      setProfileCode(value);
      setState(loaded);
    } catch {
      setInvalidCode(true);
      setCodeInput('');
    } finally {
      setBusy(false);
    }
  };

  const move = async (direction: 'back' | 'next') => {
    if (!profileCode) return;

    setBusy(true);

    try {
      const next = await navigate(profileCode, direction, {
        visible: document.visibilityState === 'visible',
      });

      setState(next);
    } catch {
      // Polling will refresh readiness/state; no English error is exposed to the user.
    } finally {
      setBusy(false);
    }
  };

  if (!profileCode) {
    return (
      <main className="app-shell entry-screen">
        <div className="entry-wrap">
          <input
            className="profile-input"
            aria-label="ప్రొఫైల్ కోడ్"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={3}
            value={codeInput}
            onChange={(event) => {
              const next = event.target.value
                .replace(/\D/g, '')
                .slice(0, 3);

              setCodeInput(next);
              setInvalidCode(false);

              if (next.length === 3) {
                void submitCode(next);
              }
            }}
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

  return (
    <main className="app-shell observation-screen">
      <button
        className="nav-zone nav-zone-left"
        type="button"
        aria-label="వెనుక"
        disabled={!canBack}
        onClick={() => void move('back')}
      >
        ‹
      </button>

      <section className="observation-center">
        {state?.currentObservation ? (
          <>
            <div
              className="observation-text"
              style={observationStyle}
            >
              {state.currentObservation.text}
            </div>

            <Diagnostic state={state} />
          </>
        ) : null}
      </section>

      <button
        className="nav-zone nav-zone-right"
        type="button"
        aria-label="తర్వాత"
        disabled={!canNext}
        onClick={() => void move('next')}
      >
        ›
      </button>
    </main>
  );
}