import assert from 'node:assert/strict';
import test from 'node:test';
import { magnifierWindow, magnifierBarLayout, magnifierWaveform } from '../frontend/src/observation/audio/magnifier-waveform';
import { encodePreparedAudio } from '../frontend/src/observation/audio/prepared-audio';

test('magnifier retains half a second across clip lengths and both endpoints', () => {
  for (const duration of [0, .25, 1, 10, 60, 120]) for (const time of [-1, 0, duration / 2, duration, duration + 1]) {
    const window = magnifierWindow(duration, time);
    assert.ok(window.start >= 0 && window.end <= duration);
    assert.equal(window.end - window.start, Math.min(.5, duration));
  }
  assert.deepEqual(magnifierWindow(60, 25), { start: 24.75, end: 25.25 });
  assert.deepEqual(magnifierWindow(NaN, Infinity), { start: 0, end: 0 });
});
test('waveform bars keep approximately four-pixel widths without overflowing', () => {
  for (const pixels of [128, 180, 260, 332, 480]) {
    const layout = magnifierBarLayout(pixels);
    assert.ok(layout.width >= 4 && layout.width < 4.3);
    assert.equal(layout.gap, 2);
    assert.ok(Math.abs(layout.count * layout.width + (layout.count - 1) * layout.gap - pixels) < 1e-9);
  }
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
