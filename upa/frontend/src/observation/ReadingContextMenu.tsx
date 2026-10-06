import { useEffect, useRef, useState } from 'react';
import { Check, Copy, Keyboard } from 'lucide-react';
import { consumeDismissalGesture } from './audio/dismissal-gesture';

export interface ReadingContextMenuState { text: string; x: number; y: number }
export function readingContextMenuState(x: number, y: number, text: string): ReadingContextMenuState {
  return { text, x, y };
}

export function ReadingContextMenu({ menu, onCopy, onKeyboard, onClose }: {
  menu: ReadingContextMenuState; onCopy: (text: string) => Promise<void>;
  onKeyboard?: () => void; onClose: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const running = useRef(false);
  const alive = useRef(true);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    alive.current = true;
    const previousFocus = document.activeElement;
    const menuElement = root.current;
    menuElement?.querySelector('button')?.focus({ preventScroll: true });
    const dismiss = (event: PointerEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent) { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); } return; }
      if (event.target instanceof Node && root.current?.contains(event.target)) return;
      event.preventDefault(); event.stopPropagation(); consumeDismissalGesture(document, event.pointerId); onClose();
    };
    document.addEventListener('pointerdown', dismiss, true);
    document.addEventListener('keydown', dismiss, true);
    return () => {
      alive.current = false; clearTimeout(timer.current);
      document.removeEventListener('pointerdown', dismiss, true);
      document.removeEventListener('keydown', dismiss, true);
      if (menuElement?.contains(document.activeElement) && previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, [onClose]);
  const copy = async () => {
    if (running.current) return;
    running.current = true;
    try {
      await onCopy(menu.text);
      if (!alive.current) return;
      setCopied(true); timer.current = setTimeout(onClose, 600);
    } catch {
      if (alive.current) setError('Copy unavailable.');
      running.current = false;
    }
  };
  return <div ref={root} className="reading-context-menu" role="menu" aria-label="Reading actions"
    data-placement={menu.y < 80 ? 'below' : 'above'}
    style={{ left: `clamp(64px, ${menu.x}px, calc(100vw - 64px))`, top: `clamp(12px, ${menu.y}px, calc(100dvh - 64px))` }}
    onKeyDown={event => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault(); event.stopPropagation();
      const buttons = [...event.currentTarget.querySelectorAll('button')];
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      buttons[(index + (event.key === 'ArrowRight' ? 1 : buttons.length - 1)) % buttons.length]?.focus();
    }}
    onClick={event => event.stopPropagation()} onContextMenu={event => { event.preventDefault(); event.stopPropagation(); }}>
    <button type="button" role="menuitem" className="reading-context-menu-action" aria-label={copied ? 'Copied' : 'Copy'} onClick={() => void copy()}>
      {copied ? <Check size={20} aria-hidden="true"/> : <Copy size={20} aria-hidden="true"/>}
    </button>
    {onKeyboard ? <button type="button" role="menuitem" className="reading-context-menu-action" aria-label="Free typing" onClick={onKeyboard}><Keyboard size={20} aria-hidden="true"/></button> : null}
    {error ? <span className="reading-context-menu-status" role="alert">{error}</span> : null}
  </div>;
}
