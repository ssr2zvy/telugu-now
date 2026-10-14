import type { CSSProperties } from 'react';

export interface TextBox { x: number; y: number; width: number; height: number }
export interface LetterBox extends TextBox { start: number; end: number }
export interface TextLayout { letters: LetterBox[]; end: TextBox; style: CSSProperties; width: number; length?: number }

export function letterBoundaries(value: string): number[] {
  return [...new Intl.Segmenter('te', { granularity: 'grapheme' }).segment(value)].map(part => part.index).concat(value.length);
}

const boundaryCache = new WeakMap<HTMLTextAreaElement, { value: string; bounds: number[] }>();

/** Measure the complete shaped text, without wrapping individual Telugu code points in spans. */
export function measureKeyboardText(editor: HTMLTextAreaElement, visibleOnly = false): TextLayout {
  const computed = getComputedStyle(editor);
  const style: CSSProperties = { boxSizing: 'border-box', width: editor.clientWidth,
    whiteSpace: 'pre-wrap', overflowWrap: 'break-word',
    fontFamily: computed.fontFamily, fontSize: computed.fontSize, fontWeight: computed.fontWeight,
    fontStyle: computed.fontStyle, fontFeatureSettings: computed.fontFeatureSettings,
    fontVariationSettings: computed.fontVariationSettings, letterSpacing: computed.letterSpacing,
    wordSpacing: computed.wordSpacing, lineHeight: computed.lineHeight, textAlign: computed.textAlign as CSSProperties['textAlign'],
    direction: computed.direction as CSSProperties['direction'], tabSize: computed.tabSize,
    wordBreak: computed.wordBreak as CSSProperties['wordBreak'],
    paddingTop: computed.paddingTop, paddingBottom: computed.paddingBottom,
    paddingLeft: computed.paddingLeft, paddingRight: computed.paddingRight };
  const mirror = document.createElement('div');
  Object.assign(mirror.style, style, { width: `${editor.clientWidth}px`, position: 'fixed', left: '-100000px', top: '0', visibility: 'hidden', pointerEvents: 'none' });
  mirror.lang = 'te';
  // A zero-width sentinel measures the last line, including empty/trailing-newline drafts.
  const node = document.createTextNode(editor.value + '\u200b'); mirror.append(node);
  document.body.append(mirror);
  try {
    const origin = mirror.getBoundingClientRect();
    const range = document.createRange();
    const box = (start: number, end: number): TextBox => {
      range.setStart(node, start); range.setEnd(node, end);
      // A range can expose multiple fragments at a wrap. Never union them
      // into one rectangle spanning two rows.
      const rect = Array.from(range.getClientRects()).find(rect => rect.height > 0) ?? range.getBoundingClientRect();
      return { x: rect.left - origin.left, y: rect.top - origin.top, width: rect.width, height: rect.height || parseFloat(computed.lineHeight) || 33 };
    };
    const firstBox = box(0,Math.min(1,node.length));
    const lineHeight = parseFloat(computed.lineHeight) || firstBox.height;
    const paddingTop = parseFloat(computed.paddingTop) || 0;
    const rowBox = (raw: TextBox): TextBox => {
      const line = Math.round((raw.y - firstBox.y) / lineHeight);
      // Font range bounds may be taller than line-height (especially Telugu).
      // Keep every highlight and hit target within its actual CSS row.
      return { ...raw, y: paddingTop + line * lineHeight + 1, height: Math.max(1,lineHeight - 2) };
    };
    let cached = boundaryCache.get(editor);
    if (!cached || cached.value !== editor.value) {
      cached = { value: editor.value, bounds: letterBoundaries(editor.value) }; boundaryCache.set(editor,cached);
    }
    const bounds = cached.bounds;
    let first = 0, last = bounds.length - 1;
    if (visibleOnly && last > 0) {
      // Search line positions logarithmically, then measure only the viewport
      // and one screen of overscan. Keep shaping in the complete text node.
      const lower = (y: number) => {
        let lo = 0, hi = bounds.length - 1;
        while (lo < hi) {
          const mid = Math.floor((lo + hi) / 2);
          const rect = box(bounds[mid]!,bounds[mid + 1]!);
          if (rect.y + rect.height < y) lo = mid + 1; else hi = mid;
        }
        return lo;
      };
      first = Math.max(0,lower(editor.scrollTop - editor.clientHeight) - 1);
      last = Math.min(last,lower(editor.scrollTop + editor.clientHeight * 2) + 1);
    }
    const letters = bounds.slice(first,last).map((start,index) => ({ ...rowBox(box(start,bounds[first + index + 1]!)),start,end:bounds[first + index + 1]! }));
    return { letters, end: rowBox(box(editor.value.length, editor.value.length + 1)), style, width: editor.clientWidth, length: editor.value.length };
  } finally { mirror.remove(); }
}

export function caretBox(layout: TextLayout, offset: number, trailing = false): TextBox {
  const previous = trailing && layout.letters.find(letter => letter.end === offset);
  const next = layout.letters.find(letter => letter.start === offset);
  const letter = previous || next;
  const box = letter ? { ...letter, x: letter.x + (previous ? letter.width : 0) } : layout.end;
  const fontSize = parseFloat(String(layout.style.fontSize ?? ''));
  const height = Math.min(box.height,Number.isFinite(fontSize) ? fontSize : box.height);
  return { x: box.x, y: box.y, width: 0, height };
}

export interface TextHit { offset: number; trailing: boolean }
export function nearestLetterHit(layout: TextLayout, x: number, y: number): TextHit {
  const stops = layout.letters.flatMap(letter => [
    { offset: letter.start, trailing: false, x: letter.x, y: letter.y, height: letter.height },
    { offset: letter.end, trailing: true, x: letter.x + letter.width, y: letter.y, height: letter.height },
  ]);
  stops.push({ offset: layout.length ?? layout.letters.at(-1)?.end ?? 0, trailing: false, ...layout.end });
  // Decide the row first. Overlapping font bounds must never allow horizontal
  // proximity to pull a touch onto the preceding row.
  let best = stops[0]!; let rowDistance = Infinity; let columnDistance = Infinity;
  for (const stop of stops) {
    const dy = Math.abs(y - (stop.y + stop.height / 2));
    const dx = Math.abs(stop.x - x);
    if (dy < rowDistance - .5 || (Math.abs(dy - rowDistance) <= .5 && dx < columnDistance)) {
      best = stop; rowDistance = dy; columnDistance = dx;
    }
  }
  return { offset: best.offset, trailing: best.trailing };
}
export function nearestLetterOffset(layout: TextLayout, x: number, y: number): number {
  return nearestLetterHit(layout,x,y).offset;
}

export function selectionBoxes(layout: TextLayout, start: number, end: number): TextBox[] {
  const boxes: TextBox[] = [];
  for (const letter of layout.letters) {
    if (letter.start < start || letter.end > end) continue;
    const last = boxes.at(-1);
    if (last && Math.abs(last.y - letter.y) < 1 && letter.x <= last.x + last.width + 1) {
      last.width = Math.max(last.width, letter.x + letter.width - last.x);
    } else boxes.push({ x: letter.x, y: letter.y, width: Math.max(2, letter.width), height: letter.height });
  }
  return boxes;
}
