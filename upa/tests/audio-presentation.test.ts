import assert from 'node:assert/strict';
import test from 'node:test';
import { AUDIO_PLAYBACK_RATE_MIN, AUDIO_PLAYBACK_RATE_MAX, PRECISION_DRAG_THRESHOLD_SECONDS, clampPlaybackRate, exceedsPrecisionDragThreshold, magnifierSeekTime, precisionSeekTime } from '../shared/audio';
import { AUDIO_PLAYER_PRESENTATION } from '../frontend/src/observation/audio/audio-player-presentation';

test('playback bounds include 0.1 to 1.5 and clamp older saved defaults', () => {
  assert.equal(AUDIO_PLAYBACK_RATE_MIN, 0.1);
  assert.equal(AUDIO_PLAYBACK_RATE_MAX, 1.5);
  assert.equal(AUDIO_PLAYER_PRESENTATION.playbackRateMax, 1.5);
  assert.equal(clampPlaybackRate(2.5), 1.5);
  assert.equal(clampPlaybackRate(0.1), 0.1);
  assert.equal(clampPlaybackRate(NaN), 1);
});

test('precision dragging moves 1.5 milliseconds per pixel without accumulating feedback', () => {
  assert.equal(precisionSeekTime(20, 100, 300), 20.15);
  assert.equal(precisionSeekTime(20, 200, 300), 20.3);
  assert.equal(precisionSeekTime(20, -100, 300), 19.85);
  assert.equal(precisionSeekTime(0, -100, 300), 0);
  assert.equal(precisionSeekTime(300, 100, 300), 300);
});

test('magnifier clicks map directly into its visible window and dragging starts beyond one millisecond', () => {
  assert.equal(PRECISION_DRAG_THRESHOLD_SECONDS, 0.001);
  assert.equal(magnifierSeekTime(100, 100, 200, 19.5, 20.5), 19.5);
  assert.equal(magnifierSeekTime(200, 100, 200, 19.5, 20.5), 20);
  assert.equal(magnifierSeekTime(300, 100, 200, 19.5, 20.5), 20.5);
  assert.equal(exceedsPrecisionDragThreshold(20, 20.001), false);
  assert.equal(exceedsPrecisionDragThreshold(20, 20.001001), true);
});

test('playback rate clamping preserves fractions and handles lower and non-finite bounds', () => {
  for (const rate of [0.1, 0.375, 0.8, 1, 1.25, 1.5]) {
    assert.equal(clampPlaybackRate(rate), rate);
  }
  for (const rate of [-100, 0, 0.099]) {
    assert.equal(clampPlaybackRate(rate), AUDIO_PLAYBACK_RATE_MIN);
  }
  for (const rate of [NaN, Infinity, -Infinity]) {
    assert.equal(clampPlaybackRate(rate), 1);
  }
  assert.equal(clampPlaybackRate(Number.MAX_VALUE), AUDIO_PLAYBACK_RATE_MAX);
});

test('precision seeking retains subpixel accuracy and clamps short and empty clips', () => {
  assert.ok(Math.abs(precisionSeekTime(12.345, 0.5, 60) - 12.34575) < 1e-12);
  assert.ok(Math.abs(precisionSeekTime(12.345, -0.5, 60) - 12.34425) < 1e-12);
  assert.equal(precisionSeekTime(0.001, 1_000_000, 0.002), 0.002);
  assert.equal(precisionSeekTime(0.001, -1_000_000, 0.002), 0);
  assert.equal(precisionSeekTime(0, 100, 0), 0);
  assert.equal(precisionSeekTime(0, -100, 0), 0);
});