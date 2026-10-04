import assert from 'node:assert/strict';
import test from 'node:test';
import { playbackFailureMessage } from '../frontend/src/observation/audio/playback-error';

test('blocked autoplay waits silently but explicit playback failures remain visible', () => {
  const blocked = new DOMException('Gesture required', 'NotAllowedError');
  assert.equal(playbackFailureMessage(blocked, true), null);
  assert.equal(playbackFailureMessage(blocked, false), 'Audio could not start. Tap to retry.');
  for (const automatic of [true, false]) {
    assert.equal(playbackFailureMessage(new DOMException('Unsupported', 'NotSupportedError'), automatic),
      'This audio file could not be played. Tap to retry.');
  }
});
