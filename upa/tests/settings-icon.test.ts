import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SettingsIcon } from '../frontend/src/components/icons';
import { AppearanceProvider } from '../frontend/src/appearance';

test('settings icon uses the shared palette glass without changing its gear geometry', () => {
  const markup = renderToStaticMarkup(createElement(AppearanceProvider, null, createElement(SettingsIcon)));
  assert.match(markup, /style="stroke:var\(--control-icon-paint, currentColor\)"/);
  assert.match(markup, /<linearGradient id="control-material-/);
  assert.match(markup, /<circle cx="12" cy="12" r="3"/);
  assert.match(markup, /aria-hidden="true"/);
  assert.equal((markup.match(/<stop /g) ?? []).length, 3);
});
