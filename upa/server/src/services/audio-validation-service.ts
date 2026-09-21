import path from 'node:path';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { Transform } from 'node:stream';
import type { AudioMedia, MediaItem } from '../../../shared/contracts';
import { config } from '../config/config';
import { CorpusObjectStore, getCorpusObjectStore, isSafeObjectKey, objectBodyStream } from './corpus-object-store';
import { ExportAudioError, Mp3AudioConverter, type AudioSource } from './export-audio-service';
import { audioValidationStore, type AudioValidationStore } from './audio-validation-store';

export class AudioValidationError extends Error {
  constructor(readonly code: string, readonly permanent: boolean, readonly objectKey: string) {
    super(code);
  }
}

export class AudioValidationService {
  private readonly inFlight = new Map<string, Promise<void>>();
  private readonly converter = new Mp3AudioConverter({ concurrency: 2 });

  constructor(
    private readonly report: AudioValidationStore = audioValidationStore,
    private readonly objectsRoot = config.corpusObjectsPath,
    private readonly objectStore?: CorpusObjectStore,
    private readonly remote = config.corpusBackend === 'tigris',
    private readonly timeoutMs = 30_000,
  ) {}

  async validate(media: readonly MediaItem[]): Promise<void> {
    for (const item of media) if (item.kind === 'audio') await this.validateAudio(item);
  }

  private async validateAudio(audio: AudioMedia): Promise<void> {
    const reason = this.report.invalidReason(audio.objectKey);
    if (reason) throw new AudioValidationError(reason, true, audio.objectKey);
    const key = JSON.stringify([audio.objectKey, audio.sha256]);
    let pending = this.inFlight.get(key);
    if (!pending) {
      if (this.inFlight.size >= 2) throw new AudioValidationError('audio-validation-busy', false, audio.objectKey);
      pending = this.check(audio);
      this.inFlight.set(key, pending);
      const cleanup = () => { this.inFlight.delete(key); };
      void pending.then(cleanup, cleanup);
    }
    return pending;
  }

  private async check(audio: AudioMedia): Promise<void> {
    const key = audio.objectKey;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const bounded = async <T>(operation: Promise<T>): Promise<T> => {
      let abort: (() => void) | undefined;
      try {
        return await Promise.race([operation, new Promise<never>((_, reject) => {
          abort = () => reject(controller.signal.reason);
          controller.signal.addEventListener('abort', abort, { once: true });
          if (controller.signal.aborted) abort();
        })]);
      } finally { if (abort) controller.signal.removeEventListener('abort', abort); }
    };
    let identity: string | null = null;
    const hash = createHash('sha256');
    try {
      if (!isSafeObjectKey(key) || !['.wav', '.flac'].includes(path.extname(key).toLowerCase())) {
        throw new AudioValidationError('invalid-audio-object', true, key);
      }
      let load: (signal: AbortSignal) => Promise<AudioSource>;
      if (this.objectStore || this.remote) {
        const store = this.objectStore ?? getCorpusObjectStore();
        const metadata = await bounded(store.headObject(key, {}, controller.signal));
        identity = metadata.ETag ? JSON.stringify([
          'decode-v1', metadata.VersionId ?? null, metadata.ETag, metadata.ContentLength,
          metadata.LastModified?.toISOString(), audio.sha256,
        ]) : null;
        load = async signal => {
          const result = await store.getObject(key, {
            ...(metadata.VersionId ? { VersionId: metadata.VersionId } : {}),
            ...(metadata.ETag ? { IfMatch: metadata.ETag } : {}),
          }, signal);
          return { body: objectBodyStream(result.Body), size: result.ContentLength };
        };
      } else {
        const root = await bounded(realpath(this.objectsRoot)).catch(() => {
          throw new AudioValidationError('audio-storage-unavailable', false, key);
        });
        const actual = await bounded(realpath(path.resolve(this.objectsRoot, key)));
        if (!actual.startsWith(root + path.sep)) throw new AudioValidationError('invalid-audio-object', true, key);
        const metadata = await bounded(stat(actual));
        if (!metadata.isFile()) throw new AudioValidationError('audio-not-found', true, key);
        identity = JSON.stringify(['decode-v1', actual, metadata.dev, metadata.ino, metadata.size, metadata.mtimeMs, metadata.ctimeMs, audio.sha256]);
        load = async signal => {
          signal.throwIfAborted();
          return { body: createReadStream(actual), size: metadata.size };
        };
      }
      controller.signal.throwIfAborted();
      if (identity && this.report.isValid(key, identity)) return;
      await this.converter.convert(async signal => {
        const source = await load(signal);
        const hashing = new Transform({
          transform(chunk: Buffer, _encoding, callback) { hash.update(chunk); callback(null, chunk); },
        });
        source.body.on('error', error => hashing.destroy(error));
        hashing.once('close', () => source.body.destroy());
        source.body.pipe(hashing);
        return { body: hashing, size: source.size };
      }, path.extname(key).toLowerCase() === '.wav' ? 'wav' : 'flac', controller.signal);
      if (/^[a-f0-9]{64}$/i.test(audio.sha256) && hash.digest('hex') !== audio.sha256.toLowerCase()) {
        throw new AudioValidationError('audio-checksum-mismatch', true, key);
      }
      if (identity) this.report.recordValid(key, identity);
    } catch (error) {
      let failure: AudioValidationError;
      if (error instanceof AudioValidationError) failure = error;
      else if (error instanceof ExportAudioError) {
        failure = new AudioValidationError(error.code, error.status === 422, key);
      } else {
        const upstream = error as { code?: string; name?: string; $metadata?: { httpStatusCode?: number } };
        const missing = ['ENOENT', 'ENOTDIR'].includes(upstream?.code ?? '')
          || upstream?.$metadata?.httpStatusCode === 404 || ['NoSuchKey', 'NotFound'].includes(upstream?.name ?? '');
        failure = new AudioValidationError(missing ? 'audio-not-found' : 'audio-validation-unavailable', missing, key);
      }
      if (failure.permanent) this.report.quarantine(key, failure.code);
      throw failure;
    } finally { clearTimeout(timer); }
  }
}

export const audioValidationService = new AudioValidationService();
