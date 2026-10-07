import type { CSSProperties } from 'react';

export interface TextBox { x: number; y: number; width: number; height: number }
export interface LetterBox extends TextBox { start: number; end: number }
export interface TextLayout { letters: LetterBox[]; end: TextBox; style: CSSProperties; width: number }

export function letterBoundaries(value: string): number[] {
  return [...new Intl.Segmenter('te', { granularity: 'grapheme' }).segment(value)].map(part => part.index).concat(value.length);
}

/** Measure the complete shaped text, without wrapping individual Telugu code points in spans. */
export function measureKeyboardText(editor: HTMLTextAreaElement): TextLayout {
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
      const rect = range.getBoundingClientRect();
      return { x: rect.left - origin.left, y: rect.top - origin.top, width: rect.width, height: rect.height || parseFloat(computed.lineHeight) || 33 };
    };
    const bounds = letterBoundaries(editor.value);
    const letters = bounds.slice(0, -1).map((start, index) => ({ ...box(start, bounds[index + 1]!), start, end: bounds[index + 1]! }));
    return { letters, end: box(editor.value.length, editor.value.length + 1), style, width: editor.clientWidth };
  } finally { mirror.remove(); }
}

export function caretBox(layout: TextLayout, offset: number, trailing = false): TextBox {
  const previous = trailing && layout.letters.find(letter => letter.end === offset);
  const next = layout.letters.find(letter => letter.start === offset);
  const letter = previous || next;
  if (!letter) return { ...layout.end, width: 0 };
  return { x: letter.x + (previous ? letter.width : 0), y: letter.y, width: 0, height: letter.height };
}

export function nearestLetterOffset(layout: TextLayout, x: number, y: number): number {
  const stops = layout.letters.flatMap(letter => [
    { offset: letter.start, x: letter.x, y: letter.y, height: letter.height },
    { offset: letter.end, x: letter.x + letter.width, y: letter.y, height: letter.height },
  ]);
  stops.push({ offset: layout.letters.at(-1)?.end ?? 0, ...layout.end });
  let best = stops[0]!; let distance = Infinity;
  for (const stop of stops) {
    const dy = Math.max(stop.y - y, y - stop.y - stop.height, 0);
    const score = dy * 10000 + Math.abs(stop.x - x);
    if (score < distance) { best = stop; distance = score; }
  }
  return best.offset;
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
