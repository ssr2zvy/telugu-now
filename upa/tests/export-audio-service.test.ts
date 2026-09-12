import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { PassThrough, Readable } from 'node:stream';
import { Hono } from 'hono';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { CorpusObjectStore, type CorpusS3Client } from '../server/src/services/corpus-object-store';
import { Mp3AudioConverter, serveExportAudio } from '../server/src/services/export-audio-service';

const ffmpegAvailable = spawnSync('ffmpeg', ['-version']).status === 0;
const integration = { skip: ffmpegAvailable ? false : 'Install ffmpeg to run real WAV/FLAC → MP3 integration tests' };
const signal = () => new AbortController().signal;
function wav(duration = 0.25): Buffer {
  const samples = Math.round(16_000 * duration);
  const bytes = Buffer.alloc(44 + samples * 2);
  bytes.write('RIFF', 0);
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(16_000, 24);
  bytes.writeUInt32LE(32_000, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36);
  bytes.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) bytes.writeInt16LE(Math.round(Math.sin(i * 2 * Math.PI * 440 / 16_000) * 8_000), 44 + i * 2);
  return bytes;
}
function ffmpeg(input: Buffer, args: string[]): Buffer {
  const result = spawnSync('ffmpeg', ['-nostdin', '-v', 'error', '-threads', '1', '-i', 'pipe:0', ...args, 'pipe:1'], { input });
  assert.equal(result.status, 0, result.stderr?.toString());
  return result.stdout;
}
function assertMp3(bytes: Buffer) {
  const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,sample_rate,channels', '-of', 'json', 'pipe:0'], { input: bytes });
  assert.equal(probe.status, 0, probe.stderr?.toString());
  assert.deepEqual(JSON.parse(probe.stdout.toString()).streams, [{ codec_name: 'mp3', sample_rate: '44100', channels: 1 }]);
  const pcm = ffmpeg(bytes, ['-f', 's16le', '-acodec', 'pcm_s16le']);
  assert.ok(pcm.length > 20_000, 'MP3 must decode to real audio, not merely carry an MP3 header');
  assert.ok(pcm.some(byte => byte !== 0));
}
function remoteApp(send: (command: any, options?: any) => Promise<any>, converter = new Mp3AudioConverter()) {
  const store = new CorpusObjectStore({ bucketName: 'test', corpusObjectsPrefix: 'corpus/objects/' }, { send } as CorpusS3Client);
  return new Hono().all('/api/export-audio/*', serveExportAudio(undefined, store, converter));
}

test('real WAV and FLAC objects become decodable MP3 without forwarding original range/cache metadata', integration, async () => {
  const original = wav();
  const flac = ffmpeg(original, ['-threads', '1', '-f', 'flac']);
  for (const [extension, bytes] of [['wav', original], ['flac', flac]] as const) {
    const app = remoteApp(async (command, options) => {
      assert.ok(command instanceof GetObjectCommand);
      assert.equal(command.input.Key, `corpus/objects/a b.${extension}`);
      assert.equal(command.input.Range, undefined);
      assert.equal(command.input.IfNoneMatch, undefined);
      assert.ok(options.abortSignal instanceof AbortSignal);
      return {
        Body: Readable.from([bytes]), ContentLength: bytes.length,
        ContentType: `audio/${extension}`, ETag: '"original"', ContentRange: 'bytes 0-1/100',
        CacheControl: 'public, immutable', ContentEncoding: 'identity',
      };
    });
    const response = await app.request(`/api/export-audio/a%20b.${extension}?v=2`, {
      headers: { Range: 'bytes=0-1', 'If-None-Match': '"original"' },
    });
    assert.equal(response.status, 200, await (!response.ok ? response.text() : Promise.resolve('')));
    assert.equal(response.headers.get('content-type'), 'audio/mpeg');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    for (const header of ['content-range', 'accept-ranges', 'etag', 'last-modified', 'content-encoding']) {
      assert.equal(response.headers.get(header), null);
    }
    const mp3 = Buffer.from(await response.arrayBuffer());
    assert.equal(Number(response.headers.get('content-length')), mp3.length);
    assert.notDeepEqual(mp3, bytes);
    assertMp3(mp3);
  }
});

test('conversion validates keys, source extensions and HTTP methods before loading an object', async () => {
  let calls = 0;
  const app = remoteApp(async () => { calls++; throw new Error('Must not load'); });
  for (const key of ['%2e%2e%2fsecret.wav', 'a%2fb.wav', 'a%5cb.wav', 'a%00b.wav', '%252e%252e/a.wav', 'a//b.wav', '%invalid.wav', 'https:%2f%2fhost/a.wav']) {
    assert.equal((await app.request(`/api/export-audio/${key}`)).status, 400, key);
  }
  for (const key of ['a.mp3', 'a.m3u', 'a.txt']) {
    const response = await app.request(`/api/export-audio/${key}`);
    assert.equal(response.status, 400);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  for (const method of ['HEAD', 'POST']) {
    const response = await app.request('/api/export-audio/a.wav', { method });
    assert.equal(response.status, 405);
    assert.equal(response.headers.get('allow'), 'GET');
  }
  assert.equal(calls, 0);
});

test('local conversion respects corpus symlink protections and never writes original files', integration, async () => {
  const directory = path.resolve(`.test-export-audio-${randomUUID()}`);
  const root = path.join(directory, 'objects');
  await mkdir(root, { recursive: true });
  try {
    await writeFile(path.join(root, 'clip.wav'), wav());
    await writeFile(path.join(directory, 'secret.wav'), wav());
    await symlink(path.join(directory, 'secret.wav'), path.join(root, 'escape.wav'));
    const app = new Hono().all('/api/export-audio/*', serveExportAudio(root));
    const response = await app.request('/api/export-audio/clip.wav');
    assert.equal(response.status, 200);
    assertMp3(Buffer.from(await response.arrayBuffer()));
    assert.equal((await app.request('/api/export-audio/escape.wav')).status, 400);
    assert.equal((await app.request('/api/export-audio/missing.wav')).status, 404);
    const { readFile, readdir } = await import('node:fs/promises');
    assert.deepEqual(await readFile(path.join(root, 'clip.wav')), wav());
    assert.deepEqual((await readdir(root)).sort(), ['clip.wav', 'escape.wav']);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('conversion errors are explicit, sanitized and release resources', integration, async () => {
  for (const [body, limits, expected] of [
    [Buffer.from('not an audio file'), {}, 422],
    [wav(), { inputBytes: 100 }, 413],
    [wav(), { outputBytes: 100 }, 413],
    [wav(2), { durationSeconds: 0.5 }, 413],
  ] as const) {
    const source = Readable.from([body]);
    const app = remoteApp(async () => ({ Body: source }), new Mp3AudioConverter(limits));
    const response = await app.request('/api/export-audio/clip.wav');
    assert.equal(response.status, expected, await response.clone().text());
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(source.destroyed, true);
    assert.match(await response.text(), /audio-conversion-/);
  }
  for (const status of [404, 403, 500]) {
    const app = remoteApp(async () => { throw Object.assign(new Error('SECRET credentials'), { $metadata: { httpStatusCode: status } }); });
    const response = await app.request('/api/export-audio/clip.wav');
    assert.equal(response.status, status === 404 ? 404 : 502);
    assert.ok(!(await response.text()).includes('SECRET'));
  }
});

test('concurrency is bounded without a waiting queue; abort cancels a stalled upstream load', async () => {
  const converter = new Mp3AudioConverter({ concurrency: 1, timeoutMs: 1000 });
  const controller = new AbortController();
  let upstreamSignal: AbortSignal | undefined;
  let finishLoad!: (source: { body: Readable }) => void;
  const first = converter.convert(async inputSignal => {
    upstreamSignal = inputSignal;
    return new Promise(resolve => { finishLoad = resolve; });
  }, 'wav', controller.signal);
  await assert.rejects(converter.convert(async () => ({ body: Readable.from([]) }), 'wav', signal()), /audio-conversion-busy/);
  const rejected = assert.rejects(first, /audio-conversion-cancelled/);
  controller.abort();
  await rejected;
  assert.equal(upstreamSignal!.aborted, true);
  const late = new PassThrough();
  finishLoad({ body: late });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(late.destroyed, true);
  await assert.rejects(converter.convert(async () => { throw new Error('slot released'); }, 'wav', signal()), /slot released/);
});

test('oversized metadata, missing encoder and broken upstream fail without leaking streams', async () => {
  const metadataSource = new PassThrough();
  const metadataApp = remoteApp(async () => ({ Body: metadataSource, ContentLength: 33 * 1024 * 1024 }));
  assert.equal((await metadataApp.request('/api/export-audio/clip.wav')).status, 413);
  assert.equal(metadataSource.destroyed, true);

  const originalPath = process.env.PATH;
  const source = Readable.from([wav()]);
  try {
    process.env.PATH = path.resolve('.nonexistent-ffmpeg-directory');
    const app = remoteApp(async () => ({ Body: source }));
    const response = await app.request('/api/export-audio/clip.wav');
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: 'audio-converter-unavailable' });
    assert.equal(response.headers.get('retry-after'), '2');
    assert.equal(source.destroyed, true);
  } finally {
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
  }
});

test('broken upstream during encoding is sanitized and releases the conversion slot', integration, async () => {
  const converter = new Mp3AudioConverter({ concurrency: 1 });
  const body = new Readable({ read() { this.destroy(new Error('SECRET transport details')); } });
  const app = remoteApp(async () => ({ Body: body }), converter);
  const response = await app.request('/api/export-audio/clip.wav');
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: 'audio-upstream-error' });
  assert.equal(body.destroyed, true);
  const output = await converter.convert(async () => ({ body: Readable.from([wav()]) }), 'wav', signal());
  assertMp3(output);
});

test('timeouts cover upstream loading as well as ffmpeg input; disconnect destroys a live input stream', integration, async () => {
  const converter = new Mp3AudioConverter({ concurrency: 1, timeoutMs: 100 });
  await assert.rejects(converter.convert(async () => new Promise(() => {}), 'wav', signal()), /audio-conversion-timeout/);
  const stalled = new PassThrough();
  await assert.rejects(converter.convert(async () => ({ body: stalled }), 'wav', signal()), /audio-conversion-timeout/);
  assert.equal(stalled.destroyed, true);
  const input = new PassThrough();
  const controller = new AbortController();
  const running = converter.convert(async () => ({ body: input }), 'wav', controller.signal);
  const rejected = assert.rejects(running, /audio-conversion-cancelled/);
  await new Promise(resolve => setImmediate(resolve));
  controller.abort();
  await rejected;
  assert.equal(input.destroyed, true);
});
