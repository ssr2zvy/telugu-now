import path from 'node:path';
import { realpath } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { serveStatic } from '@hono/node-server/serve-static';
import type { MiddlewareHandler } from 'hono';
import type { GetObjectCommandInput, GetObjectCommandOutput, HeadObjectCommandOutput } from '@aws-sdk/client-s3';
import { config } from '../config/config';
import { CorpusObjectStore, getCorpusObjectStore, isSafeObjectKey, objectBodyStream } from './corpus-object-store';

const AUDIO_MIME_TYPES_BY_EXTENSION: Record<string, string> = {
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
};

export class InvalidAudioObjectKeyError extends Error {}

function decodeAudioObjectKey(objectKey: string): string {
  let segments: string[];
  try { segments = objectKey.split('/').map(segment => decodeURIComponent(segment)); }
  catch { throw new InvalidAudioObjectKeyError('Invalid audio object key.'); }
  if (segments.some(segment => segment.includes('/')) || !isSafeObjectKey(segments.join('/'))) {
    throw new InvalidAudioObjectKeyError('Invalid audio object key.');
  }
  return segments.join('/');
}

export function resolveAudioFilePath(objectKey: string, objectsRoot = config.corpusObjectsPath): string {
  const root = path.resolve(objectsRoot);
  const filePath = path.resolve(root, decodeAudioObjectKey(objectKey));
  if (!filePath.startsWith(root + path.sep)) {
    throw new InvalidAudioObjectKeyError('Invalid audio object key.');
  }
  return filePath;
}

export function audioMimeTypeForFilePath(filePath: string): string {
  return AUDIO_MIME_TYPES_BY_EXTENSION[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

function objectHeaders(result: GetObjectCommandOutput | HeadObjectCommandOutput, key: string): Headers {
  const headers = new Headers({
    'Accept-Ranges': 'bytes',
    'Content-Type': result.ContentType || audioMimeTypeForFilePath(key),
    'Cache-Control': result.CacheControl || 'public, max-age=31536000, immutable',
  });
  if (result.ContentLength !== undefined) headers.set('Content-Length', String(result.ContentLength));
  if (result.ContentRange) headers.set('Content-Range', result.ContentRange);
  if (result.ETag) headers.set('ETag', result.ETag);
  if (result.LastModified) headers.set('Last-Modified', result.LastModified.toUTCString());
  if (result.ContentEncoding) headers.set('Content-Encoding', result.ContentEncoding);
  return headers;
}

function conditionHeaders(request: Request): Omit<GetObjectCommandInput, 'Bucket' | 'Key'> {
  const result: Omit<GetObjectCommandInput, 'Bucket' | 'Key'> = {};
  const match = request.headers.get('if-match');
  const none = request.headers.get('if-none-match');
  if (match) result.IfMatch = match;
  if (none) result.IfNoneMatch = none;
  for (const [header, field, superseded] of [
    ['if-modified-since', 'IfModifiedSince', none],
    ['if-unmodified-since', 'IfUnmodifiedSince', match],
  ] as const) {
    const raw = request.headers.get(header);
    if (raw && !superseded) {
      const date = new Date(raw);
      if (Number.isFinite(date.getTime())) result[field] = date;
    }
  }
  return result;
}

function matchesIfRange(value: string, metadata: HeadObjectCommandOutput): boolean {
  if (value.startsWith('"') || value.startsWith('W/')) {
    return !value.startsWith('W/') && value === metadata.ETag && !metadata.ETag?.startsWith('W/');
  }
  const date = Date.parse(value);
  return Number.isFinite(date) && !!metadata.LastModified
    && Math.floor(metadata.LastModified.getTime() / 1000) <= Math.floor(date / 1000);
}

function upstreamStatus(error: unknown): number {
  const failure = error as { $metadata?: { httpStatusCode?: number }; name?: string };
  return failure?.$metadata?.httpStatusCode
    ?? ({ NoSuchKey: 404, NotFound: 404, InvalidRange: 416, PreconditionFailed: 412, NotModified: 304 }[failure?.name ?? ''] ?? 502);
}

async function serveRemoteAudio(request: Request, key: string, store: CorpusObjectStore): Promise<Response> {
  const conditions = conditionHeaders(request);
  const head = request.method === 'HEAD';
  try {
    if (head) {
      const result = await store.headObject(key, conditions);
      return new Response(null, { status: 200, headers: objectHeaders(result, key) });
    }
    let range = request.headers.get('range');
    const ifRange = request.headers.get('if-range');
    let pinnedEtag: string | undefined;
    if (range && ifRange) {
      const metadata = await store.headObject(key, conditions);
      if (!matchesIfRange(ifRange, metadata)) range = null;
      else if (metadata.ETag) pinnedEtag = metadata.ETag;
      else range = null;
    }
    let result: GetObjectCommandOutput;
    try {
      result = await store.getObject(key, {
        ...conditions, ...(range ? { Range: range } : {}),
        ...(pinnedEtag ? { IfMatch: pinnedEtag } : {}),
      });
    } catch (error) {
      // If-Range must deliver the whole new representation if it changed after HEAD.
      if (!pinnedEtag || upstreamStatus(error) !== 412) throw error;
      result = await store.getObject(key, conditions);
    }
    const headers = objectHeaders(result, key);
    const body = Readable.toWeb(objectBodyStream(result.Body), {
      strategy: { highWaterMark: 64 * 1024, size: chunk => chunk.byteLength },
    }) as ReadableStream<Uint8Array>;
    return new Response(body, { status: result.ContentRange ? 206 : 200, headers });
  } catch (error) {
    const status = upstreamStatus(error);
    if ([304, 412, 404, 416].includes(status)) {
      const headers = new Headers({ 'Accept-Ranges': 'bytes' });
      const upstreamHeaders = (error as { $response?: { headers?: Record<string, string> } }).$response?.headers;
      for (const name of ['etag', 'last-modified', 'cache-control']) {
        if (upstreamHeaders?.[name]) headers.set(name, upstreamHeaders[name]);
      }
      if (status === 416) {
        const contentRange = upstreamHeaders?.['content-range'];
        if (contentRange && /^bytes \*\/\d+$/.test(contentRange)) headers.set('Content-Range', contentRange);
        else {
          try {
            const metadata = await store.headObject(key);
            if (metadata.ContentLength !== undefined) headers.set('Content-Range', `bytes */${metadata.ContentLength}`);
          } catch { /* The original range error is still valid if metadata is unavailable. */ }
        }
      }
      return new Response(null, { status, headers });
    }
    return Response.json({ error: 'audio-upstream-error' }, { status: 502 });
  }
}

export function serveAudio(objectsRoot = config.corpusObjectsPath, objectStore?: CorpusObjectStore): MiddlewareHandler {
  return async (context) => {
    let filePath: string;
    let key: string;
    try {
      const encodedKey = context.req.path.slice('/api/audio/'.length);
      key = decodeAudioObjectKey(encodedKey);
      filePath = resolveAudioFilePath(encodedKey, objectsRoot);
    } catch (error) {
      if (error instanceof InvalidAudioObjectKeyError || error instanceof URIError) {
        return context.json({ error: 'invalid-object-key' }, 400);
      }
      throw error;
    }
    if (objectStore || config.corpusBackend === 'tigris') {
      try { return await serveRemoteAudio(context.req.raw, key, objectStore ?? getCorpusObjectStore()); }
      catch { return context.json({ error: 'audio-upstream-error' }, 502); }
    }
    try {
      const [root, actual] = await Promise.all([realpath(objectsRoot), realpath(filePath)]);
      if (!actual.startsWith(root + path.sep)) return context.json({ error: 'invalid-object-key' }, 400);
      filePath = actual;
    } catch (error) {
      if (['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) {
        return context.json({ error: 'audio-not-found' }, 404);
      }
      throw error;
    }
    context.header('Accept-Ranges', 'bytes');
    const response = await serveStatic({ path: filePath })(context, async () => {});
    if (!response) return context.json({ error: 'audio-not-found' }, 404);
    response.headers.set('Content-Type', audioMimeTypeForFilePath(filePath));
    if (response.ok) response.headers.set('Cache-Control', 'public, max-age=31536000, immutable');
    return response;
  };
}
