import { useEffect, useLayoutEffect, useRef, useState, type DOMAttributes, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { caretBox, letterBoundaries, measureKeyboardText, nearestLetterHit, textLineHit, selectionBoxes, type TextLayout, type TextBox } from './keyboard-text-layout';

type Selection = { start: number; end: number };
interface Drag { id: number; x: number; y: number; top: number; anchor: number; active: boolean; moved: boolean; mode: 'range' | 'caret'; blank: boolean; biasX: number; biasY: number }

export function useKeyboardSelection(editor: RefObject<HTMLDivElement | null>, input: RefObject<HTMLTextAreaElement | null>, value: string,
  selection: RefObject<Selection>, enabled: boolean, caretVisible: boolean, options: { metricKey: number; selectionMode: boolean; onSelectionMode: (on: boolean) => void; documentMode: boolean; keyboardVisible: boolean; onActivate?: () => void }) {
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
  const lastTap = useRef({time:0,x:0,y:0});
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
    const element = input.current;
    if (!element) return;
    const { start, end } = selection.current;
    if (element.selectionStart !== start || element.selectionEnd !== end) element.setSelectionRange(start, end);
  };
  useLayoutEffect(() => {
    selection.current = { start: Math.min(selection.current.start, value.length), end: Math.min(selection.current.end, value.length) };
    setNativeRange();
  }, [value, revision]);
  useLayoutEffect(refresh, [value, enabled, options.keyboardVisible, options.metricKey]);
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
    const restyled = new MutationObserver(refresh); restyled.observe(element,{attributes:true,attributeFilter:['style','class']});
    window.addEventListener('blur', abandon);
    document.fonts.addEventListener('loadingdone',refresh);
    let alive = true;
    void document.fonts.ready.then(() => { if (alive) refresh(); });
    return () => {
      document.fonts.removeEventListener('loadingdone',refresh);
      alive = false; cancelAnimationFrame(scrollFrame); stop(); drag.current = null; resize.disconnect(); restyled.disconnect();
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
  const lineHitAt = (x: number, y: number) => {
    const element = editor.current, measured = layoutRef.current;
    if (!element || !measured) return null;
    const rect = element.getBoundingClientRect();
    if (x<rect.left || x>rect.right || y<rect.top || y>rect.bottom) return null;
    return textLineHit(measured,x-rect.left+element.scrollLeft,y-rect.top+element.scrollTop);
  };
  const isText = (x: number, y: number) => {
    const element = editor.current, measured = layoutRef.current;
    if (!element || !measured) return false;
    const rect = element.getBoundingClientRect();
    const px = x - rect.left + element.scrollLeft, py = y - rect.top + element.scrollTop;
    return measured.letters.some(letter => /\S/u.test(latest.current.value.slice(letter.start,letter.end)) && px >= letter.x - 2 && px <= letter.x + letter.width + 2 && py >= letter.y && py <= letter.y + letter.height);
  };
  const clearSelectionMode = () => { latest.current.options.onSelectionMode(false); select(focusOffset.current); setAdjusting(false); };
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      const target = event.target as Element;
      if (enabled && !editor.current?.closest('.google-telugu-input')?.contains(target) && !target.closest('button')) clearSelectionMode();
    };
    document.addEventListener('pointerup',outside);
    return () => document.removeEventListener('pointerup',outside);
  },[enabled]);
  const selectWord = (x: number, y: number) => {
    if (!isText(x,y)) return;
    const hit = offsetAt(x,y);
    const parts = [...new Intl.Segmenter('te',{granularity:'word'}).segment(latest.current.value)];
    const part = parts.find(p => p.segment.trim() && p.index <= hit.offset && hit.offset < p.index + p.segment.length)
      ?? parts.find(p => p.segment.trim() && p.index < hit.offset && hit.offset <= p.index + p.segment.length);
    if (!part || !part.segment.trim()) return;
    latest.current.options.onSelectionMode(true); select(part.index,part.index + part.segment.length,true);
    setAdjusting(true); setFocused(true); latest.current.options.onActivate?.();
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
    if (!window.matchMedia('(pointer: coarse)').matches) input.current?.focus({ preventScroll: true });
    moveSelection(point); autoScroll();
  };
  const handlers: DOMAttributes<HTMLDivElement> = {
    onPointerDownCapture(event) {
      const target = event.target as Element;
      const handle = target.closest<HTMLElement>('[data-selection-handle]');
      suppressClick.current = false;
      if (event.target !== editor.current && !handle) { if (!target.closest('button, .question-keyboard')) clearSelectionMode(); return; }
      if (!enabled || !event.isPrimary || event.button !== 0) return;
      abandon(); suppressClick.current = false; refresh();
      event.preventDefault(); event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId);
      const kind = handle?.dataset.selectionHandle;
      const anchor = kind === 'start' ? selection.current.end : kind === 'end' ? selection.current.start : offsetAt(event.clientX, event.clientY).offset;
      const point: Drag = { id: event.pointerId, x: event.clientX, y: event.clientY, top: editor.current?.scrollTop ?? 0,
        anchor, active: false, moved: false, mode: kind === 'start' || kind === 'end' || latest.current.options.selectionMode ? 'range' : 'caret', biasX: 0, biasY: 0, blank: !handle && !lineHitAt(event.clientX,event.clientY) };
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
      else if (!point.blank) timer.current = setTimeout(() => begin(point), 500);
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
        if (point.blank) clearSelectionMode();
        else if (!isText(event.clientX,event.clientY)) {
          clearSelectionMode();
          const hit=lineHitAt(event.clientX,event.clientY);
          if (hit) {select(hit.offset,hit.offset,hit.trailing); latest.current.options.onActivate?.(); setFocused(true);}
          lastTap.current.time=0;
        } else {
          const now = performance.now(), previous = lastTap.current;
          if (now - previous.time < 350 && Math.hypot(event.clientX-previous.x,event.clientY-previous.y) < 24) {
            selectWord(event.clientX,event.clientY); lastTap.current = {time:now,x:event.clientX,y:event.clientY};
          } else {
            const hit = offsetAt(event.clientX,event.clientY); select(hit.offset,hit.offset,hit.trailing);
            lastTap.current = {time:now,x:event.clientX,y:event.clientY};
            latest.current.options.onActivate?.(); setFocused(true);
          }
          if (!window.matchMedia('(pointer: coarse)').matches) input.current?.focus({preventScroll:true});
        }
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
    onDoubleClickCapture(event) { event.preventDefault(); event.stopPropagation(); if (!(event.target as Element).closest('button,.question-keyboard')) selectWord(event.clientX,event.clientY); },
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
  const navigate = (key: string, extend: boolean) => {
    const measured = layoutRef.current;
    if (!measured) return;
    const offset = focusOffset.current, boundaries = letterBoundaries(latest.current.value);
    let next = offset;
    if (key === 'ArrowLeft') next = !extend && ranged ? current.start : boundaries.filter(n => n < offset).at(-1) ?? 0;
    else if (key === 'ArrowRight') next = !extend && ranged ? current.end : boundaries.find(n => n > offset) ?? value.length;
    else {
      const box = caretBox(measured,offset,focusTrailing.current);
      const lineHeight = parseFloat(String(measured.style.lineHeight)) || box.height;
      next = nearestLetterHit(measured,key === 'Home' ? -1 : key === 'End' ? measured.width+1 : box.x,
        box.y + box.height/2 + (key === 'ArrowUp' ? -lineHeight : key === 'ArrowDown' ? lineHeight : 0)).offset;
    }
    const anchor = offset === current.start ? current.end : current.start;
    select(extend ? anchor : next,next); setFocused(true);
  };
  return { select, navigate, handlers, overlay, handles, chrome, copyText: ranged ? value.slice(current.start, current.end) : value,
    toggleSelection: (on: boolean) => { abandon(); if (!on) select(focusOffset.current); },
    onFocus: () => setFocused(true),
    // Native input is only a hardware-keyboard bridge. It never owns our selection.
    onNativeSelect: () => {},
    onEdit: () => { setAdjusting(false); setFocused(true); },
  };
}
