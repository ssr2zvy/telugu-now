import { useEffect, useRef, useState, type FormEvent } from 'react';
import { CircleAlert, LoaderCircle, LockKeyhole } from 'lucide-react';

interface PasswordGateProps {
  onUnlocked: () => void;
}

/**
 * Shared-password gate shown before profile selection. The form is a real
 * username + password form so browser password managers — including iPhone
 * Safari — offer to save it on first use and autofill it on later visits.
 */
export function PasswordGate({ onUnlocked }: PasswordGateProps) {
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [rejected, setRejected] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus({ preventScroll: true }); }, []);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (submitting || !password) return;
    setSubmitting(true);
    setRejected(false);
    setUnavailable(false);
    void fetch('/api/gate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ password }),
    }).then(response => {
      if (response.ok) {
        // Leaving the value in the field lets Safari's save prompt read it.
        onUnlocked();
        return;
      }
      if (response.status === 401) setRejected(true);
      else setUnavailable(true);
    }).catch(() => setUnavailable(true))
      .finally(() => setSubmitting(false));
  };

  return (
    <main className="app-shell entry-screen gate-screen">
      <form className="entry-wrap gate-form" onSubmit={submit} method="post" action="/api/gate">
        <div
          className="entry-status"
          data-state={submitting ? 'loading' : rejected ? 'invalid' : unavailable ? 'unavailable' : 'idle'}
          role={rejected || unavailable || submitting ? 'status' : undefined}
          aria-label={submitting ? 'Checking password' : rejected ? 'Incorrect password' : unavailable ? 'Server unavailable' : undefined}
        >
          {submitting ? <LoaderCircle aria-hidden="true" />
            : rejected || unavailable ? <CircleAlert aria-hidden="true" />
              : <LockKeyhole aria-hidden="true" />}
        </div>
        {/* A hidden but real username field is what makes managers store the pair. */}
        <input
          className="gate-username"
          type="text"
          name="username"
          autoComplete="username"
          value="telugu-now"
          readOnly
          tabIndex={-1}
          aria-hidden="true"
        />
        <input
          ref={inputRef}
          className="gate-password"
          type="password"
          name="password"
          autoComplete="current-password"
          enterKeyHint="go"
          aria-label="Password"
          aria-invalid={rejected}
          value={password}
          disabled={submitting}
          onChange={event => { setPassword(event.target.value); setRejected(false); }}
        />
        <button className="gate-submit" type="submit" disabled={submitting || !password}>
          Enter
        </button>
      </form>
    </main>
  );
}
