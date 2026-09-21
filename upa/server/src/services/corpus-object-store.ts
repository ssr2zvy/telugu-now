import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { lstat, mkdir, link, rename, unlink, open } from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import Database from 'better-sqlite3';
import {
  GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, S3Client,
  type GetObjectCommandInput, type GetObjectCommandOutput,
} from '@aws-sdk/client-s3';
import { config } from '../config/config';

export interface CorpusObjectStoreOptions {
  bucketName?: string | undefined;
  corpusObjectsPrefix: string;
  awsEndpointUrlS3?: string | undefined;
  awsRegion?: string | undefined;
}

export type CorpusS3Client = Pick<S3Client, 'send'>;
export interface CorpusObject { key: string; size: number }

export function isSafeObjectKey(key: string): boolean {
  return key.length > 0 && !/[\\\0-\x1f\x7f]/.test(key)
    && !/%(?:2f|5c|00|2e|25)/i.test(key)
    && key.split('/').every(segment => segment !== '' && segment !== '.' && segment !== '..');
}

export function objectBodyStream(body: GetObjectCommandOutput['Body']): Readable {
  if (!body) throw new Error('Object response has no body.');
  if (body instanceof Readable) return body;
  return Readable.fromWeb(body.transformToWebStream() as import('node:stream/web').ReadableStream);
}

export class CorpusObjectStore {
  readonly client: CorpusS3Client;
  readonly prefix: string;
  readonly bucket: string;

  constructor(options: CorpusObjectStoreOptions, client?: CorpusS3Client) {
    if (!options.bucketName) throw new Error('BUCKET_NAME is required for the tigris corpus backend.');
    this.bucket = options.bucketName;
    this.prefix = options.corpusObjectsPrefix;
    if (!this.prefix.endsWith('/') || !isSafeObjectKey(this.prefix.slice(0, -1))) {
      throw new Error('Invalid corpus objects prefix.');
    }
    // Omitting credentials intentionally uses the official SDK default provider chain.
    this.client = client ?? new S3Client({
      region: options.awsRegion || 'auto',
      ...(options.awsEndpointUrlS3 ? { endpoint: options.awsEndpointUrlS3 } : {}),
    });
  }

  private key(relativeKey: string): string {
    if (!isSafeObjectKey(relativeKey)) throw new Error('Invalid corpus object key.');
    return this.prefix + relativeKey;
  }

  getObject(relativeKey: string, input: Omit<GetObjectCommandInput, 'Bucket' | 'Key'> = {}, abortSignal?: AbortSignal) {
    return this.client.send(new GetObjectCommand({ ...input, Bucket: this.bucket, Key: this.key(relativeKey) }),
      abortSignal ? { abortSignal } : {});
  }

  headObject(relativeKey: string, input: Omit<GetObjectCommandInput, 'Bucket' | 'Key'> = {}, signal?: AbortSignal) {
    return this.client.send(new HeadObjectCommand({ ...input, Bucket: this.bucket, Key: this.key(relativeKey) }), signal ? { abortSignal: signal } : undefined);
  }

  async *inventory(): AsyncIterable<CorpusObject> {
    let token: string | undefined;
    const seenTokens = new Set<string>();
    do {
      const page = await this.client.send(new ListObjectsV2Command({
        Bucket: this.bucket, Prefix: this.prefix,
        ...(token ? { ContinuationToken: token } : {}),
      }));
      if (typeof page.IsTruncated !== 'boolean' || (page.Contents !== undefined && !Array.isArray(page.Contents))) {
        throw new Error('Invalid corpus inventory response.');
      }
      const next = page.NextContinuationToken;
      if (page.IsTruncated && (typeof next !== 'string' || !next.trim() || seenTokens.has(next))) {
        throw new Error('Invalid corpus inventory continuation token.');
      }
      const entries: CorpusObject[] = [];
      for (const object of page.Contents ?? []) {
        if (typeof object.Key !== 'string' || !object.Key.startsWith(this.prefix)
          || !Number.isSafeInteger(object.Size) || object.Size! < 0) {
          throw new Error('Invalid corpus inventory object.');
        }
        const key = object.Key.slice(this.prefix.length);
        if (object.Size === 0 && (key === '' || (key.endsWith('/') && isSafeObjectKey(key.slice(0, -1))))) continue;
        if (!isSafeObjectKey(key)) throw new Error('Invalid corpus inventory object key.');
        entries.push({ key, size: object.Size! });
      }
      // Validate the whole page (including its continuation) before exposing any entries.
      yield* entries;
      token = page.IsTruncated ? next : undefined;
      if (token) seenTokens.add(token);
    } while (token);
  }

  async ensureCorpusDatabase(localPath = config.corpusDatabasePath, forceRedownload = false): Promise<boolean> {
    if (!forceRedownload) {
      try {
        await lstat(localPath);
        return false;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    await mkdir(path.dirname(localPath), { recursive: true });
    const staged = `${localPath}.${randomUUID()}.download`;
    try {
      const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: 'corpus/corpus.sqlite' }));
      let received = 0;
      const counter = new Transform({
        transform(chunk, _encoding, callback) { received += chunk.length; callback(null, chunk); },
      });
      await pipeline(objectBodyStream(result.Body), counter, createWriteStream(staged, { flags: 'wx', mode: 0o600 }));
      if (result.ContentLength !== undefined && result.ContentLength !== received) {
        throw new Error('Incomplete corpus database download.');
      }
      const file = await open(staged, 'r+');
      try {
        const header = Buffer.alloc(16);
        await file.read(header, 0, 16, 0);
        if (!header.equals(Buffer.from('SQLite format 3\0'))) throw new Error('Invalid corpus SQLite database.');
        await file.sync();
      } finally { await file.close(); }
      const database = new Database(staged, { readonly: true, fileMustExist: true });
      try {
        const checks = database.pragma('quick_check') as { quick_check: string }[];
        if (checks.length !== 1 || checks[0]?.quick_check !== 'ok') throw new Error('Invalid corpus SQLite database.');
        database.prepare(`
          SELECT source_id, display_name, provider, license, upstream_url, catalog_version,
                 accepted_rows, rejected_rows, complexity_metric, status FROM sources LIMIT 0
        `).all();
        database.prepare(`
          SELECT source_id, source_key, text, grapheme_count, audio_sha256,
                 audio_object_key, audio_mime_type, duration_seconds FROM source_rows LIMIT 0
        `).all();
      } finally { database.close(); }
      // A hard link publishes atomically without ever replacing a concurrently created cache,
      // unless forceRedownload requests an atomic replace of any existing catalog.
      if (forceRedownload) {
        await rename(staged, localPath);
      } else {
        try { await link(staged, localPath); }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
          throw error;
        }
      }
      const directory = await open(path.dirname(localPath), 'r');
      try { await directory.sync(); } finally { await directory.close(); }
      return true;
    } finally {
      await Promise.all([staged, `${staged}-wal`, `${staged}-shm`, `${staged}-journal`].map(file =>
        unlink(file).catch(error => { if (error.code !== 'ENOENT') throw error; }),
      ));
    }
  }
}

let store: CorpusObjectStore | undefined;
export function getCorpusObjectStore(): CorpusObjectStore {
  return store ??= new CorpusObjectStore(config);
}

export async function ensureCorpusDatabase(localPath = config.corpusDatabasePath, forceRedownload = false): Promise<boolean> {
  return getCorpusObjectStore().ensureCorpusDatabase(localPath, forceRedownload);
}
