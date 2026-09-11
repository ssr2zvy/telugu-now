import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AUDIO_NORMALIZATION,
  computeNormalizationGain,
  computeRmsLoudness,
  computeWaveformPeaks,
  type DecodedAudioLike,
} from '../frontend/src/observation/audio/audio-normalization';

function bufferFromChannels(channels: number[][]): DecodedAudioLike {
  const length = channels[0]?.length ?? 0;
  return {
    numberOfChannels: channels.length,
    length,
    getChannelData: (channel: number) => Float32Array.from(channels[channel] ?? []),
  };
}

test('computeRmsLoudness returns 0 for silence and the exact RMS for a known signal', () => {
  assert.equal(computeRmsLoudness(bufferFromChannels([[0, 0, 0, 0]])), 0);
  // RMS of [1, -1, 1, -1] is 1.
  assert.equal(computeRmsLoudness(bufferFromChannels([[1, -1, 1, -1]])), 1);
  // RMS of [3, 4] across two "channels" combines all samples: sqrt((9+16)/2) = 3.5355...
  assert.ok(Math.abs(computeRmsLoudness(bufferFromChannels([[3], [4]])) - Math.sqrt(12.5)) < 1e-9);
});

test('computeNormalizationGain amplifies quiet clips and attenuates loud clips toward the target RMS', () => {
  // RMS 0.05 needs gain 2 to reach the 0.1 target -- within [minGain, maxGain], so unclamped.
  const quiet = bufferFromChannels([[0.05, -0.05, 0.05, -0.05]]);
  const loud = bufferFromChannels([[0.9, -0.9, 0.9, -0.9]]);
  const quietGain = computeNormalizationGain(quiet);
  const loudGain = computeNormalizationGain(loud);
  assert.ok(quietGain > 1, `expected quiet clip gain > 1, got ${quietGain}`);
  assert.ok(loudGain < 1, `expected loud clip gain < 1, got ${loudGain}`);
  assert.ok(Math.abs(computeRmsLoudness(quiet) * quietGain - AUDIO_NORMALIZATION.targetRms) < 1e-9);
});

test('computeNormalizationGain clamps to the configured gain bounds and is neutral for silence', () => {
  const veryQuiet = bufferFromChannels([[1e-6, -1e-6]]);
  assert.equal(computeNormalizationGain(veryQuiet), AUDIO_NORMALIZATION.maxGain);
  const veryLoud = bufferFromChannels([[1, -1]]);
  assert.equal(computeNormalizationGain(veryLoud), AUDIO_NORMALIZATION.minGain);
  assert.equal(computeNormalizationGain(bufferFromChannels([[0, 0, 0]])), 1);
});

test('computeWaveformPeaks buckets the whole clip, normalizes to the loudest bucket, and always includes the tail', () => {
  const samples = Array.from({ length: 100 }, (_, index) => (index === 99 ? 1 : 0.1));
  const peaks = computeWaveformPeaks(bufferFromChannels([samples]), 10);
  assert.equal(peaks.length, 10);
  assert.equal(peaks[9], 1);
  assert.ok(peaks.every((value) => value >= 0 && value <= 1));
});

test('computeWaveformPeaks returns all-zero buckets for an empty buffer', () => {
  const peaks = computeWaveformPeaks(bufferFromChannels([[]]), 5);
  assert.deepEqual(peaks, [0, 0, 0, 0, 0]);
});
