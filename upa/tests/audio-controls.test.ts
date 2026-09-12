import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AudioScrubber } from '../frontend/src/observation/audio/AudioScrubber';
import { AudioPlayerBar } from '../frontend/src/observation/audio/AudioPlayerBar';
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

test('player starts with Play above and separate inline speed and bookmark controls', () => {
  const markup = renderToStaticMarkup(createElement(AudioPlayerBar, {
    audio: { url: '/api/audio/fixture.wav', mimeType: 'audio/wav', durationSeconds: 10 },
    sourceId: 'fixture', sourceKey: 'one', defaultPlaybackRate: 1, controlsVisible: true,
  }));
  assert.match(markup, /data-magnifier-position="below"/);
  assert.match(markup, /audio-play-button/);
  assert.match(markup, /audio-speed-button/);
  assert.match(markup, /audio-bookmark-button/);
  assert.match(markup, /--audio-icon-paint:url\(#audio-glass-/);
  assert.match(markup, /--audio-glass-gradient:linear-gradient/);
  assert.match(markup, /<linearGradient id="audio-glass-/);
  assert.equal((markup.match(/<stop /g) ?? []).length, 5);
  assert.match(markup, /stop-opacity="0\.42"/);
  assert.doesNotMatch(markup, /audio-primary-controls|class="audio-magnifier"/);
});

test('Play stays page-centered, all audio shapes use glass paint, and the default bottom inset is lowered', () => {
  const css = readFileSync(new URL('../frontend/src/styles/observation-layout.css', import.meta.url), 'utf8');
  const play = css.match(/^\.audio-play-button \{([^}]+)\}/m)?.[1];
  assert.match(play ?? '', /grid-column: 1 \/ -1/);
  assert.match(play ?? '', /justify-self: center/);
  assert.match(play ?? '', /grid-row: 1/);
  const paint = css.match(/(\.audio-scrubber::before,[^{]+)\{ background: var\(--audio-glass-gradient\);/);
  for (const selector of ['audio-scrubber-progress', 'audio-scrubber-thumb', 'audio-scrubber-bookmark',
    'audio-magnifier-bar', 'audio-magnifier-playhead', 'audio-speed-track::before', 'audio-speed-fill', 'audio-speed-thumb']) {
    assert.ok(paint?.[1]?.includes(`.${selector}`), `${selector} must share the glass gradient`);
  }
  assert.match(css, /\.audio-transport-button svg \{ stroke: var\(--audio-icon-paint\)/);
  assert.match(css, /\.audio-transport-button \.control-icon-fill \{ fill: var\(--audio-icon-paint\); stroke: none/);
  assert.match(css, /--audio-base-bottom: var\(--audio-placement-bottom\)/);
  assert.match(css, /--audio-min-bottom: var\(--audio-placement-bottom\)/);
  assert.doesNotMatch(css, /safe-area-inset-bottom\) \+ (48|64)px/);
  assert.match(css, /\.audio-transport-button \{[^}]*background: transparent/);
});
