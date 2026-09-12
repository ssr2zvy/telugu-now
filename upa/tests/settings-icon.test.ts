import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SettingsIcon } from '../frontend/src/components/icons';
import { appearanceAudioGlass, DEFAULT_APPEARANCE } from '../frontend/src/appearance';

test('settings icon uses the shared palette glass without changing its gear geometry', () => {
  const markup = renderToStaticMarkup(createElement(SettingsIcon));
  assert.match(markup, /style="stroke:url\(#settings-glass-/);
  assert.match(markup, /<linearGradient id="settings-glass-/);
  assert.match(markup, /<circle cx="12" cy="12" r="3"/);
  assert.match(markup, /aria-hidden="true"/);
  const stops = appearanceAudioGlass(DEFAULT_APPEARANCE).stops;
  assert.equal((markup.match(/<stop /g) ?? []).length, stops.length);
  for (const stop of stops) {
    assert.ok(markup.includes(`stop-color="${stop.color}"`));
    assert.ok(markup.includes(`stop-opacity="${stop.opacity}"`));
  }
});
