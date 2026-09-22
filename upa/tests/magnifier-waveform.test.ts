import assert from 'node:assert/strict';
import test from 'node:test';
import { magnifierWindow, magnifierBarLayout, magnifierWaveform, coarseMagnifierWaveform } from '../frontend/src/observation/audio/magnifier-waveform';
import { encodePreparedAudio } from '../frontend/src/observation/audio/prepared-audio';

test('moving window scales with duration, clamps to 0.25–2 seconds and stays inside the clip', () => {
  for (const [duration, span] of [[0, 0], [.1, .1], [1, .25], [10, .25], [30, .6], [60, 1.2], [100, 2], [300, 2]] as const) {
    for (const time of [-1, 0, duration / 2, duration, duration + 1]) {
      const window = magnifierWindow(duration, time);
      assert.ok(window.start >= 0 && window.end <= duration);
      assert.ok(Math.abs(window.end - window.start - span) < 1e-9);
    }
  }
  assert.ok(Math.abs(magnifierWindow(60, 25).start - 24.4) < 1e-9);
  assert.ok(Math.abs(magnifierWindow(60, 25).end - 25.6) < 1e-9);
  assert.deepEqual(magnifierWindow(NaN, Infinity), { start: 0, end: 0 });
});
test('coarse global buckets stretch into wide bars with one-pixel gaps', () => {
  const peaks = Array(1600).fill(0);
  peaks[800] = .8;
  const window = magnifierWindow(10, 5);
  const bars = coarseMagnifierWaveform(peaks, 10, window.start, window.end);
  assert.equal(bars.length, 4);
  assert.ok(bars.includes(.8));
  assert.ok(coarseMagnifierWaveform(peaks, 10, 1, 1.25).every(value => value === 0));
  for (const pixels of [128, 260, 480]) {
    const layout = magnifierBarLayout(pixels, bars.length);
    assert.equal(layout.gap, 1);
    assert.ok(Math.abs(layout.count * layout.width + (layout.count - 1) * layout.gap - pixels) < 1e-9);
  }
  assert.equal(magnifierBarLayout(260, 4).width, 64.25);
  assert.deepEqual(coarseMagnifierWaveform([], 0, 0, 0), [0]);
});
test('max pooling preserves real impulses and silence only in the visible window', () => {
  const peaks = new Array(9600).fill(0);
  peaks[4000] = .8;
  assert.ok(magnifierWaveform(peaks, 60, 24.5, 25.5, 40).includes(.8));
  assert.ok(magnifierWaveform(peaks, 60, 10, 11, 40).every(value => value === 0));
  assert.deepEqual(magnifierWaveform([], 0, 0, 0, 3), [0, 0, 0]);
});
test('a brief impulse on a long recording is retained with no timing or encoding change', () => {
  const samples = new Float32Array(8000 * 60); samples[8000 * 25] = .5;
  const audio = encodePreparedAudio({ sampleRate: 8000, numberOfChannels: 1, length: samples.length, getChannelData: () => samples });
  assert.equal(audio.duration, 60.5);
  assert.equal(audio.bytes.byteLength, 44 + 8000 * 60.5 * 2);
  const bars = magnifierWaveform(audio.waveformPeaks, audio.duration, 25, 26, 43);
  assert.ok(bars.some(value => value === 1));
  assert.ok(bars.filter(value => value > 0).length <= 2);
});
