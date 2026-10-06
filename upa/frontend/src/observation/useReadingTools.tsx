import { useCallback, useEffect, useRef, useState, type DOMAttributes } from 'react';
import { FreeTypingScreen } from './FreeTypingScreen';
import { ReadingContextMenu, type ReadingContextMenuState } from './ReadingContextMenu';

type Handlers = Pick<DOMAttributes<HTMLElement>, 'onPointerDownCapture' | 'onPointerMoveCapture' | 'onPointerUpCapture' | 'onPointerCancelCapture' | 'onClickCapture' | 'onContextMenuCapture'>;
const ownActions = 'button:not(.nav-zone),input,textarea,select,[role="slider"],.audio-player-bar,.google-telugu-input,.reading-context-menu,.free-typing-screen,.word-image-preview';

async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text); }
  catch {
    // Keep fallback inside the topmost modal; body is inert beneath word/letter dialogs.
    const parent = [...document.querySelectorAll('dialog[open]')].at(-1) ?? document.body;
    const input = document.createElement('textarea');
    input.value = text; input.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
    parent.append(input); input.select();
    try { if (!document.execCommand('copy')) throw new Error('Copy unavailable'); }
    finally { input.remove(); }
  }
}

export function useReadingTools(text: string, scope: string, fontFamily: string, enabled: boolean, pause: () => void) {
  const [menu, setMenu] = useState<ReadingContextMenuState | null>(null);
  const [typing, setTyping] = useState(false);
  const [draft, setDraft] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const origin = useRef<{ id: number; x: number; y: number; opened: boolean } | null>(null);
  const suppressClick = useRef(false);
  const latest = useRef({ text, enabled, pause }); latest.current = { text, enabled, pause };
  const close = useCallback(() => setMenu(null), []);
  const stop = () => { clearTimeout(timer.current); timer.current = undefined; };
  useEffect(() => {
    stop(); origin.current = null; setMenu(null); setTyping(false); setDraft('');
    return stop;
  }, [scope]);
  useEffect(() => { if (!enabled) { stop(); origin.current = null; setMenu(null); } }, [enabled]);
  const open = (x: number, y: number) => {
    if (!latest.current.enabled || !latest.current.text) return;
    latest.current.pause(); suppressClick.current = true;
    window.getSelection()?.removeAllRanges();
    setMenu({ text: latest.current.text, x, y });
  };
  const handlers: Handlers = {
    onPointerDownCapture(event) {
      stop(); origin.current = null; suppressClick.current = false;
      if (!enabled || typing || menu || !event.isPrimary || event.button !== 0 || (event.target instanceof Element && event.target.closest(ownActions))) return;
      const point = { id: event.pointerId, x: event.clientX, y: event.clientY, opened: false };
      origin.current = point;
      timer.current = setTimeout(() => { point.opened = true; open(point.x, point.y); }, 500);
    },
    onPointerMoveCapture(event) {
      const point = origin.current;
      if (!point || point.id !== event.pointerId) return;
      if (point.opened) { event.preventDefault(); event.stopPropagation(); return; }
      if (Math.hypot(event.clientX - point.x, event.clientY - point.y) > 10) { stop(); origin.current = null; }
    },
    onPointerUpCapture(event) {
      stop(); const point = origin.current; origin.current = null;
      if (point?.opened) { event.preventDefault(); event.stopPropagation(); }
    },
    onPointerCancelCapture() { stop(); origin.current = null; },
    onClickCapture(event) {
      if (suppressClick.current) { suppressClick.current = false; event.preventDefault(); event.stopPropagation(); }
    },
    onContextMenuCapture(event) {
      if (!enabled || typing || (event.target instanceof Element && event.target.closest(ownActions))) return;
      event.preventDefault(); event.stopPropagation(); stop(); open(event.clientX, event.clientY);
    },
  };
  return {
    open: Boolean(menu) || typing,
    bind(other: Handlers = {}): Handlers {
      return {
        onPointerDownCapture(e) { handlers.onPointerDownCapture!(e); if (!e.defaultPrevented) other.onPointerDownCapture?.(e); },
        onPointerMoveCapture(e) { handlers.onPointerMoveCapture!(e); if (!e.defaultPrevented) other.onPointerMoveCapture?.(e); },
        onPointerUpCapture(e) { handlers.onPointerUpCapture!(e); if (!e.defaultPrevented) other.onPointerUpCapture?.(e); },
        onPointerCancelCapture(e) { handlers.onPointerCancelCapture!(e); other.onPointerCancelCapture?.(e); },
        onClickCapture(e) { handlers.onClickCapture!(e); if (!e.defaultPrevented) other.onClickCapture?.(e); },
        onContextMenuCapture: handlers.onContextMenuCapture,
      };
    },
    surface: <>
      {menu ? <ReadingContextMenu menu={menu} onCopy={copyText} onClose={close} onKeyboard={() => { close(); setTyping(true); }}/>: null}
      {typing ? <FreeTypingScreen value={draft} onChange={setDraft} fontFamily={fontFamily} onBack={() => setTyping(false)}/>: null}
    </>,
  };
}
