import { useEffect, useRef, useState } from 'react';
import { Ban, Copy } from 'lucide-react';
import { SettingsIcon } from '../components/icons';

export type ReadingContextMenuState =
  | { kind: 'word'; text: string; x: number; y: number }
  | { kind: 'settings'; x: number; y: number };

export function readingContextMenuState(x: number, y: number, word: string | null): ReadingContextMenuState {
  return word ? { kind: 'word', text: word, x, y } : { kind: 'settings', x, y };
}

interface ReadingContextMenuProps {
  menu: ReadingContextMenuState;
  onCopy: (text: string) => void | Promise<void>;
  onBlacklistTranscript?: () => void | Promise<void>;
  onOpenSettings?: () => void;
  onClose: () => void;
}

// Word menus contain word actions only; the rest of the reader opens Settings only.
export function ReadingContextMenu({ menu, onCopy, onBlacklistTranscript, onOpenSettings, onClose }: ReadingContextMenuProps) {
  const [status, setStatus] = useState<'copied' | 'blacklisted' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const running = useRef(false);
  const alive = useRef(true);
  const closeTimer = useRef<number | null>(null);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; if (closeTimer.current !== null) window.clearTimeout(closeTimer.current); };
  }, []);
  const perform = async (action: () => void | Promise<void>, next: 'copied' | 'blacklisted') => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError('');
    try {
      await action();
      if (!alive.current) return;
      setStatus(next);
      closeTimer.current = window.setTimeout(onClose, 700);
    } catch (caught) {
      if (alive.current) setError(caught instanceof Error ? caught.message : 'Action failed. Try again.');
      running.current = false;
    } finally { if (alive.current) setBusy(false); }
  };
  const root = useRef<HTMLDivElement>(null);
  const placement = menu.y < 60 ? 'below' : 'above';
  useEffect(() => {
    const dismiss = (event: PointerEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent) {
        if (event.key === 'Escape') onClose();
        return;
      }
      if (!(event.target instanceof Node) || !root.current?.contains(event.target)) onClose();
    };
    document.addEventListener('pointerdown', dismiss, true);
    document.addEventListener('keydown', dismiss, true);
    return () => {
      document.removeEventListener('pointerdown', dismiss, true);
      document.removeEventListener('keydown', dismiss, true);
    };
  }, [onClose]);
  return (
    <div
      ref={root}
      className="reading-context-menu"
      role="menu"
      data-placement={placement}
      data-feedback={status ?? undefined}
      aria-busy={busy}
      style={{ left: `clamp(28px, ${menu.x}px, calc(100vw - 28px))`, top: menu.y }}
      onContextMenu={event => { event.preventDefault(); event.stopPropagation(); }}
    >
      {menu.kind === 'word' ? <>
        <button
          type="button"
          role="menuitem"
          className="reading-context-menu-action"
          aria-label="కాపీ చేయి"
          disabled={busy || status !== null}
          onClick={() => void perform(() => onCopy(menu.text), 'copied')}
        >
          <Copy size={18} aria-hidden="true" />
        </button>
        {onBlacklistTranscript ? <button
          type="button"
          role="menuitem"
          className="reading-context-menu-action"
          aria-label="ట్రాన్స్‌క్రిప్ట్‌ను బ్లాక్‌లిస్ట్‌కు జోడించు"
          disabled={busy || status !== null}
          onClick={() => void perform(onBlacklistTranscript, 'blacklisted')}
        >
          <Ban size={18} aria-hidden="true" />
        </button> : null}
      </> : <button
          type="button"
          role="menuitem"
          className="reading-context-menu-action"
          aria-label="అమరికలు"
          onClick={() => {
            onClose();
            onOpenSettings?.();
          }}
        >
          <SettingsIcon />
        </button>}
      <span className="reading-context-menu-status" role="status" aria-live="polite">
        {error || (busy ? '…' : status === 'copied' ? 'కాపీ అయ్యింది' : status === 'blacklisted' ? 'బ్లాక్‌లిస్ట్ చేయబడింది' : '')}
      </span>
    </div>
  );
}
