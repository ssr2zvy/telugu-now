import type { ClipboardEvent } from 'react';

/** Display-only discretionary hyphens. Never add them to stored corpus text. */
export const DISPLAY_HYPHEN = '\u00ad';
export function readerGraphemes(text: string): string[] {
  return [...new Intl.Segmenter('te', { granularity: 'grapheme' }).segment(text)].map(part => part.segment);
}

/** Decide at the preferred font size, before fitting to available height. */
export function markOversizedReaderWords(root: HTMLElement): void {
  const words = [...root.querySelectorAll<HTMLElement>('.telugu-word')];
  // Batch writes before reads so previously wrapped words are measured unbroken.
  for (const word of words) word.removeAttribute('data-hyphenate');
  const oversized = words.filter(word => word.getBoundingClientRect().width > root.clientWidth + 1);
  for (const word of oversized) word.dataset.hyphenate = 'true';
}

/** Native copy keeps the user's selected source text, excluding our layout marks. */
export function copyOriginalReaderText(event: ClipboardEvent<HTMLElement>): void {
  const selection = window.getSelection();
  if (!selection?.rangeCount || selection.isCollapsed) return;
  const range = selection.getRangeAt(0);
  if (!event.currentTarget.contains(range.commonAncestorContainer)) return;
  const fragment = range.cloneContents();
  fragment.querySelectorAll('[data-reader-display-only], [data-reader-concealed]').forEach(node => node.remove());
  event.clipboardData.setData('text/plain', fragment.textContent ?? '');
  event.preventDefault();
}

/** Offscreen fitting uses the same word/break structure as the live renderer. */
export function populateReaderMeasurement(root: HTMLElement, text: string): void {
  for (const part of text.split(/(\s+)/u)) {
    if (!part) continue;
    if (/^\s+$/u.test(part)) { root.append(document.createTextNode(part)); continue; }
    const word = document.createElement('span');
    word.className = 'telugu-word';
    readerGraphemes(part).forEach((grapheme, index) => {
      if (index) {
        const hyphen = document.createElement('span');
        hyphen.dataset.readerDisplayOnly = 'true';
        hyphen.className = 'reader-discretionary-hyphen';
        hyphen.textContent = DISPLAY_HYPHEN;
        word.append(hyphen);
      }
      word.append(document.createTextNode(grapheme));
    });
    root.append(word);
  }
}
