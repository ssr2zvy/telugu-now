import { useEffect, useLayoutEffect, useRef, useState, type DOMAttributes, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { caretBox, measureKeyboardText, nearestLetterHit, selectionBoxes, type TextLayout, type TextBox } from './keyboard-text-layout';

type Selection = { start: number; end: number };
interface Drag { id: number; x: number; y: number; top: number; anchor: number; active: boolean; moved: boolean; mode: 'range' | 'caret'; biasX: number; biasY: number }

export function useKeyboardSelection(editor: RefObject<HTMLTextAreaElement | null>, value: string,
  selection: RefObject<Selection>, enabled: boolean, caretVisible: boolean, options: { selectionMode: boolean; documentMode: boolean; keyboardVisible: boolean; onActivate?: () => void }) {
  const [layout, setLayout] = useState<TextLayout | null>(null);
  const [revision, update] = useState(0);
  const [scroll, setScroll] = useState({ x: 0, y: 0 });
  const [focused, setFocused] = useState(false);
  const [adjusting, setAdjusting] = useState(false);
  const [lens, setLens] = useState<{ x: number; y: number; offset: number; trailing: boolean } | null>(null);
  const layoutRef = useRef<TextLayout | null>(null);
  const drag = useRef<Drag | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const frame = useRef(0);
  const suppressClick = useRef(false);
  const latest = useRef({ value, enabled, options }); latest.current = { value, enabled, options };
  const focusTrailing = useRef(false);
  const focusOffset = useRef(selection.current.end);
  const refresh = () => {
    const element = editor.current;
    if (!element || !latest.current.enabled || !element.clientWidth) return;
    layoutRef.current = measureKeyboardText(element, latest.current.options.documentMode); setLayout(layoutRef.current);
    setScroll({ x: element.scrollLeft, y: element.scrollTop });
  };
  const select = (start: number, end = start, trailing = false) => {
    focusTrailing.current = trailing;
    focusOffset.current = end;
    selection.current = { start: Math.min(start, end), end: Math.max(start, end) };
    update(n => n + 1);
  };
  const setNativeRange = () => {
    const element = editor.current;
    if (!element) return;
    const { start, end } = selection.current;
    if (element.selectionStart !== start || element.selectionEnd !== end) element.setSelectionRange(start, end);
  };
  useLayoutEffect(() => {
    selection.current = { start: Math.min(selection.current.start, value.length), end: Math.min(selection.current.end, value.length) };
    setNativeRange();
  }, [value, revision]);
  useLayoutEffect(refresh, [value, enabled, options.keyboardVisible]);
  useLayoutEffect(() => {
    const element = editor.current;
    if (!options.documentMode || !options.keyboardVisible || !element || !layoutRef.current) return;
    const box = caretBox(layoutRef.current,focusOffset.current);
    if (box.y + box.height > element.scrollTop + element.clientHeight - 12) element.scrollTop = box.y + box.height - element.clientHeight + 12;
    else if (box.y < element.scrollTop + 12) element.scrollTop = Math.max(0,box.y - 12);
    refresh();
  },[options.keyboardVisible]);
  const stop = () => { clearTimeout(timer.current); timer.current = undefined; cancelAnimationFrame(frame.current); frame.current = 0; };
  const abandon = () => { stop(); drag.current = null; setLens(null); };
  useEffect(() => {
    const element = editor.current;
    if (!element) return;
    const prevent = (event: Event) => event.preventDefault();
    let scrollFrame = 0;
    const scrolled = () => {
      setScroll({ x: element.scrollLeft, y: element.scrollTop });
      if (latest.current.options.documentMode && !scrollFrame) scrollFrame = requestAnimationFrame(() => { scrollFrame = 0; refresh(); });
    };
    // Native WebKit touch editing is disabled. All touch selection UI is ours.
    element.addEventListener('touchstart', prevent, { passive: false });
    element.addEventListener('selectstart', prevent);
    element.addEventListener('scroll', scrolled);
    const resize = new ResizeObserver(refresh); resize.observe(element);
    window.addEventListener('blur', abandon);
    document.fonts.addEventListener('loadingdone',refresh);
    let alive = true;
    void document.fonts.ready.then(() => { if (alive) refresh(); });
    return () => {
      document.fonts.removeEventListener('loadingdone',refresh);
      alive = false; cancelAnimationFrame(scrollFrame); stop(); drag.current = null; resize.disconnect();
      element.removeEventListener('touchstart', prevent); element.removeEventListener('selectstart', prevent);
      element.removeEventListener('scroll', scrolled); window.removeEventListener('blur', abandon);
    };
  }, [editor]);
  useEffect(() => { if (!enabled) { abandon(); setAdjusting(false); } }, [enabled]);
  const offsetAt = (x: number, y: number) => {
    const element = editor.current; const measured = layoutRef.current;
    if (!element || !measured) return {offset:0,trailing:false};
    const rect = element.getBoundingClientRect();
    return nearestLetterHit(measured, x - rect.left - element.clientLeft + element.scrollLeft,
      Math.max(rect.top + 2, Math.min(rect.bottom - 2, y)) - rect.top - element.clientTop + element.scrollTop);
  };
  const moveSelection = (point: Drag) => {
    const hit = offsetAt(point.x - point.biasX, point.y - point.biasY);
    select(point.mode === 'caret' ? hit.offset : point.anchor, hit.offset, hit.trailing);
    setLens({ x: point.x, y: point.y, ...hit });
  };
  const autoScroll = () => {
    const point = drag.current; const element = editor.current;
    if (!point?.active || !element) return;
    const rect = element.getBoundingClientRect();
    const speed = !point.moved ? 0 : point.y < rect.top + 20 ? -8 : point.y > rect.bottom - 20 ? 8 : 0;
    if (speed) { element.scrollTop += speed; if (latest.current.options.documentMode) refresh(); moveSelection(point); }
    frame.current = requestAnimationFrame(autoScroll);
  };
  const begin = (point: Drag) => {
    point.active = true; suppressClick.current = true; setAdjusting(true); setFocused(true);
    editor.current?.focus({ preventScroll: true });
    moveSelection(point); autoScroll();
  };
  const handlers: DOMAttributes<HTMLDivElement> = {
    onPointerDownCapture(event) {
      const target = event.target as Element;
      const handle = target.closest<HTMLElement>('[data-selection-handle]');
      suppressClick.current = false;
      if (event.target !== editor.current && !handle) return;
      if (!enabled || !event.isPrimary || event.button !== 0) return;
      abandon(); suppressClick.current = false; refresh();
      event.preventDefault(); event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId);
      const kind = handle?.dataset.selectionHandle;
      const anchor = kind === 'start' ? selection.current.end : kind === 'end' ? selection.current.start : offsetAt(event.clientX, event.clientY).offset;
      const point: Drag = { id: event.pointerId, x: event.clientX, y: event.clientY, top: editor.current?.scrollTop ?? 0,
        anchor, active: false, moved: false, mode: kind === 'start' || kind === 'end' || latest.current.options.selectionMode ? 'range' : 'caret', biasX: 0, biasY: 0 };
      if (handle && editor.current && layoutRef.current) {
        const offset = kind === 'end' ? selection.current.end : selection.current.start;
        const box = caretBox(layoutRef.current, offset, kind === 'end');
        const rect = editor.current.getBoundingClientRect();
        point.biasX = event.clientX - (rect.left + box.x - editor.current.scrollLeft);
        point.biasY = event.clientY - (rect.top + box.y + box.height / 2 - editor.current.scrollTop);
      }
      drag.current = point;
      // Handles act immediately; pressing text first holds still to establish the anchor.
      if (handle) begin(point);
      else timer.current = setTimeout(() => begin(point), 500);
    },
    onPointerMoveCapture(event) {
      const point = drag.current;
      if (!point || point.id !== event.pointerId) return;
      event.preventDefault(); event.stopPropagation();
      if (point.active) {
        if (Math.hypot(event.clientX - point.x, event.clientY - point.y) > 2) point.moved = true;
        point.x = event.clientX; point.y = event.clientY; moveSelection(point); return;
      }
      if (Math.hypot(event.clientX - point.x, event.clientY - point.y) > 10) { clearTimeout(timer.current); point.moved = true; suppressClick.current = true; }
      if (point.moved && editor.current) editor.current.scrollTop = point.top + point.y - event.clientY;
    },
    onPointerUpCapture(event) {
      const point = drag.current;
      if (!point || point.id !== event.pointerId) return;
      event.preventDefault(); event.stopPropagation();
      if (point.active) { point.x = event.clientX; point.y = event.clientY; moveSelection(point); latest.current.options.onActivate?.(); }
      else if (!point.moved) {
        if (latest.current.options.documentMode) { const hit = offsetAt(event.clientX,event.clientY); select(hit.offset,hit.offset,hit.trailing); latest.current.options.onActivate?.(); }
        editor.current?.focus({ preventScroll: true }); setFocused(true);
      }
      abandon(); setNativeRange();
    },
    onPointerCancelCapture() { abandon(); suppressClick.current = true; },
    onClickCapture(event) {
      if (suppressClick.current || event.target === editor.current || (event.target as Element).closest('[data-selection-handle]')) {
        suppressClick.current = false; event.preventDefault(); event.stopPropagation();
      }
    },
    onContextMenuCapture(event) { event.preventDefault(); event.stopPropagation(); },
    onDoubleClickCapture(event) { event.preventDefault(); event.stopPropagation(); },
  };
  const current = selection.current;
  const ranged = current.start !== current.end;
  const pos = (box: TextBox) => ({ left: box.x - scroll.x, top: box.y - scroll.y, height: box.height });
  const handle = (offset: number, kind: 'start' | 'end' | 'caret') => {
    if (!layout) return null;
    const box = caretBox(layout, offset, kind === 'end' || (kind === 'caret' && focusTrailing.current));
    return <button type="button" className="keyboard-selection-handle" data-selection-handle={kind}
      aria-label={kind === 'caret' ? 'Move cursor' : `Move selection ${kind}`} tabIndex={-1}
      style={{ left: box.x - scroll.x - 12, top: box.y + box.height - scroll.y - 6 }}><span/></button>;
  };
  const overlay = layout && enabled ? <div className="keyboard-selection-overlay" aria-hidden="true">
    {selectionBoxes(layout, current.start, current.end).map((box, index) => <span key={index} className="keyboard-selection-fill" style={{ ...pos(box), width: box.width }}/>) }
    {focused && !ranged && caretVisible && options.keyboardVisible ? <span className="keyboard-custom-caret" style={pos(caretBox(layout, current.start, focusTrailing.current))}/> : null}
  </div> : null;
  const handles = layout && enabled && adjusting && options.keyboardVisible ? <div className="keyboard-selection-handles">
    {ranged ? <>{handle(current.start, 'start')}{handle(current.end, 'end')}</> : handle(current.start, 'caret')}
  </div> : null;
  const host = enabled && editor.current && (editor.current.closest('.repository-document') ?? editor.current.closest('dialog[open]') ?? editor.current.closest('.observation-screen') ?? editor.current.closest('.appearance-root'));
  const magnified = lens && layout ? caretBox(layout, lens.offset, lens.trailing) : null;
  const chrome = host ? createPortal(<>
    {lens && layout && magnified ? <div className="keyboard-text-lens" aria-hidden="true"
      style={{ left: Math.max(94, Math.min(window.innerWidth - 94, lens.x)), top: Math.max(8, lens.y - 100) }}>
      <div style={{ ...layout.style, position: 'absolute', left: 0, top: 0, transformOrigin: '0 0',
        transform: `translate(${90 - magnified.x * 1.8}px, ${34 - (magnified.y + magnified.height / 2) * 1.8}px) scale(1.8)` }}>{value}{'\u200b'}</div>
      <span className="keyboard-lens-caret" style={{height: Math.min(42,magnified.height * 1.8),top: 34 - Math.min(42,magnified.height * 1.8)/2}}/>
    </div> : null}
  </>, host) : null;
  return { select, handlers, overlay, handles, chrome, copyText: ranged ? value.slice(current.start, current.end) : value,
    toggleSelection: (on: boolean) => { abandon(); if (!on) select(focusOffset.current); },
    onFocus: () => setFocused(true),
    onNativeSelect: () => {
      if (drag.current) return;
      const element = editor.current;
      if (element && element.value === latest.current.value && (element.selectionStart !== selection.current.start || element.selectionEnd !== selection.current.end)) select(element.selectionStart, element.selectionEnd);
    },
    onEdit: () => { setAdjusting(false); setFocused(true); },
  };
}
