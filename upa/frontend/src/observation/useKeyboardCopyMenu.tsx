import { useCallback, useEffect, useRef, useState, type DOMAttributes, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { copyText } from './copy-text';
import { ReadingContextMenu, type ReadingContextMenuState } from './ReadingContextMenu';

type Press = { id: number; x: number; y: number; scrollTop: number; editor: boolean; moved: boolean; opened: boolean };
const isMenu = (target: EventTarget) => target instanceof Element && Boolean(target.closest('.reading-context-menu'));

/** Own touch editing gestures so WebKit cannot replace the app menu with selection handles. */
export function useKeyboardCopyMenu(editor: RefObject<HTMLTextAreaElement | null>, value: string) {
  const [menu, setMenu] = useState<ReadingContextMenuState | null>(null);
  const latest = useRef(value); latest.current = value;
  const press = useRef<Press | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const suppressClick = useRef(false);
  const close = useCallback(() => setMenu(null), []);
  const stop = () => { clearTimeout(timer.current); timer.current = undefined; };
  useEffect(() => {
    const element = editor.current;
    if (!element) return;
    // React's delegated touch listener is passive. Cancel native touch editing
    // here; pointer handlers below retain vertical scrolling of long drafts.
    const prevent = (event: Event) => event.preventDefault();
    const abandon = () => { stop(); press.current = null; };
    element.addEventListener('touchstart', prevent, { passive: false });
    element.addEventListener('selectstart', prevent);
    window.addEventListener('blur', abandon);
    return () => {
      abandon();
      element.removeEventListener('touchstart', prevent);
      element.removeEventListener('selectstart', prevent);
      window.removeEventListener('blur', abandon);
    };
  }, [editor]);
  const open = (x: number, y: number) => {
    suppressClick.current = true;
    window.getSelection()?.removeAllRanges();
    setMenu({ text: latest.current, x, y });
  };
  const handlers: DOMAttributes<HTMLDivElement> = {
    onPointerDownCapture(event) {
      if (isMenu(event.target)) return;
      stop(); press.current = null; suppressClick.current = false;
      if (!event.isPrimary || event.button !== 0 || menu) return;
      const inEditor = event.target === editor.current;
      if (inEditor) {
        event.preventDefault();
        editor.current?.setPointerCapture(event.pointerId);
      }
      const point: Press = { id: event.pointerId, x: event.clientX, y: event.clientY,
        scrollTop: editor.current?.scrollTop ?? 0, editor: inEditor, moved: false, opened: false };
      press.current = point;
      timer.current = setTimeout(() => { point.opened = true; open(point.x, point.y); }, 500);
    },
    onPointerMoveCapture(event) {
      const point = press.current;
      if (!point || point.id !== event.pointerId) return;
      if (point.opened) { event.preventDefault(); event.stopPropagation(); return; }
      if (Math.hypot(event.clientX - point.x, event.clientY - point.y) > 10) {
        stop(); point.moved = true; suppressClick.current = true;
      }
      if (point.editor && point.moved && editor.current) {
        event.preventDefault();
        editor.current.scrollTop = point.scrollTop + point.y - event.clientY;
      }
    },
    onPointerUpCapture(event) {
      if (isMenu(event.target)) return;
      const point = press.current;
      if (!point || point.id !== event.pointerId) return;
      stop(); press.current = null;
      if (point.opened || point.moved) { event.preventDefault(); event.stopPropagation(); }
      else if (point.editor) {
        // Focus for hardware typing, without moving the insertion point or
        // selecting the touched word as the browser normally would.
        event.preventDefault(); editor.current?.focus({ preventScroll: true });
      }
    },
    onPointerCancelCapture() { stop(); press.current = null; suppressClick.current = true; },
    onClickCapture(event) {
      if (isMenu(event.target)) return;
      if (suppressClick.current || event.target === editor.current) {
        suppressClick.current = false; event.preventDefault(); event.stopPropagation();
      }
    },
    onDoubleClickCapture(event) {
      if (isMenu(event.target)) return;
      event.preventDefault(); event.stopPropagation();
    },
    onContextMenuCapture(event) {
      if (isMenu(event.target)) return;
      event.preventDefault(); event.stopPropagation(); stop();
      if (press.current) press.current.opened = true;
      if (!menu) open(event.clientX, event.clientY);
    },
  };
  // The question keyboard is transformed and paint-contained. Its menu must
  // live outside that box, but inside the top-layer dialog for free typing.
  const host = menu && (editor.current?.closest('dialog[open]') ?? editor.current?.closest('.appearance-root') ?? document.body);
  return { handlers, surface: menu && host ? createPortal(
    <ReadingContextMenu menu={menu} onCopy={copyText} onClose={close}/>, host,
  ) : null };
}
