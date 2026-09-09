import assert from 'node:assert/strict';
import test from 'node:test';
import { AUDIO_PLAYBACK_RATE_MIN, AUDIO_PLAYBACK_RATE_MAX, clampPlaybackRate, precisionSeekTime } from '../shared/audio';
import { AUDIO_PLAYER_PRESENTATION } from '../frontend/src/observation/audio/audio-player-presentation';

test('playback bounds include 0.1 to 1.5 and clamp older saved defaults', () => {
  assert.equal(AUDIO_PLAYBACK_RATE_MIN, 0.1);
  assert.equal(AUDIO_PLAYBACK_RATE_MAX, 1.5);
  assert.equal(AUDIO_PLAYER_PRESENTATION.playbackRateMax, 1.5);
  assert.equal(clampPlaybackRate(2.5), 1.5);
  assert.equal(clampPlaybackRate(0.1), 0.1);
  assert.equal(clampPlaybackRate(NaN), 1);
});

test('precision dragging moves one millisecond per pixel without accumulating feedback', () => {
  assert.equal(precisionSeekTime(20, 100, 300), 20.1);
  assert.equal(precisionSeekTime(20, 200, 300), 20.2);
  assert.equal(precisionSeekTime(20, -100, 300), 19.9);
  assert.equal(precisionSeekTime(0, -100, 300), 0);
  assert.equal(precisionSeekTime(300, 100, 300), 300);
});