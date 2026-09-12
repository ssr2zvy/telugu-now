import assert from 'node:assert/strict';
import test from 'node:test';
import { AUDIO_LEAD_IN_SECONDS, silentLeadInWav } from '../frontend/src/observation/audio/silent-lead-in';
import { computeNormalizationGain } from '../frontend/src/observation/audio/audio-normalization';

test('lead-in is exactly 500ms of zero PCM samples, with no noise or normalization input', () => {
  const bytes = silentLeadInWav();
  const header = new DataView(bytes.buffer);
  assert.equal(new TextDecoder().decode(bytes.slice(0, 4)), 'RIFF');
  assert.equal(new TextDecoder().decode(bytes.slice(8, 16)), 'WAVEfmt ');
  assert.equal(header.getUint16(20, true), 1);
  assert.equal(header.getUint16(22, true), 1);
  assert.equal(header.getUint16(34, true), 16);
  const dataBytes = header.getUint32(40, true);
  const sampleRate = header.getUint32(24, true);
  assert.equal(dataBytes / 2 / sampleRate, 0.5);
  assert.equal(AUDIO_LEAD_IN_SECONDS, 0.5);
  assert.equal(bytes.length, dataBytes + 44);
  assert.ok(bytes.subarray(44).every(sample => sample === 0));
  const samples = new Float32Array(dataBytes / 2);
  assert.equal(computeNormalizationGain({ numberOfChannels: 1, length: samples.length, getChannelData: () => samples }), 1);
});
