import assert from 'node:assert/strict';
import test from 'node:test';
import { MEDIA_ERROR_CONFIRM_MS, observePlaybackFeedback } from '../frontend/src/observation/audio/playback-feedback';

class Media extends EventTarget {
  src = 'https://app.test/audio.flac';
  currentSrc = this.src;
  currentTime = 0;
  paused = true;
  ended = false;
  seeking = false;
  readyState = 0;
  error: { code: number } | null = null;
  emit(name: string) { this.dispatchEvent(new Event(name)); }
}

test('a real network failure is reported, then cleared when playback recovers without another play event', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const media = new Media();
  let warning: string | null = null;
  let playing = false;
  const stop = observePlaybackFeedback(media, message => { warning = message; }, recovered => {
    warning = null;
    if (recovered) playing = true;
  });
  media.error = { code: 2 };
  media.emit('error');
  assert.equal(warning, null);
  t.mock.timers.tick(MEDIA_ERROR_CONFIRM_MS);
  assert.match(warning!, /Audio could not be loaded/);
  media.error = null;
  media.paused = false;
  media.readyState = 4;
  media.emit('playing');
  assert.equal(warning, null);
  assert.equal(playing, true);
  stop();
});

test('network errors do not show while the native clock advances, but a subsequent real stall does', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const media = new Media();
  media.paused = false;
  media.readyState = 4;
  let warning: string | null = null;
  const stop = observePlaybackFeedback(media, message => { warning = message; }, () => { warning = null; });
  media.error = { code: 2 };
  media.readyState = 1;
  media.emit('error');
  for (let index = 0; index < 4; index++) {
    media.currentTime += 0.2;
    t.mock.timers.tick(MEDIA_ERROR_CONFIRM_MS);
    assert.equal(warning, null);
  }
  t.mock.timers.tick(MEDIA_ERROR_CONFIRM_MS);
  assert.match(warning!, /Audio could not be loaded/);
  media.currentTime += 0.2;
  media.emit('timeupdate');
  assert.equal(warning, null);
  media.ended = true;
  media.emit('ended');
  t.mock.timers.tick(MEDIA_ERROR_CONFIRM_MS * 2);
  assert.equal(warning, null);
  stop();
});

test('late errors from the original source do not poison the silent lead-in or its restored source', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const media = new Media();
  const failures: string[] = [];
  const stop = observePlaybackFeedback(media, message => failures.push(message), () => {});
  media.error = { code: 2 };
  media.emit('error');
  const recording = media.src;
  media.src = 'data:audio/wav;base64,silence';
  media.emit('loadstart');
  media.emit('error');
  t.mock.timers.tick(MEDIA_ERROR_CONFIRM_MS);
  assert.equal(failures.length, 0);
  media.currentSrc = media.src;
  media.error = null;
  media.src = recording;
  media.emit('emptied');
  media.error = { code: 2 };
  media.emit('error');
  t.mock.timers.tick(MEDIA_ERROR_CONFIRM_MS);
  assert.equal(failures.length, 0);
  stop();
});

test('successful loading clears only media feedback, not an autoplay rejection', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const media = new Media();
  const recoveries: boolean[] = [];
  const stop = observePlaybackFeedback(media, () => {}, playing => recoveries.push(playing));
  media.readyState = 2;
  media.emit('loadeddata');
  assert.deepEqual(recoveries, [false]);
  media.paused = false;
  media.currentTime = 0.1;
  media.emit('timeupdate');
  assert.deepEqual(recoveries, [false, true]);
  stop();
});

test('aborted loads and error events without a current MediaError do not invent failures', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const media = new Media();
  const stop = observePlaybackFeedback(media, () => assert.fail('No current failure'), () => {});
  media.emit('error');
  t.mock.timers.tick(MEDIA_ERROR_CONFIRM_MS);
  media.error = { code: 1 };
  media.emit('error');
  t.mock.timers.tick(MEDIA_ERROR_CONFIRM_MS);
  stop();
});

test('decoder failures remain actionable, including an error already present when listeners attach', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const code of [3, 4]) {
    const media = new Media();
    media.error = { code };
    const failures: string[] = [];
    const stop = observePlaybackFeedback(media, message => failures.push(message), () => {});
    t.mock.timers.tick(MEDIA_ERROR_CONFIRM_MS);
    assert.deepEqual(failures, ['This audio file could not be played.']);
    stop();
  }
});

test('cleanup cancels confirmation and removes listeners from the old observation', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const media = new Media();
  const stop = observePlaybackFeedback(media, () => assert.fail('Disposed listener'), () => {});
  media.error = { code: 2 };
  media.emit('error');
  stop();
  media.emit('error');
  t.mock.timers.tick(MEDIA_ERROR_CONFIRM_MS);
});
