import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from 'cheerio';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReadingContextMenu } from '../frontend/src/observation/ReadingContextMenu';
import { FreeTypingScreen } from '../frontend/src/observation/FreeTypingScreen';
import { GoogleTeluguKeyboard } from '../frontend/src/observation/GoogleTeluguKeyboard';

test('reading menu offers exactly two icon-only actions for every text scope', () => {
  for (const text of ['తెలుగు భాష', 'తెలుగు', 'తె']) {
    const html = renderToStaticMarkup(createElement(ReadingContextMenu, {
      menu: { text, x: 100, y: 150 }, onCopy: async () => {}, onKeyboard() {}, onClose() {},
    }));
    assert.equal((html.match(/role="menuitem"/g) ?? []).length, 2);
    assert.match(html, /aria-label="Copy"/);
    assert.match(html, /aria-label="Free typing"/);
    assert.equal(load(html).text(), '');
  }
});

test('free typing uses the existing keyboard, retains multiline text, and has no audio or submit action', () => {
  const html = renderToStaticMarkup(createElement(FreeTypingScreen, {
    value: 'తెలుగు\nభాష', onChange() {}, fontFamily: 'Noto Sans Telugu', onBack() {},
  }));
  assert.match(html, /aria-label="Back to reading"/);
  assert.match(html, /aria-label="Telugu InScript keyboard"/);
  assert.match(html, /aria-label="New line"/);
  assert.match(html, /తెలుగు\nభాష<\/textarea>/);
  assert.doesNotMatch(html, /<audio|audio-player-bar|Show comparison|Typed answer/);
});

test('question keyboard still exposes its original answer and comparison actions', () => {
  const html = renderToStaticMarkup(createElement(GoogleTeluguKeyboard, { value: '', onChange() {}, onSubmit() {} }));
  assert.match(html, /aria-label="Show comparison"/);
  assert.match(html, /aria-label="Typed answer"/);
  assert.doesNotMatch(html, /aria-label="New line"/);
});
