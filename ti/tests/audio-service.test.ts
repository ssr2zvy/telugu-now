import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import { Hono } from 'hono';
import {
  InvalidAudioObjectKeyError,
  audioMimeTypeForFilePath,
  resolveAudioFilePath,
  serveAudio,
} from '../server/src/services/audio-service';

const OBJECTS_ROOT = path.resolve('/tmp/telugu-now-test-objects');

test('resolveAudioFilePath joins a well-formed object key under the objects root', () => {
  const resolved = resolveAudioFilePath('media/fleurs-te/audio/abc123.wav', OBJECTS_ROOT);
  assert.equal(resolved, path.join(OBJECTS_ROOT, 'media/fleurs-te/audio/abc123.wav'));
});

test('audio serving provides exact byte ranges for FLAC and WAV seeking', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'audio-ranges-'));
  try {
    const bytes = Buffer.from('fLaC0123456789abcdef');
    await writeFile(path.join(root, 'clip.flac'), bytes);
    await writeFile(path.join(root, 'clip.wav'), bytes);
    const app = new Hono().get('/api/audio/*', serveAudio(root));
    for (const extension of ['flac', 'wav']) {
      const url = `/api/audio/clip.${extension}`;
      const full = await app.request(url);
      assert.equal(full.status, 200);
      assert.equal(full.headers.get('accept-ranges'), 'bytes');
      assert.equal(full.headers.get('content-type'), `audio/${extension}`);
      assert.deepEqual(Buffer.from(await full.arrayBuffer()), bytes);
      for (const [range, start, end] of [
        ['bytes=0-3', 0, 3], ['bytes=5-', 5, bytes.length - 1],
        ['bytes=-4', bytes.length - 4, bytes.length - 1], ['bytes=2-999', 2, bytes.length - 1],
      ] as const) {
        const partial = await app.request(url, { headers: { Range: range } });
        assert.equal(partial.status, 206);
        assert.equal(partial.headers.get('content-range'), `bytes ${start}-${end}/${bytes.length}`);
        assert.equal(partial.headers.get('content-length'), String(end - start + 1));
        assert.deepEqual(Buffer.from(await partial.arrayBuffer()), bytes.subarray(start, end + 1));
      }
      const invalid = await app.request(url, { headers: { Range: `bytes=${bytes.length}-` } });
      assert.equal(invalid.status, 416);
      assert.equal(invalid.headers.get('content-range'), `bytes */${bytes.length}`);
      const head = await app.request(url, { method: 'HEAD' });
      assert.equal(head.status, 200);
      assert.equal(head.headers.get('content-length'), String(bytes.length));
      assert.equal((await head.arrayBuffer()).byteLength, 0);
    }
    assert.equal((await app.request('/api/audio/missing.flac')).status, 404);
    assert.equal((await app.request('/api/audio/%invalid.flac')).status, 400);
    assert.equal((await app.request('/api/audio/%2e%2e%2fsecret.flac')).status, 400);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
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
