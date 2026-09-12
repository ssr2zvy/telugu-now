import assert from 'node:assert/strict';
import test from 'node:test';
import { encodePreparedAudio, PreparedAudioCache, toPlayerTime, toSpeechTime, type PreparedAudio } from '../frontend/src/observation/audio/prepared-audio';

const clip = (url: string, bytes = 10): PreparedAudio => ({ url: `blob:${url}`, bytes, duration: 1.5, waveformPeaks: [0, 1] });
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

test('padded WAV has sample-exact silence, normalized audible speech and one accurate waveform/timeline', () => {
  for (const sampleRate of [8000, 24000, 44100, 48000]) {
    for (const channels of [1, 2]) {
      const samples = new Float32Array(sampleRate).fill(0.02);
      const result = encodePreparedAudio({ sampleRate, numberOfChannels: channels, length: samples.length, getChannelData: () => samples });
      const view = new DataView(result.bytes.buffer);
      const silentBytes = sampleRate * 0.5 * channels * 2;
      assert.equal(view.getUint32(24, true), sampleRate);
      assert.equal(view.getUint16(22, true), channels);
      assert.equal(result.duration, 1.5);
      assert.equal(view.getUint32(40, true) / channels / 2 / sampleRate, result.duration);
      assert.ok(result.bytes.subarray(44, 44 + silentBytes).every(value => value === 0));
      for (let i = 44 + silentBytes; i < result.bytes.length; i += 2) assert.equal(view.getInt16(i, true), 1966);
      assert.deepEqual(result.waveformPeaks.slice(0, 40), new Array(40).fill(0));
      assert.ok(result.waveformPeaks.slice(40).every(value => value === 1));
    }
  }
});

test('bookmark translation never persists padding or accumulates drift, including original zero', () => {
  for (const original of [0, 0.001, 0.1, 3.456, 29.999]) {
    let saved = original;
    for (let i = 0; i < 100; i++) saved = toSpeechTime(toPlayerTime(saved));
    assert.equal(saved, original);
    assert.equal(toPlayerTime(original), original + 0.5);
  }
  assert.equal(toSpeechTime(0.2), 0);
});

test('invalid or oversized decoded audio fails explicitly, never unpadded fallback', () => {
  for (const overrides of [{ length: 0 }, { numberOfChannels: 3 }, { length: 24000 * 121 }, { sampleRate: 8001 }]) {
    assert.throws(() => encodePreparedAudio({
      sampleRate: 24000, numberOfChannels: 1, length: 24000, getChannelData: () => new Float32Array(24000), ...overrides,
    }), /limits/);
  }
});

test('warm and active owners deduplicate fetch/decode and retain the same prepared object', async () => {
  let calls = 0;
  const cache = new PreparedAudioCache(async url => { calls++; return clip(url); });
  const warm = cache.acquire('one', 'warm');
  const active = cache.acquire('one');
  assert.equal(warm.ready, active.ready);
  assert.equal(await warm.ready, await active.ready);
  assert.equal(calls, 1);
  warm.release();
  assert.equal(active.value()?.url, 'blob:one');
  active.release();
  const again = cache.acquire('one');
  assert.equal(again.value()?.url, 'blob:one');
  assert.equal(calls, 1);
  again.release();
});

test('speculative requests are serial and an active clip takes the reserved slot ahead of the queue', async () => {
  const starts: string[] = [];
  const finish = new Map<string, (value: PreparedAudio) => void>();
  const cache = new PreparedAudioCache((url) => {
    starts.push(url);
    return new Promise(resolve => finish.set(url, resolve));
  });
  const warm = cache.acquire('warm', 'warm');
  const later = cache.acquire('later', 'warm');
  const active = cache.acquire('active');
  assert.deepEqual(starts, ['warm', 'active']);
  finish.get('active')!(clip('active'));
  await active.ready;
  await flush();
  assert.deepEqual(starts, ['warm', 'active']);
  finish.get('warm')!(clip('warm'));
  await warm.ready;
  await flush();
  assert.deepEqual(starts, ['warm', 'active', 'later']);
  finish.get('later')!(clip('later'));
  await later.ready;
  for (const owner of [warm, later, active]) owner.release();
});

test('unowned pending loads abort, stale completions revoke, and a new source remains valid', async () => {
  const signals = new Map<string, AbortSignal>();
  const finish = new Map<string, (value: PreparedAudio) => void>();
  const revoked: string[] = [];
  const cache = new PreparedAudioCache((url, signal) => {
    signals.set(url, signal);
    return new Promise(resolve => finish.set(url, resolve));
  }, url => revoked.push(url));
  const old = cache.acquire('old');
  const rejected = assert.rejects(old.ready, { name: 'AbortError' });
  old.release();
  old.release();
  assert.equal(signals.get('old')?.aborted, true);
  const current = cache.acquire('new');
  finish.get('old')!(clip('old'));
  finish.get('new')!(clip('new'));
  await rejected;
  await current.ready;
  await flush();
  assert.deepEqual(revoked, ['blob:old']);
  assert.equal(current.value()?.url, 'blob:new');
  current.release();
});

test('queue warming progresses alongside a cold active download and abandoned queued jobs never fetch', async () => {
  const starts: string[] = [];
  const cache = new PreparedAudioCache((url, signal) => {
    starts.push(url);
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason)));
  });
  const active = cache.acquire('active');
  const warm = cache.acquire('warm', 'warm');
  const abandoned = cache.acquire('abandoned', 'warm');
  assert.deepEqual(starts, ['active', 'warm']);
  abandoned.release();
  await assert.rejects(abandoned.ready, { name: 'AbortError' });
  active.release();
  warm.release();
  await flush();
  assert.deepEqual(starts, ['active', 'warm']);
});

test('failed preparation is deduplicated until explicit retry, which cannot be poisoned by old owners', async () => {
  let calls = 0;
  const cache = new PreparedAudioCache(async url => {
    if (++calls === 1) throw new Error('HTTP 503');
    return clip(url);
  });
  const warm = cache.acquire('one', 'warm');
  await assert.rejects(warm.ready, /503/);
  const failed = cache.acquire('one');
  await assert.rejects(failed.ready, /503/);
  const retry = cache.acquire('one', 'active', true);
  await retry.ready;
  warm.release();
  failed.release();
  assert.equal(retry.value()?.url, 'blob:one');
  assert.equal(calls, 2);
  retry.release();
});

test('LRU memory eviction never revokes an active native owner, and ownership is released idempotently', async () => {
  const revoked: string[] = [];
  const cache = new PreparedAudioCache(async url => clip(url), url => revoked.push(url), 20, 2);
  const active = cache.acquire('active');
  await active.ready;
  const old = cache.acquire('old');
  await old.ready;
  old.release();
  const next = cache.acquire('next');
  await next.ready;
  assert.deepEqual(revoked, ['blob:old']);
  assert.equal(active.value()?.url, 'blob:active');
  active.release();
  active.release();
  next.release();
});

test('memory pressure fails explicitly instead of revoking pinned native media', async () => {
  const revoked: string[] = [];
  const cache = new PreparedAudioCache(async url => clip(url), url => revoked.push(url), 10);
  const active = cache.acquire('active');
  await active.ready;
  const next = cache.acquire('next');
  await assert.rejects(next.ready, /cache is full/);
  assert.deepEqual(revoked, ['blob:next']);
  assert.equal(active.value()?.url, 'blob:active');
  active.release();
  next.release();
});

test('timeouts abort loading and stale results cannot resurrect a timed-out entry', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let signal!: AbortSignal;
  let finish!: (value: PreparedAudio) => void;
  const revoked: string[] = [];
  const cache = new PreparedAudioCache((_url, received) => {
    signal = received;
    return new Promise(resolve => { finish = resolve; });
  }, url => revoked.push(url), 100, 6, 100);
  const owner = cache.acquire('slow');
  const rejection = assert.rejects(owner.ready, /timed out/);
  t.mock.timers.tick(100);
  await rejection;
  assert.equal(signal.aborted, true);
  finish(clip('slow'));
  await flush();
  assert.equal(owner.value(), undefined);
  assert.deepEqual(revoked, ['blob:slow']);
  owner.release();
});
