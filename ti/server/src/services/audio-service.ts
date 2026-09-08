import path from 'node:path';
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
