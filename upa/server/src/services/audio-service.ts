import path from 'node:path';
import { serveStatic } from '@hono/node-server/serve-static';
import type { MiddlewareHandler } from 'hono';
import { config } from '../config/config';

const AUDIO_MIME_TYPES_BY_EXTENSION: Record<string, string> = {
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
};

export class InvalidAudioObjectKeyError extends Error {}

// Object keys are always server-generated (never user input), but this still
// rejects traversal segments defensively before resolving the file path.
export function resolveAudioFilePath(objectKey: string, objectsRoot = config.corpusObjectsPath): string {
  const segments = objectKey.split('/').map((segment) => decodeURIComponent(segment));
  if (segments.length === 0 || segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new InvalidAudioObjectKeyError(`Invalid audio object key: ${objectKey}`);
  }

  const filePath = path.resolve(objectsRoot, segments.join('/'));
  if (filePath !== objectsRoot && !filePath.startsWith(objectsRoot + path.sep)) {
    throw new InvalidAudioObjectKeyError(`Invalid audio object key: ${objectKey}`);
  }
  return filePath;
}

export function audioMimeTypeForFilePath(filePath: string): string {
  return AUDIO_MIME_TYPES_BY_EXTENSION[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

export function serveAudio(objectsRoot = config.corpusObjectsPath): MiddlewareHandler {
  return async (context) => {
    let filePath: string;
    try {
      filePath = resolveAudioFilePath(context.req.path.slice('/api/audio/'.length), objectsRoot);
    } catch (error) {
      if (error instanceof InvalidAudioObjectKeyError || error instanceof URIError) {
        return context.json({ error: 'invalid-object-key' }, 400);
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
