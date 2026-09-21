import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { Readable, PassThrough } from 'node:stream';
import { Hono } from 'hono';
import { GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { CorpusObjectStore, type CorpusS3Client } from '../server/src/services/corpus-object-store';
import { resolveAudioFilePath, serveAudio } from '../server/src/services/audio-service';

const modified = new Date('2026-01-01T00:00:00Z');
function appWith(send: (command: any) => Promise<any>) {
  const store = new CorpusObjectStore({ bucketName: 'test', corpusObjectsPrefix: 'corpus/objects/' }, { send } as CorpusS3Client);
  return new Hono().get('/api/audio/*', serveAudio(undefined, store));
}
function failure(status: number, headers: Record<string, string> = {}) {
  return Object.assign(new Error('SECRET upstream details'), { $metadata: { httpStatusCode: status }, $response: { headers } });
}
function object(body = 'abcdefgh') {
  return { Body: Readable.from([Buffer.from(body)]), ContentLength: body.length, ContentType: 'audio/flac', ETag: '"version-1"', LastModified: modified };
}

test('S3 audio streams without buffering and preserves object metadata', async () => {
  const body = new PassThrough();
  const app = appWith(async command => {
    assert.ok(command instanceof GetObjectCommand);
    assert.equal(command.input.Key, 'corpus/objects/media/a b.flac');
    return { ...object(), Body: body };
  });
  const response = await app.request('/api/audio/media/a%20b.flac');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'audio/flac');
  assert.equal(response.headers.get('content-length'), '8');
  assert.equal(response.headers.get('etag'), '"version-1"');
  assert.equal(response.headers.get('last-modified'), modified.toUTCString());
  assert.equal(response.headers.get('accept-ranges'), 'bytes');
  const reader = response.body!.getReader();
  body.write('abcd');
  assert.equal(Buffer.from((await reader.read()).value!).toString(), 'abcd');
  body.end('efgh');
  assert.equal(Buffer.from((await reader.read()).value!).toString(), 'efgh');
  assert.equal((await reader.read()).done, true);
});

test('S3 audio forwards exact single ranges and preserves partial metadata', async () => {
  for (const range of ['bytes=1-3', 'bytes=3-', 'bytes=-3']) {
    const app = appWith(async command => {
      assert.equal(command.input.Range, range);
      return { ...object('bcd'), ContentRange: 'bytes 1-3/8' };
    });
    const response = await app.request('/api/audio/clip.flac', { headers: { Range: range } });
    assert.equal(response.status, 206);
    assert.equal(response.headers.get('content-range'), 'bytes 1-3/8');
    assert.equal(response.headers.get('content-length'), '3');
    assert.equal(await response.text(), 'bcd');
  }
});

test('HEAD uses metadata without downloading audio or forwarding Range', async () => {
  const app = appWith(async command => {
    assert.ok(command instanceof HeadObjectCommand);
    assert.equal(command.input.Range, undefined);
    assert.equal(command.input.IfNoneMatch, '"old"');
    return { ContentLength: 8, ETag: '"version-1"', LastModified: modified };
  });
  const response = await app.request('/api/audio/a.wav', { method: 'HEAD', headers: { Range: 'bytes=2-3', 'If-None-Match': '"old"' } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-length'), '8');
  assert.equal(response.headers.get('content-type'), 'audio/wav');
  assert.equal(await response.text(), '');
});

test('condition headers use HTTP precedence and dates', async () => {
  const date = modified.toUTCString();
  let calls = 0;
  const app = appWith(async command => {
    if (calls++ === 0) {
      assert.equal(command.input.IfMatch, '"v1"');
      assert.equal(command.input.IfNoneMatch, '"v2"');
      assert.equal(command.input.IfModifiedSince, undefined);
      assert.equal(command.input.IfUnmodifiedSince, undefined);
    } else {
      assert.deepEqual(command.input.IfModifiedSince, modified);
      assert.deepEqual(command.input.IfUnmodifiedSince, modified);
    }
    return object();
  });
  for (const headers of [
    { 'If-Match': '"v1"', 'If-None-Match': '"v2"', 'If-Modified-Since': date, 'If-Unmodified-Since': date },
    { 'If-Modified-Since': date, 'If-Unmodified-Since': date },
  ]) await (await app.request('/api/audio/a.flac', { headers })).text();
});

test('If-Range uses HEAD and sends Range only for a matching strong validator', async () => {
  for (const [validator, matches] of [
    ['"version-1"', true], ['"other"', false], ['W/"version-1"', false],
    [modified.toUTCString(), true], ['Wed, 01 Jan 2025 00:00:00 GMT', false], ['invalid', false],
  ] as const) {
    const commands: any[] = [];
    const app = appWith(async command => {
      commands.push(command);
      if (command instanceof HeadObjectCommand) return { ETag: '"version-1"', LastModified: modified };
      assert.equal(command.input.Range, matches ? 'bytes=1-3' : undefined);
      assert.equal(command.input.IfRange, undefined);
      assert.equal(command.input.IfMatch, matches ? '"version-1"' : undefined);
      return { ...object(matches ? 'bcd' : 'abcdefgh'), ...(matches ? { ContentRange: 'bytes 1-3/8' } : {}) };
    });
    const response = await app.request('/api/audio/a.flac', { headers: { Range: 'bytes=1-3', 'If-Range': validator } });
    assert.equal(response.status, matches ? 206 : 200);
    await response.text();
    assert.equal(commands.length, 2);
  }
});

test('If-Range falls back to full response when object changes between HEAD and GET', async () => {
  let gets = 0;
  const app = appWith(async command => {
    if (command instanceof HeadObjectCommand) return { ETag: '"version-1"', LastModified: modified };
    if (++gets === 1) {
      assert.equal(command.input.IfMatch, '"version-1"');
      throw failure(412);
    }
    assert.equal(command.input.IfMatch, undefined);
    assert.equal(command.input.Range, undefined);
    return object();
  });
  const response = await app.request('/api/audio/a.flac', { headers: { Range: 'bytes=1-3', 'If-Range': '"version-1"' } });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'abcdefgh');
});

test('If-Range pins metadata even with wildcard If-Match and rechecks original conditions on change', async () => {
  let gets = 0;
  const app = appWith(async command => {
    if (command instanceof HeadObjectCommand) {
      assert.equal(command.input.IfMatch, '*');
      return { ETag: '"version-1"', LastModified: modified };
    }
    if (++gets === 1) {
      assert.equal(command.input.IfMatch, '"version-1"');
      throw failure(412);
    }
    assert.equal(command.input.IfMatch, '*');
    assert.equal(command.input.Range, undefined);
    return object();
  });
  const response = await app.request('/api/audio/a.flac', {
    headers: { Range: 'bytes=1-3', 'If-Range': '"version-1"', 'If-Match': '*' },
  });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'abcdefgh');
});

test('cancelling a proxied response destroys the upstream stream', async () => {
  const body = new PassThrough();
  const app = appWith(async () => ({ ...object(), Body: body }));
  const response = await app.request('/api/audio/a.flac');
  await response.body!.cancel();
  assert.equal(body.destroyed, true);
});

test('missing body and transport failures return only a generic 502', async () => {
  for (const send of [
    async () => ({ ContentLength: 8 }),
    async () => { throw new Error('SECRET transport endpoint'); },
  ]) {
    const response = await appWith(send).request('/api/audio/a.flac');
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { error: 'audio-upstream-error' });
  }
});

test('upstream expected errors preserve HTTP status and never expose errors', async () => {
  for (const status of [304, 412, 404, 416, 403, 500]) {
    const app = appWith(async () => { throw failure(status, { etag: '"version-1"', 'content-range': 'bytes */8' }); });
    const response = await app.request('/api/audio/a.flac');
    assert.equal(response.status, [403, 500].includes(status) ? 502 : status);
    if (status === 304) assert.equal(response.headers.get('etag'), '"version-1"');
    if (status === 416) assert.equal(response.headers.get('content-range'), 'bytes */8');
    assert.ok(!(await response.text()).includes('SECRET'));
  }
});

test('range error obtains missing Content-Range using metadata', async () => {
  const app = appWith(async command => {
    if (command instanceof HeadObjectCommand) return { ContentLength: 8 };
    throw failure(416);
  });
  const response = await app.request('/api/audio/a.flac', { headers: { Range: 'bytes=99-' } });
  assert.equal(response.status, 416);
  assert.equal(response.headers.get('content-range'), 'bytes */8');
});

test('unsafe URL keys are rejected before any upstream call', async () => {
  let calls = 0;
  const app = appWith(async () => { calls++; return object(); });
  for (const key of ['%2e%2e%2fsecret', 'a%2fb', 'a%5cb', 'a%00b', '%252e%252e/a', 'a//b', '%invalid']) {
    assert.equal((await app.request(`/api/audio/${key}`)).status, 400, key);
  }
  for (const key of ['../secret', 'a\\b', 'a\0b', '/absolute']) {
    assert.throws(() => resolveAudioFilePath(key));
  }
  assert.equal(calls, 0);
});

test('local audio still streams ranges and refuses symlinks outside the objects root', async () => {
  const directory = path.resolve(`.test-local-audio-${randomUUID()}`);
  const root = path.join(directory, 'objects');
  await mkdir(root, { recursive: true });
  try {
    await writeFile(path.join(root, 'a.flac'), 'abcdefgh');
    await writeFile(path.join(directory, 'secret.flac'), 'secret');
    await symlink(path.join(directory, 'secret.flac'), path.join(root, 'escape.flac'));
    const app = new Hono().get('/api/audio/*', serveAudio(root));
    const range = await app.request('/api/audio/a.flac', { headers: { Range: 'bytes=1-3' } });
    assert.equal(range.status, 206);
    assert.equal(await range.text(), 'bcd');
    assert.equal((await app.request('/api/audio/escape.flac')).status, 400);
    assert.equal((await app.request('/api/audio/missing.flac')).status, 404);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
