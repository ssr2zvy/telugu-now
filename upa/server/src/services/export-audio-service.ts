import path from 'node:path';
import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { MiddlewareHandler } from 'hono';
import { config } from '../config/config';
import { decodeAudioObjectKey, InvalidAudioObjectKeyError, resolveAudioFilePath } from './audio-service';
import { CorpusObjectStore, getCorpusObjectStore, objectBodyStream } from './corpus-object-store';

export class ExportAudioError extends Error {
  constructor(readonly code: string, readonly status: 400 | 404 | 408 | 413 | 422 | 502 | 503 | 504) {
    super(code);
  }
}

export interface AudioSource { body: Readable; size?: number | undefined }
interface ConversionLimits {
  concurrency: number;
  inputBytes: number;
  outputBytes: number;
  durationSeconds: number;
  timeoutMs: number;
}
const DEFAULT_LIMITS: ConversionLimits = {
  concurrency: 2,
  inputBytes: 32 * 1024 * 1024,
  outputBytes: 8 * 1024 * 1024,
  durationSeconds: 300,
  timeoutMs: 30_000,
};

export class Mp3AudioConverter {
  private active = 0;
  private readonly limits: ConversionLimits;

  constructor(limits: Partial<ConversionLimits> = {}) {
    this.limits = { ...DEFAULT_LIMITS, ...limits };
  }

  async convert(
    load: (signal: AbortSignal) => Promise<AudioSource>,
    format: 'wav' | 'flac',
    requestSignal: AbortSignal,
  ): Promise<Buffer> {
    if (this.active >= this.limits.concurrency) throw new ExportAudioError('audio-conversion-busy', 503);
    this.active++;
    const controller = new AbortController();
    const disconnect = () => controller.abort(new ExportAudioError('audio-conversion-cancelled', 408));
    requestSignal.addEventListener('abort', disconnect, { once: true });
    if (requestSignal.aborted) disconnect();
    const timeout = setTimeout(() => controller.abort(new ExportAudioError('audio-conversion-timeout', 504)), this.limits.timeoutMs);
    let source: AudioSource | undefined;
    try {
      controller.signal.throwIfAborted();
      // The loader receives cancellation; a late response must not leak an upstream stream.
      const loading = load(controller.signal).then(value => {
        if (controller.signal.aborted) {
          value.body.destroy();
          throw controller.signal.reason;
        }
        return value;
      });
      let abortLoad: (() => void) | undefined;
      try {
        source = await Promise.race([loading, new Promise<never>((_, reject) => {
          abortLoad = () => reject(controller.signal.reason);
          controller.signal.addEventListener('abort', abortLoad, { once: true });
          if (controller.signal.aborted) abortLoad();
        })]);
      } finally {
        if (abortLoad) controller.signal.removeEventListener('abort', abortLoad);
      }
      if (source.size !== undefined && source.size > this.limits.inputBytes) {
        throw new ExportAudioError('audio-conversion-too-large', 413);
      }
      return await this.encode(source.body, format, controller, source.size);
    } finally {
      source?.body.destroy();
      clearTimeout(timeout);
      requestSignal.removeEventListener('abort', disconnect);
      this.active--;
    }
  }

  private async encode(source: Readable, format: 'wav' | 'flac', controller: AbortController, expectedInputBytes?: number): Promise<Buffer> {
    const child = spawn('ffmpeg', [
      '-nostdin', '-hide_banner', '-loglevel', 'error',
      '-xerror', '-err_detect', 'explode',
      '-max_alloc', String(32 * 1024 * 1024),
      '-protocol_whitelist', 'pipe', '-threads', '1', '-f', format, '-i', 'pipe:0',
      '-map', '0:a:0', '-vn', '-sn', '-dn', '-map_metadata', '-1',
      '-filter_threads', '1', '-threads', '1', '-ac', '1', '-ar', '44100',
      '-c:a', 'libmp3lame', '-b:a', '128k',
      // Decode a little past the limit so oversized recordings fail rather than silently truncate.
      '-t', String(this.limits.durationSeconds + 1),
      '-progress', 'pipe:3', '-f', 'mp3', 'pipe:1',
    ], { shell: false, stdio: ['pipe', 'pipe', 'pipe', 'pipe'] });
    const abort = () => {
      source.destroy();
      child.stdin!.destroy();
      child.kill('SIGKILL');
    };
    controller.signal.addEventListener('abort', abort, { once: true });
    if (controller.signal.aborted) abort();
    let inputBytes = 0;
    let sourceEnded = false;
    source.once('end', () => { sourceEnded = true; });
    let outputBytes = 0;
    const chunks: Buffer[] = [];
    let decoderError = '';
    child.stderr!.on('data', (chunk: Buffer) => {
      if (decoderError.length < 16_384) decoderError += chunk.toString().slice(0, 16_384 - decoderError.length);
    });
    const fail = (code: string, status: 413 | 422 | 502 | 503) => controller.abort(new ExportAudioError(code, status));
    child.on('error', (error: NodeJS.ErrnoException) =>
      fail('audio-converter-unavailable', 503));
    child.stdout!.on('data', (chunk: Buffer) => {
      outputBytes += chunk.length;
      if (outputBytes > this.limits.outputBytes) fail('audio-conversion-too-large', 413);
      else chunks.push(chunk);
    });
    let progress = '';
    let decodedTimeUs = 0;
    (child.stdio[3] as Readable).setEncoding('utf8').on('data', (chunk: string) => {
      progress += chunk;
      const lines = progress.split('\n');
      progress = lines.pop()!;
      for (const line of lines) {
        if (line.startsWith('out_time_us=')) decodedTimeUs = Math.max(decodedTimeUs, Number(line.slice(12)) || 0);
        if (line.startsWith('out_time_us=') && Number(line.slice(12)) > (this.limits.durationSeconds + 0.1) * 1_000_000) {
          fail('audio-conversion-too-long', 413);
        }
      }
    });
    let decoderInputClosed = false;
    child.stdin!.once('error', () => { decoderInputClosed = true; });
    child.stdin!.once('close', () => { decoderInputClosed = true; });
    source.once('error', () => {
      // pipeline also destroys the source when ffmpeg rejects input early. Do
      // not misclassify that propagated pipe error as a transient network error.
      if (!decoderInputClosed) fail('audio-upstream-error', 502);
    });
    const input = pipeline(source, new Transform({
      transform: (chunk: Buffer, _encoding, callback) => {
        inputBytes += chunk.length;
        if (inputBytes > this.limits.inputBytes) {
          fail('audio-conversion-too-large', 413);
          callback(new ExportAudioError('audio-conversion-too-large', 413));
        } else callback(null, chunk);
      },
    }), child.stdin!).catch(() => {
      // ffmpeg may close stdin before reporting a malformed file. Its exit status
      // distinguishes that from unavailable codecs; source errors are handled above.
    });
    try {
      const code = await new Promise<number | null>(resolve => child.once('close', resolve));
      source.destroy();
      await input;
      controller.signal.throwIfAborted();
      if (sourceEnded && expectedInputBytes !== undefined && inputBytes !== expectedInputBytes) {
        throw new ExportAudioError('audio-upstream-error', 502);
      }
      if (code === null || /Unknown (encoder|decoder)|Unknown (input|output) format|(encoder|decoder|demuxer|muxer).*not found|no (encoder|decoder) found|Cannot allocate memory|Memory allocation failed|Resource temporarily unavailable/i.test(decoderError)) {
        throw new ExportAudioError('audio-converter-unavailable', 503);
      }
      if (code !== 0 || outputBytes === 0 || decodedTimeUs <= 0) throw new ExportAudioError('audio-conversion-failed', 422);
      return Buffer.concat(chunks);
    } finally {
      controller.signal.removeEventListener('abort', abort);
      source.destroy();
      child.stdin!.destroy();
      if (child.exitCode === null) child.kill('SIGKILL');
    }
  }
}

const converter = new Mp3AudioConverter();

export function serveExportAudio(
  objectsRoot = config.corpusObjectsPath,
  objectStore?: CorpusObjectStore,
  audioConverter = converter,
): MiddlewareHandler {
  return async context => {
    context.header('Cache-Control', 'no-store');
    if (context.req.method !== 'GET') return context.json({ error: 'method-not-allowed' }, 405, { Allow: 'GET' });
    try {
      const encodedKey = context.req.path.slice('/api/export-audio/'.length);
      const key = decodeAudioObjectKey(encodedKey);
      const filePath = resolveAudioFilePath(encodedKey, objectsRoot);
      const extension = path.extname(key).toLowerCase();
      if (extension !== '.wav' && extension !== '.flac') {
        throw new ExportAudioError('unsupported-export-audio-type', 400);
      }
      const bytes = await audioConverter.convert(async signal => {
        if (objectStore || config.corpusBackend === 'tigris') {
          const result = await (objectStore ?? getCorpusObjectStore()).getObject(key, {}, signal);
          return { body: objectBodyStream(result.Body), size: result.ContentLength };
        }
        const [root, actual] = await Promise.all([realpath(objectsRoot), realpath(filePath)]);
        if (!actual.startsWith(root + path.sep)) throw new InvalidAudioObjectKeyError();
        const metadata = await stat(actual);
        if (!metadata.isFile()) throw new ExportAudioError('audio-not-found', 404);
        signal.throwIfAborted();
        return { body: createReadStream(actual), size: metadata.size };
      }, extension === '.wav' ? 'wav' : 'flac', context.req.raw.signal);
      return new Response(new Uint8Array(bytes), {
        headers: { 'Content-Type': 'audio/mpeg', 'Content-Length': String(bytes.length), 'Cache-Control': 'no-store' },
      });
    } catch (error) {
      if (error instanceof ExportAudioError) {
        if (error.status === 503) context.header('Retry-After', '2');
        return context.json({ error: error.code }, error.status);
      }
      if (error instanceof InvalidAudioObjectKeyError || error instanceof URIError) {
        return context.json({ error: 'invalid-object-key' }, 400);
      }
      const failure = error as { code?: string; name?: string; $metadata?: { httpStatusCode?: number } };
      if (['ENOENT', 'ENOTDIR'].includes(failure?.code ?? '') || failure?.$metadata?.httpStatusCode === 404
        || failure?.name === 'NoSuchKey') return context.json({ error: 'audio-not-found' }, 404);
      return context.json({ error: 'audio-upstream-error' }, 502);
    }
  };
}
