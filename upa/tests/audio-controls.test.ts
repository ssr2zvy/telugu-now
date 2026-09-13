import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AudioScrubber } from '../frontend/src/observation/audio/AudioScrubber';
import { AudioPlayerBar } from '../frontend/src/observation/audio/AudioPlayerBar';
import { PlaybackSpeedPopover } from '../frontend/src/observation/audio/PlaybackSpeedPopover';
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
  assert.doesNotMatch(closed, /class="audio-magnifier-track"/);
  assert.doesNotMatch(closed, /Precise audio position/);
  const open = renderToStaticMarkup(createElement(AudioScrubber, { ...scrubberProps, magnifierOpen: true }));
  assert.match(open, /class="audio-magnifier-track"/);
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
  assert.doesNotMatch(markup, /audio-speed-button|audio-bookmark-button|audio-speed-popover/);
  assert.equal((markup.match(/<button /g) ?? []).length, 0);
  assert.match(markup, /<audio[^>]*preload="auto"/);
  assert.match(markup, /aria-label="Audio position"/);
  assert.match(markup, /--audio-icon-paint:url\(#audio-glass-/);
  assert.match(markup, /--audio-glass-gradient:linear-gradient/);
  assert.ok(markup.includes(`--audio-slide-duration:${AUDIO_PLAYER_PRESENTATION.controlsSlideMs}ms`));
  assert.match(markup, /<linearGradient id="audio-glass-/);
  assert.equal((markup.match(/<stop /g) ?? []).length, 3);
  const opacities = [...markup.matchAll(/stop-opacity="([^"]+)"/g)].map(match => Number(match[1]));
  assert.equal(opacities.length, 3);
  assert.ok(opacities[0]! < opacities[1]! && opacities[2]! < opacities[1]!, 'glass edges fade more than the center');
  assert.doesNotMatch(markup, /audio-primary-controls|class="audio-magnifier-track"/);
});

test('bookmark and speed buttons flank the scrubber and only mount while the magnifier is open', () => {
  const bookmarkButton = createElement('button', { className: 'audio-bookmark-button', 'aria-label': 'Bookmarks' });
  const speedButton = createElement('button', { className: 'audio-speed-button', 'aria-label': 'Playback speed' });
  for (const open of [false, true, false]) {
    const markup = renderToStaticMarkup(createElement(AudioScrubber, {
      ...scrubberProps, magnifierOpen: open, bookmarkButton, speedButton,
    }));
    assert.equal(markup.includes('class="audio-magnifier-track"'), open);
    assert.equal(markup.includes('class="audio-precision-panel"'), open);
    assert.equal(markup.includes('class="audio-scrubber-window"'), open);
    assert.equal(markup.includes('aria-label="Bookmarks"'), open);
    assert.equal(markup.includes('aria-label="Playback speed"'), open);
    assert.match(markup, /aria-label="Audio position"/);
    if (open) {
      const row = markup.match(/class="audio-scrubber-row"[\s\S]*?class="audio-precision-panel"/)?.[0] ?? '';
      // Bookmark precedes the scrubber bar, which precedes the speed button, within the same row.
      assert.ok(row.indexOf('aria-label="Bookmarks"') < row.indexOf('aria-label="Audio position"'));
      assert.ok(row.indexOf('aria-label="Audio position"') < row.indexOf('aria-label="Playback speed"'));
      assert.ok(markup.indexOf('class="audio-magnifier-track"') < markup.indexOf('class="audio-magnifier-time"'));
    }
  }
});

test('speed replaces the waveform and highlight until toggled back', () => {
  const speedControls = createElement(PlaybackSpeedPopover, {
    playbackRate: 0.8, onChange: () => {}, onClose: () => {}, dismissOnOutside: false,
  });
  let mode = precisionControls('closed', 'open');
  for (const action of ['toggle-speed', 'toggle-speed', 'toggle-speed', 'close'] as const) {
    mode = precisionControls(mode, action);
    const markup = renderToStaticMarkup(createElement(AudioScrubber, {
      ...scrubberProps, magnifierOpen: mode !== 'closed',
      speedControls: mode === 'speed' ? speedControls : undefined,
    }));
    assert.equal(markup.includes('class="audio-speed-popover"'), mode === 'speed');
    assert.equal(markup.includes('class="audio-magnifier-track"'), mode === 'magnifier');
    assert.equal(markup.includes('class="audio-scrubber-window"'), mode === 'magnifier');
    assert.match(markup, /aria-label="Audio position"/);
    if (mode === 'speed') {
      assert.match(markup, /aria-orientation="horizontal"/);
      const width = Number(markup.match(/class="audio-speed-fill" style="width:([\d.]+)%"/)?.[1]);
      const left = Number(markup.match(/class="audio-speed-thumb" style="left:([\d.]+)%"/)?.[1]);
      assert.ok(Math.abs(width - 50) < 1e-9);
      assert.ok(Math.abs(left - 50) < 1e-9);
      assert.match(markup, /0\.80x/);
    }
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
  for (const selector of ['audio-scrubber-progress', 'audio-scrubber-thumb', 'audio-scrubber-bookmark', 'audio-scrubber-window',
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
  assert.match(css, /\.audio-player-bar \{[^}]*grid-template-rows: 48px 116px;[^}]*gap: var\(--audio-timestamp-gap, 1px\) 0;/);
  assert.match(css, /\.audio-precision-panel \{[^}]*grid-row: 2;[^}]*display: flex; flex-direction: column/);
  assert.match(css, /\.audio-precision-panel \{[^}]*gap: var\(--timestamp-magnifier-gap, 1px\)/);
  assert.doesNotMatch(css, /--audio-control-gap/);
  assert.match(css, /\[data-magnifier-position="above"\] \.audio-precision-panel \{ grid-row: 1; justify-content: flex-end/);
  assert.doesNotMatch(css, /\.audio-precision-panel::before/);
  assert.match(css, /\.audio-scrubber-window \{ position: absolute; top: 19px; bottom: 19px; border-radius: 4px; opacity: \.4; filter: brightness\(\.8\); \}/);
  assert.match(css, /\.audio-playback-status \{[^}]*clip-path: inset\(50%\)/);
  assert.match(css, /\.audio-loading-indicator \{ animation: none;/);
  assert.match(css, /\.audio-scrubber-row \{ grid-row: 1; grid-column: 1 \/ -1/);
  assert.match(css, /\.audio-glass-icon \{[^}]*mask-image: var\(--audio-icon-mask\)[^}]*backdrop-filter: blur\(5px\)/);
});

test('the magnifier highlight is a third as tall as before, and buttons flank a full-width scrubber', () => {
  const css = readFileSync(new URL('../frontend/src/styles/observation-layout.css', import.meta.url), 'utf8');
  const rule = (selector: string) => css.split(`\n${selector} {`)[1]!.split('}')[0]!;
  const pixels = (body: string, property: string) =>
    Number(body.match(new RegExp(`(?:^|;)\\s*${property}: (-?\\d+)(?:px)?;`))?.[1]);
  const previousInset = 8;
  const previousHeight = 48 - previousInset * 2;
  const inset = pixels(rule('.audio-scrubber-window'), 'top');
  assert.equal(inset, pixels(rule('.audio-scrubber-window'), 'bottom'));
  const height = 48 - inset * 2;
  assert.ok(Math.abs(height - previousHeight / 3) <= 1, 'highlight height must be about a third of the previous height');
  assert.match(rule('.audio-scrubber'), /flex: 1 1 auto/);
  assert.equal(pixels(rule('.audio-scrubber'), 'height'), 48);
  assert.equal(pixels(rule('.audio-transport-button'), 'width'), 48);
  assert.equal(pixels(rule('.audio-transport-button'), 'height'), 48);
  assert.match(rule('.audio-scrubber-row'), /display: flex/);
});

test('the timestamp always sits closest to the scrubber, on either side of the magnifier', () => {
  const css = readFileSync(new URL('../frontend/src/styles/observation-layout.css', import.meta.url), 'utf8');
  const rule = (selector: string) => css.split(`\n${selector} {`)[1]!.split('}')[0]!;
  const above = '.audio-player-bar[data-magnifier-position="above"]';
  // Below: the panel sits under the scrubber, so the item closest to it (time) is first (order 1).
  assert.match(rule('.audio-magnifier-time'), /order: 1/);
  assert.match(rule('.audio-magnifier-track'), /order: 2/);
  assert.match(rule('.audio-precision-panel'), /align-self: stretch/);
  assert.match(rule('.audio-precision-panel'), /justify-content: flex-start/);
  // Above: the panel sits above the scrubber, so the item closest to it (time) is last (order 2),
  // and content hugs the bottom of the panel.
  assert.match(rule(`${above} .audio-magnifier-time`), /order: 2/);
  assert.match(rule(`${above} .audio-magnifier-track`), /order: 1/);
  assert.match(rule(`${above} .audio-precision-panel`), /justify-content: flex-end/);
});

test('scroll controls translate the whole scrubber row (including its flanking buttons) and the panel together', () => {
  const css = readFileSync(new URL('../frontend/src/styles/observation-layout.css', import.meta.url), 'utf8');
  assert.match(css, /clip-path: inset\(0 50%\); transition: opacity var\(--audio-slide-duration\)/);
  assert.match(css, /\.audio-scrubber-row,\n[^{}]*\.audio-precision-panel \{ transform: translateX\(-56px\); transition: transform var\(--audio-slide-duration\)/);
  assert.match(css, /\.controls-visible \.audio-precision-panel \{ transform: translateX\(0\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{[^}]*\.audio-player-bar,[^}]*\.audio-scrubber-row,[^}]*\.audio-precision-panel \{ transition: none;/);
});
