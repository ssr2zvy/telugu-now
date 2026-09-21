import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { load } from 'cheerio';
import { readFileSync } from 'node:fs';
import { TeluguWordText } from '../frontend/src/observation/TeluguGradientText';
import { teluguHighlightRuns } from '../frontend/src/observation/telugu-highlighting';
import { DISPLAY_HYPHEN, readerGraphemes, markOversizedReaderWords } from '../frontend/src/observation/reader-hyphenation';
import { textRange } from '../frontend/src/observation/visible-glyph-hit-testing';

for (const highlight of [false, true]) {
  test(`display breaks preserve source and whole graphemes (highlight=${highlight})`, () => {
    const text = 'నేను ఇవ్వాలనుకుంటున్నాను. క్షేత్రం';
    const $ = load(renderToStaticMarkup(createElement(TeluguWordText, {
      text, runs: highlight ? teluguHighlightRuns(text) : null, textures: null,
    })));
    $('.telugu-word').each((_i, element) => {
      const word = $(element);
      const original = word.text().replaceAll(DISPLAY_HYPHEN, '');
      assert.deepEqual(word.text().split(DISPLAY_HYPHEN), readerGraphemes(original));
    });
    assert.ok($('[data-reader-display-only]').length > 0);
    $('[data-reader-display-only]').remove();
    assert.equal($('body').text(), text);
  });
}

test('conjuncts, vowel marks, joiners and emoji are never cut internally', () => {
  for (const text of ['క్షి', 'కా', 'క్\u200dషి', '👨‍👩‍👧‍👦']) {
    assert.deepEqual(readerGraphemes(text), [text]);
  }
});

test('only words exceeding the available width become breakable, including after resize', () => {
  const makeWord = (width: number) => ({ dataset: {} as Record<string, string>, removeAttribute() { delete this.dataset.hyphenate; }, getBoundingClientRect: () => ({ width }) });
  const words = [makeWord(40), makeWord(199), makeWord(260)];
  const root = { clientWidth: 200, querySelectorAll: () => words };
  markOversizedReaderWords(root as unknown as HTMLElement);
  assert.deepEqual(words.map(word => word.dataset.hyphenate), [undefined, undefined, 'true']);
  root.clientWidth = 300;
  markOversizedReaderWords(root as unknown as HTMLElement);
  assert.ok(words.every(word => !word.dataset.hyphenate));
});

test('source ranges ignore display-only characters before and inside a word', () => {
  const oldDocument = globalThis.document;
  const oldFilter = globalThis.NodeFilter;
  const node = (text: string, display = false) => ({ textContent: text, parentElement: { closest: () => display ? {} : null } });
  const nodes = [node('నే'), node(DISPLAY_HYPHEN, true), node('ను '), node('వ'), node(DISPLAY_HYPHEN, true), node('చ్చాను')];
  let index = 0;
  const recorded: unknown[] = [];
  const fakeRange = { setStart: (...args: unknown[]) => recorded.push(args), setEnd: (...args: unknown[]) => recorded.push(args) };
  try {
    globalThis.NodeFilter = { SHOW_TEXT: 4 } as typeof NodeFilter;
    globalThis.document = { createTreeWalker: () => ({ nextNode: () => nodes[index++] }), createRange: () => fakeRange } as unknown as Document;
    assert.equal(textRange({} as Element, 'నేను '.length, 'నేను వచ్చాను'.length), fakeRange);
    assert.deepEqual(recorded, [[nodes[2], 'ను '.length], [nodes[5], 'చ్చాను'.length]]);
  } finally { globalThis.document = oldDocument; globalThis.NodeFilter = oldFilter; }
});

test('reader page resets animation and question controls in a layout effect', () => {
  const source = readFileSync(new URL('../frontend/src/observation/ObservationView.tsx', import.meta.url), 'utf8');
  assert.match(source, /useLayoutEffect\(\(\) => \{\s*taps.cancel\(\);[\s\S]*?setQuestionControlsVisible\(false\);[\s\S]*?setAudioMotion\('idle'\)/);
  assert.match(source, /observation.question.mode === 'audio-given' && observation.audio/);
});
