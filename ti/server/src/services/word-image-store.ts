import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { MAX_IMAGE_BYTES } from './pollinations-service';

const imageFiles = { 'image/png': 'image.png', 'image/jpeg': 'image.jpg', 'image/webp': 'image.webp' } as const;
type ImageMimeType = keyof typeof imageFiles;

export interface WordImageRecord {
  mimeType: ImageMimeType;
  image: Buffer;
}

export function defaultWordImageDirectory(): string {
  let directory = path.dirname(fileURLToPath(import.meta.url));
  while (path.dirname(directory) !== directory) {
    if (fs.existsSync(path.join(directory, 'control.sh'))) return path.join(directory, 'data', 'word-images');
    directory = path.dirname(directory);
  }
  return path.resolve('../data/word-images');
}

export function imageType(bytes: Buffer): ImageMimeType | null {
  if (bytes.length > MAX_IMAGE_BYTES) return null;
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && bytes.toString('ascii', 12, 16) === 'IHDR') return 'image/png';
  if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 && bytes[bytes.length - 2] === 255 && bytes[bytes.length - 1] === 217) return 'image/jpeg';
  if (bytes.length >= 20 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

export function wordImageStore(directory = defaultWordImageDirectory()) {
  const imageDirectory = (root: string) => path.join(directory, createHash('sha256').update(root.normalize('NFC').trim()).digest('hex'));
  const get = (root: string): WordImageRecord | undefined => {
    const folder = imageDirectory(root);
    try {
      fs.statSync(folder);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw new Error('Could not read the saved word image.');
    }
    try {
      const metadataPath = path.join(folder, 'metadata.json');
      if (fs.statSync(metadataPath).size > 4096) throw new Error('Invalid metadata');
      const metadata: unknown = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
      if (!metadata || typeof metadata !== 'object' || !('root' in metadata) || metadata.root !== root.normalize('NFC').trim()
        || !('mimeType' in metadata) || typeof metadata.mimeType !== 'string' || !Object.hasOwn(imageFiles, metadata.mimeType)) {
        throw new Error('Invalid metadata');
      }
      const mimeType = metadata.mimeType as ImageMimeType;
      const file = path.join(folder, imageFiles[mimeType]);
      if (fs.statSync(file).size > MAX_IMAGE_BYTES) throw new Error('Oversized image');
      const image = fs.readFileSync(file);
      if (imageType(image) !== mimeType) throw new Error('Invalid image');
      return { mimeType, image };
    } catch {
      throw new Error('Could not read the saved word image.');
    }
  };
  const save = (root: string, record: WordImageRecord, createdAt = Date.now()): WordImageRecord => {
    const existing = get(root);
    if (existing) return existing;
    if (imageType(record.image) !== record.mimeType) throw new Error('Unsupported image.');
    fs.mkdirSync(directory, { recursive: true });
    const temporary = fs.mkdtempSync(path.join(directory, '.pending-'));
    try {
      fs.writeFileSync(path.join(temporary, imageFiles[record.mimeType]), record.image, { flag: 'wx' });
      fs.writeFileSync(path.join(temporary, 'metadata.json'), JSON.stringify({ root: root.normalize('NFC').trim(), mimeType: record.mimeType, createdAt }, null, 2) + '\n', { flag: 'wx' });
      try {
        fs.renameSync(temporary, imageDirectory(root));
      } catch (error) {
        if (!['EEXIST', 'ENOTEMPTY'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
      }
      const saved = get(root);
      if (!saved) throw new Error('Missing saved image');
      return saved;
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true });
    }
  };
  return { get, save };
}