import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { Readable } from 'node:stream';
import test from 'node:test';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { AudioValidationService, AudioValidationError } from '../server/src/services/audio-validation-service';
import { AudioValidationStore } from '../server/src/services/audio-validation-store';
import { CorpusObjectStore, type CorpusS3Client } from '../server/src/services/corpus-object-store';
import type { AudioMedia } from '../shared/contracts';
import { wavFixture } from './helpers/audio-fixture';

const integration = { skip: spawnSync('ffmpeg', ['-version']).status === 0 ? false : 'ffmpeg is required for actual decoding' };
function fixture(t: { after: (callback: () => void) => void }) {
  const root = path.resolve('test-results', `validation-${randomUUID()}`);
  fs.mkdirSync(path.join(root, 'objects'), { recursive: true });
  const file = path.join(root, 'validation.sqlite');
  const report = new AudioValidationStore(file, 'test');
  t.after(() => { report.close(); fs.rmSync(root, { recursive: true, force: true }); });
  return { root, file, report, objects: path.join(root, 'objects') };
}
function media(objectKey: string, bytes?: Buffer): AudioMedia {
  return { kind: 'audio', objectKey, mimeType: objectKey.endsWith('.flac') ? 'audio/flac' : 'audio/wav', durationSeconds: 1,
    sha256: bytes ? createHash('sha256').update(bytes).digest('hex') : '' };
}
function remote(send: (command: any, options?: any) => Promise<any>): CorpusObjectStore {
  return new CorpusObjectStore({ bucketName: 'test', corpusObjectsPrefix: 'corpus/objects/' }, { send } as CorpusS3Client);
}

test('validation really decodes WAV/FLAC, persists identity-bound success, and quarantines malformed, empty and missing audio', integration, async t => {
  const { objects, report, file } = fixture(t);
  const wav = wavFixture();
  const converted = spawnSync('ffmpeg', ['-nostdin', '-v', 'error', '-i', 'pipe:0', '-threads', '1', '-f', 'flac', 'pipe:1'], { input: wav });
  assert.equal(converted.status, 0);
  fs.writeFileSync(path.join(objects, 'a.wav'), wav);
  fs.writeFileSync(path.join(objects, 'a.flac'), converted.stdout);
  fs.writeFileSync(path.join(objects, 'corrupt.wav'), 'not audio');
  fs.writeFileSync(path.join(objects, 'large-corrupt.wav'), Buffer.alloc(2 * 1024 * 1024, 0xff));
  fs.writeFileSync(path.join(objects, 'empty.wav'), wavFixture(0));
  const service = new AudioValidationService(report, objects);
  await service.validate([media('a.wav', wav), media('a.flac', converted.stdout)]);
  const restarted = new AudioValidationStore(file, 'test');
  const originalPath = process.env.PATH;
  try {
    process.env.PATH = path.resolve('test-results/no-decoder');
    await new AudioValidationService(restarted, objects).validate([media('a.wav', wav)]);
  } finally { process.env.PATH = originalPath; restarted.close(); }
  for (const key of ['corrupt.wav', 'large-corrupt.wav', 'empty.wav', 'missing.wav']) {
    await assert.rejects(service.validate([media(key)]), (error: unknown) => error instanceof AudioValidationError && error.permanent);
    assert.ok(report.invalidReason(key), key);
  }
  fs.writeFileSync(path.join(objects, 'a.wav'), 'changed corrupt data');
  await assert.rejects(service.validate([media('a.wav', wav)]), (error: unknown) => error instanceof AudioValidationError && error.permanent);
  assert.ok(report.invalidReason('a.wav'), 'a changed object cannot reuse its previous decode result');
});

test('missing decoder, network/auth failures, timeout and unavailable local root never quarantine', async t => {
  const { root, objects, report } = fixture(t);
  fs.writeFileSync(path.join(objects, 'valid.wav'), wavFixture());
  const originalPath = process.env.PATH;
  try {
    process.env.PATH = path.resolve('test-results/no-decoder');
    await assert.rejects(new AudioValidationService(report, objects).validate([media('valid.wav')]),
      (error: unknown) => error instanceof AudioValidationError && !error.permanent && error.code === 'audio-converter-unavailable');
  } finally { process.env.PATH = originalPath; }
  assert.equal(report.invalidReason('valid.wav'), null);
  for (const status of [403, 429, 500, 503]) {
    const service = new AudioValidationService(report, objects, remote(async () => {
      throw { $metadata: { httpStatusCode: status } };
    }));
    await assert.rejects(service.validate([media(`remote-${status}.wav`)]),
      (error: unknown) => error instanceof AudioValidationError && !error.permanent);
  }
  const truncated = new AudioValidationService(report, objects, remote(async command => command instanceof GetObjectCommand
    ? { Body: Readable.from([Buffer.from('partial response')]), ContentLength: 1000 }
    : { ETag: '"truncated"', ContentLength: 1000 }));
  await assert.rejects(truncated.validate([media('truncated.wav')]),
    (error: unknown) => error instanceof AudioValidationError && !error.permanent);
  const stalled = new AudioValidationService(report, objects, remote(async () => new Promise(() => {})), true, 25);
  await assert.rejects(stalled.validate([media('stalled.wav')]), (error: unknown) => error instanceof AudioValidationError && !error.permanent);
  await assert.rejects(new AudioValidationService(report, path.join(root, 'unmounted')).validate([media('valid.wav')]),
    (error: unknown) => error instanceof AudioValidationError && !error.permanent);
  assert.deepEqual(report.invalidKeys(), []);
});

test('remote success checks current object identity, pins GET and deduplicates concurrent validation; 404 persists', integration, async t => {
  const { objects, report, file } = fixture(t);
  const bytes = wavFixture();
  let gets = 0;
  let heads = 0;
  let etag = '"version-one"';
  const store = remote(async command => {
    if (command instanceof GetObjectCommand) {
      gets++;
      assert.equal(command.input.IfMatch, etag);
      return { Body: Readable.from([bytes]), ContentLength: bytes.length };
    }
    heads++;
    return { ETag: etag, ContentLength: bytes.length };
  });
  const service = new AudioValidationService(report, objects, store);
  await Promise.all([service.validate([media('remote.wav', bytes)]), service.validate([media('remote.wav', bytes)])]);
  assert.equal(gets, 1);
  await service.validate([media('remote.wav', bytes)]);
  assert.equal(gets, 1);
  assert.equal(heads, 2);
  etag = '"version-two"';
  await service.validate([media('remote.wav', bytes)]);
  assert.equal(gets, 2);
  const missing = new AudioValidationService(report, objects, remote(async () => { throw { $metadata: { httpStatusCode: 404 } }; }));
  await assert.rejects(missing.validate([media('absent.wav')]), (error: unknown) => error instanceof AudioValidationError && error.permanent);
  const reopened = new AudioValidationStore(file, 'test');
  assert.equal(reopened.invalidReason('absent.wav'), 'audio-not-found');
  reopened.close();
});

test('validation rejects unsafe keys and escaping local symlinks without following arbitrary URLs', async t => {
  const { root, objects, report } = fixture(t);
  fs.writeFileSync(path.join(root, 'outside.wav'), wavFixture());
  fs.symlinkSync(path.join(root, 'outside.wav'), path.join(objects, 'escape.wav'));
  const service = new AudioValidationService(report, objects);
  for (const key of ['../outside.wav', 'https://example.com/audio.wav', 'escape.wav', 'a.m3u']) {
    await assert.rejects(service.validate([media(key)]), (error: unknown) => error instanceof AudioValidationError && error.permanent);
  }
});
