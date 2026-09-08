import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import {
  InvalidAudioObjectKeyError,
  audioMimeTypeForFilePath,
  resolveAudioFilePath,
} from '../server/src/services/audio-service';

const OBJECTS_ROOT = path.resolve('/tmp/telugu-now-test-objects');

test('resolveAudioFilePath joins a well-formed object key under the objects root', () => {
  const resolved = resolveAudioFilePath('media/fleurs-te/audio/abc123.wav', OBJECTS_ROOT);
  assert.equal(resolved, path.join(OBJECTS_ROOT, 'media/fleurs-te/audio/abc123.wav'));
});

test('resolveAudioFilePath decodes percent-encoded path segments', () => {
  const resolved = resolveAudioFilePath('media/fleurs-te/audio/a%20b.wav', OBJECTS_ROOT);
  assert.equal(resolved, path.join(OBJECTS_ROOT, 'media/fleurs-te/audio/a b.wav'));
});

test('resolveAudioFilePath rejects traversal and empty segments', () => {
  for (const objectKey of ['../secret.wav', 'media/../../etc/passwd', 'media//audio.wav', '']) {
    assert.throws(
      () => resolveAudioFilePath(objectKey, OBJECTS_ROOT),
      InvalidAudioObjectKeyError,
    );
  }
});

test('resolveAudioFilePath rejects an encoded traversal segment', () => {
  assert.throws(
    () => resolveAudioFilePath('media/%2e%2e/secret.wav', OBJECTS_ROOT),
    InvalidAudioObjectKeyError,
  );
});

test('audioMimeTypeForFilePath maps known audio extensions and falls back for unknown ones', () => {
  assert.equal(audioMimeTypeForFilePath('/data/objects/media/a.wav'), 'audio/wav');
  assert.equal(audioMimeTypeForFilePath('/data/objects/media/a.flac'), 'audio/flac');
  assert.equal(audioMimeTypeForFilePath('/data/objects/media/a.WAV'), 'audio/wav');
  assert.equal(audioMimeTypeForFilePath('/data/objects/media/a.bin'), 'application/octet-stream');
});
