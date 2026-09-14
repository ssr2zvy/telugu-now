import { useEffect, useRef, useState } from 'react';
import { Ban, Copy } from 'lucide-react';

export interface ReaderTextMenuProps {
  x: number;
  y: number;
  busy?: boolean;
  error?: string | null;
  onCopy: () => void;
  onBlacklist: () => void;
  onClose: () => void;
}

/**
 * Copy/Blacklist actions for the whole displayed sentence. Icons carry no
 * visible label; their accessible names come from aria-label/title.
 */
export function ReaderTextMenu({ x, y, busy = false, error = null, onCopy, onBlacklist, onClose }: ReaderTextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    menuRef.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
    const dismiss = (event: Event) => {
      if (event.target instanceof Node && menuRef.current?.contains(event.target)) return;
      onClose();
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('pointerdown', dismiss, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', dismiss, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      className="reader-text-menu"
      role="menu"
      aria-label="Sentence actions"
      style={{ left: `${x}px`, top: `${y}px` }}
      onClick={event => event.stopPropagation()}
      onDoubleClick={event => event.stopPropagation()}
      onContextMenu={event => event.preventDefault()}
    >
      <button
        type="button"
        role="menuitem"
        className="reader-text-menu-action"
        aria-label="Copy sentence"
        title="Copy sentence"
        disabled={busy}
        onClick={onCopy}
      >
        <Copy size={18} aria-hidden="true" />
      </button>
      <button
        type="button"
        role="menuitem"
        className="reader-text-menu-action"
        aria-label="Blacklist sentence"
        title="Blacklist sentence"
        disabled={busy}
        onClick={onBlacklist}
      >
        <Ban size={18} aria-hidden="true" />
      </button>
      {error ? <span className="reader-text-menu-error" role="alert">{error}</span> : null}
    </div>
  );
}

export interface LongPressOptions {
  holdMs?: number;
  moveTolerancePx?: number;
  onTrigger: (point: { x: number; y: number }) => void;
}

/**
 * Long-hold recogniser used on touch where the native selection callout is
 * suppressed; the menu replaces that callout rather than supplementing it.
 */
export function useLongPressMenu({ holdMs = 500, moveTolerancePx = 10, onTrigger }: LongPressOptions) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const [triggered, setTriggered] = useState(false);
  const clear = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    origin.current = null;
  };
  useEffect(() => clear, []);
  return {
    consumedClick: () => {
      if (!triggered) return false;
      setTriggered(false);
      return true;
    },
    handlers: {
      onPointerDown: (event: { pointerType: string; isPrimary: boolean; clientX: number; clientY: number }) => {
        if (event.pointerType === 'mouse' || !event.isPrimary) return;
        clear();
        origin.current = { x: event.clientX, y: event.clientY };
        timer.current = setTimeout(() => {
          const point = origin.current;
          clear();
          if (!point) return;
          setTriggered(true);
          onTrigger(point);
        }, holdMs);
      },
      onPointerMove: (event: { clientX: number; clientY: number }) => {
        const point = origin.current;
        if (!point) return;
        if (Math.hypot(event.clientX - point.x, event.clientY - point.y) > moveTolerancePx) clear();
      },
      onPointerUp: clear,
      onPointerCancel: clear,
    },
  };
}
