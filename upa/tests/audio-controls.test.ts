import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AudioScrubber } from '../frontend/src/observation/audio/AudioScrubber';
import { AudioPlayerBar } from '../frontend/src/observation/audio/AudioPlayerBar';
import { AudioGlassIcon } from '../frontend/src/observation/audio/AudioGlassIcon';
import { AUDIO_ICON_SHAPES } from '../frontend/src/components/icons';
import { precisionControls } from '../frontend/src/observation/audio/precision-controls';
import { AUDIO_PLAYER_PRESENTATION } from '../frontend/src/observation/audio/audio-player-presentation';

const scrubberProps = {
  currentTime: 2,
  duration: 10,
  waveformPeaks: [0, 0.5, 1],
  bookmarks: [1],
  disabled: false,
  onSeek: () => {},
  onPrecisionSeek: () => {},
  onMagnifierOpen: () => {},
  onMagnifierClose: () => {},
};

test('normal audio controls do not render precision until explicitly opened', () => {
  const closed = renderToStaticMarkup(createElement(AudioScrubber, { ...scrubberProps, magnifierOpen: false }));
  assert.match(closed, /aria-label="Audio position"/);
  assert.match(closed, /aria-expanded="false"/);
  assert.doesNotMatch(closed, /class="audio-magnifier"/);
  assert.doesNotMatch(closed, /Precise audio position/);
  const open = renderToStaticMarkup(createElement(AudioScrubber, { ...scrubberProps, magnifierOpen: true }));
  assert.match(open, /class="audio-magnifier"/);
  assert.match(open, /aria-label="Precise audio position"/);
  assert.match(open, /aria-expanded="true"/);
  assert.equal(AUDIO_PLAYER_PRESENTATION.magnifierHoldMs, 300);
  assert.ok(AUDIO_PLAYER_PRESENTATION.magnifierPressureThreshold > 0.5);
});

test('normal player has no play button and keeps precision-only actions hidden', () => {
  const markup = renderToStaticMarkup(createElement(AudioPlayerBar, {
    audio: { url: '/api/audio/fixture.wav', mimeType: 'audio/wav', durationSeconds: 10 },
    sourceId: 'fixture', sourceKey: 'one', defaultPlaybackRate: 1, controlsVisible: true,
  }));
  assert.match(markup, /data-magnifier-position="below"/);
  assert.doesNotMatch(markup, /audio-play-button/);
  assert.doesNotMatch(markup, /audio-speed-button|audio-bookmark-button|audio-precision-actions|audio-speed-popover/);
  assert.equal((markup.match(/<button /g) ?? []).length, 0);
  assert.match(markup, /<audio[^>]*preload="auto"/);
  assert.match(markup, /aria-label="Audio position"/);
  assert.match(markup, /--audio-icon-paint:url\(#audio-glass-/);
  assert.match(markup, /--audio-glass-gradient:linear-gradient/);
  assert.match(markup, /<linearGradient id="audio-glass-/);
  assert.equal((markup.match(/<stop /g) ?? []).length, 3);
  const opacities = [...markup.matchAll(/stop-opacity="([^"]+)"/g)].map(match => Number(match[1]));
  assert.equal(opacities.length, 3);
  assert.ok(opacities[0]! < opacities[1]! && opacities[2]! < opacities[1]!, 'glass edges fade more than the center');
  assert.doesNotMatch(markup, /audio-primary-controls|class="audio-magnifier"/);
});

test('precision actions mount and unmount in the same branch as the magnifier', () => {
  const actions = createElement('div', { className: 'audio-precision-actions' },
    createElement('button', { 'aria-label': 'Playback speed' }, createElement(AudioGlassIcon, { name: 'speed' })),
    createElement('button', { 'aria-label': 'Bookmarks' }, createElement(AudioGlassIcon, { name: 'bookmark' })));
  for (const open of [false, true, false]) {
    const markup = renderToStaticMarkup(createElement(AudioScrubber, {
      ...scrubberProps, magnifierOpen: open, precisionControls: actions,
    }));
    assert.equal(markup.includes('class="audio-magnifier"'), open);
    assert.equal(markup.includes('class="audio-precision-panel"'), open);
    assert.equal(markup.includes('class="audio-scrubber-window"'), open);
    assert.equal(markup.includes('class="audio-precision-actions"'), open);
    assert.equal(markup.includes('aria-label="Playback speed"'), open);
    assert.equal(markup.includes('aria-label="Bookmarks"'), open);
    assert.match(markup, /aria-label="Audio position"/);
    if (open) assert.ok(markup.indexOf('class="audio-magnifier"') < markup.indexOf('class="audio-precision-actions"'));
  }
});

test('precision mode cannot leave speed open or reopen the magnifier after dismissal', () => {
  assert.equal(precisionControls('closed', 'toggle-speed'), 'closed');
  const magnifier = precisionControls('closed', 'open');
  assert.equal(magnifier, 'magnifier');
  const speed = precisionControls(magnifier, 'toggle-speed');
  assert.equal(speed, 'speed');
  assert.equal(precisionControls(speed, 'toggle-speed'), 'magnifier');
  assert.equal(precisionControls(speed, 'close-speed'), 'magnifier');
  const dismissed = precisionControls(speed, 'close');
  assert.equal(dismissed, 'closed');
  assert.equal(precisionControls(dismissed, 'close-speed'), 'closed');
  assert.equal(precisionControls(magnifier, 'close'), 'closed');
});

test('glass icon masks reuse the SVG geometry, including the stroked speed icon', () => {
  for (const name of ['play', 'pause', 'speed', 'bookmark'] as const) {
    const markup = renderToStaticMarkup(createElement(AudioGlassIcon, { name }));
    const encoded = markup.match(/data:image\/svg\+xml,([^&"]+)/)?.[1];
    assert.ok(encoded);
    const mask = decodeURIComponent(encoded);
    const shape = AUDIO_ICON_SHAPES[name];
    assert.ok(mask.includes(`fill="${shape.filled ? 'black' : 'none'}"`));
    assert.ok(mask.includes(`stroke="${shape.filled ? 'none' : 'black'}"`));
    for (const path of shape.paths) assert.ok(mask.includes(`d="${path}"`));
    assert.match(markup, /<svg class="control-icon/);
    assert.match(markup, /aria-hidden="true"/);
  }
});

test('the bar and dot share icon glass with no play-button row', () => {
  const css = readFileSync(new URL('../frontend/src/styles/observation-layout.css', import.meta.url), 'utf8');
  assert.doesNotMatch(css, /\.audio-play-button/);
  const paint = css.match(/(\.audio-scrubber::before,[^{]+)\{ background: var\(--audio-glass-gradient\);/);
  for (const selector of ['audio-scrubber-progress', 'audio-scrubber-thumb', 'audio-scrubber-bookmark',
    'audio-magnifier-bar', 'audio-magnifier-playhead', 'audio-speed-track::before', 'audio-speed-fill', 'audio-speed-thumb']) {
    assert.ok(paint?.[1]?.includes(`.${selector}`), `${selector} must share the glass gradient`);
  }
  assert.match(css, /\.audio-glass-icon \{ background: var\(--audio-glass-gradient\);/);
  assert.match(css, /\.audio-transport-button svg \{ stroke: var\(--audio-icon-paint\)/);
  assert.match(css, /\.audio-transport-button \.control-icon-fill \{ fill: var\(--audio-icon-paint\); stroke: none/);
  assert.match(css, /--audio-base-bottom: var\(--audio-placement-bottom\)/);
  assert.match(css, /--audio-min-bottom: var\(--audio-placement-bottom\)/);
  assert.doesNotMatch(css, /safe-area-inset-bottom\) \+ (48|64)px/);
  assert.match(css, /\.audio-transport-button \{[^}]*background: transparent/);
  assert.match(css, /\.audio-precision-panel \{[^}]*grid-row: 2;[^}]*grid-template-rows: 88px 44px/);
  assert.match(css, /\.audio-precision-actions \{[^}]*grid-row: 2;[^}]*grid-template-columns: repeat\(2, 48px\)/);
  assert.match(css, /\[data-magnifier-position="above"\] \.audio-precision-panel \{ grid-row: 1/);
  assert.match(css, /\.audio-magnifier::before \{[^}]*backdrop-filter: blur\(12px\)[^}]*mask-image: linear-gradient/);
  assert.match(css, /\.audio-precision-panel::before \{[^}]*clip-path: polygon\(var\(--audio-window-start\)/);
  assert.match(css, /\.audio-playback-status \{[^}]*clip-path: inset\(50%\)/);
  assert.match(css, /\.audio-loading-indicator \{ animation: none;/);
  assert.match(css, /\.audio-scrubber \{ grid-row: 1; grid-column: 1 \/ -1/);
  assert.match(css, /\.audio-glass-icon \{[^}]*mask-image: var\(--audio-icon-mask\)[^}]*backdrop-filter: blur\(5px\)/);
});
