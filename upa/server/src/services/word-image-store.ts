import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { config } from '../config/config';
import { MAX_IMAGE_BYTES } from './pollinations-service';
import type Database from 'better-sqlite3';

const imageFiles = { 'image/png': 'image.png', 'image/jpeg': 'image.jpg', 'image/webp': 'image.webp' } as const;
type ImageMimeType = keyof typeof imageFiles;

export interface WordImageRecord {
  mimeType: ImageMimeType;
  image: Buffer;
}

export interface WordImageMetadata {
  id: string;
  mimeType: ImageMimeType;
  createdAt: number;
  method: 'generation' | 'source';
  vendor: string;
  file: string;
  title?: string;
  sourceName?: string;
  sourceUrl?: string;
  originalUrl?: string;
  license?: 'CC BY 4.0' | 'CC BY-SA 4.0';
  licenseUrl?: string;
  batchId?: string;
  batchCreatedAt?: number;
  batchIndex?: number;
}

type WordImageDetails = Pick<WordImageMetadata, 'method' | 'vendor'>
  & Partial<Pick<WordImageMetadata, 'title' | 'sourceName' | 'sourceUrl' | 'originalUrl' | 'license' | 'licenseUrl'
    | 'batchId' | 'batchCreatedAt' | 'batchIndex'>>
  & { createdAt?: number };

export function migrateLegacyWordImages(database: Database.Database, directory = defaultWordImageDirectory()): void {
  if (!database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'word_images'").get()) return;
  const store = wordImageStore(directory);
  const records = database.prepare('SELECT root, mime_type, image, created_at FROM word_images').all() as Array<{
    root: string; mime_type: ImageMimeType; image: Buffer; created_at: number;
  }>;
  for (const record of records) {
    if (imageType(record.image) !== record.mime_type) throw new Error('Could not transfer a saved word image.');
    const current = store.save(record.root, { image: record.image, mimeType: record.mime_type }, record.created_at);
    if (!current.image.equals(record.image)) {
      store.add(record.root, { image: record.image, mimeType: record.mime_type }, {
        method: 'generation', vendor: 'Legacy', createdAt: record.created_at,
      });
    }
  }
  database.exec('DROP TABLE word_images');
}

export function defaultWordImageDirectory(): string {
  return path.join(config.dataDirectory, 'word-images');
}

export function imageType(bytes: Buffer): ImageMimeType | null {
  if (bytes.length > MAX_IMAGE_BYTES) return null;
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && bytes.toString('ascii', 12, 16) === 'IHDR') return 'image/png';
  if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 && bytes[bytes.length - 2] === 255 && bytes[bytes.length - 1] === 217) return 'image/jpeg';
  if (bytes.length >= 20 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

export function wordImageId(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function wordImageStore(directory = defaultWordImageDirectory()) {
  const imageDirectory = (root: string) => path.join(directory, createHash('sha256').update(root.normalize('NFC').trim()).digest('hex'));
  const metadata = (root: string): WordImageMetadata[] => {
    const folder = imageDirectory(root);
    try {
      fs.statSync(folder);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw new Error('Could not read the saved word image.');
    }
    try {
      const galleryPath = path.join(folder, 'gallery.json');
      if (fs.existsSync(galleryPath)) {
        if (fs.statSync(galleryPath).size > 1024 * 1024) throw new Error('Invalid gallery');
        const gallery: unknown = JSON.parse(fs.readFileSync(galleryPath, 'utf8'));
        if (!Array.isArray(gallery)) throw new Error('Invalid gallery');
        return gallery.map(value => {
          if (!value || typeof value !== 'object') throw new Error('Invalid gallery');
          const entry = value as Partial<WordImageMetadata>;
          if (typeof entry.id !== 'string' || typeof entry.createdAt !== 'number'
            || typeof entry.mimeType !== 'string' || !Object.hasOwn(imageFiles, entry.mimeType)
            || (entry.method !== 'generation' && entry.method !== 'source')
            || typeof entry.vendor !== 'string' || typeof entry.file !== 'string'
            || (entry.title !== undefined && typeof entry.title !== 'string')
            || (entry.sourceName !== undefined && typeof entry.sourceName !== 'string')
            || (entry.sourceUrl !== undefined && typeof entry.sourceUrl !== 'string')
            || (entry.originalUrl !== undefined && typeof entry.originalUrl !== 'string')
            || (entry.license !== undefined && entry.license !== 'CC BY 4.0' && entry.license !== 'CC BY-SA 4.0')
            || (entry.licenseUrl !== undefined && typeof entry.licenseUrl !== 'string')
            || (entry.batchId !== undefined && typeof entry.batchId !== 'string')
            || (entry.batchCreatedAt !== undefined && typeof entry.batchCreatedAt !== 'number')
            || (entry.batchIndex !== undefined && (!Number.isSafeInteger(entry.batchIndex) || entry.batchIndex < 0))
            || !/^image(?:-[a-f0-9]{64})?\.(?:png|jpg|webp)$/.test(entry.file)) throw new Error('Invalid gallery');
          return entry as WordImageMetadata;
        });
      }
      const metadataPath = path.join(folder, 'metadata.json');
      if (fs.statSync(metadataPath).size > 4096) throw new Error('Invalid metadata');
      const value: unknown = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
      if (!value || typeof value !== 'object' || !('root' in value) || value.root !== root.normalize('NFC').trim()
        || !('mimeType' in value) || typeof value.mimeType !== 'string' || !Object.hasOwn(imageFiles, value.mimeType)) {
        throw new Error('Invalid metadata');
      }
      const legacy = value as { mimeType: ImageMimeType; file?: unknown; createdAt?: unknown; method?: unknown; vendor?: unknown;
        title?: unknown; sourceName?: unknown; sourceUrl?: unknown; originalUrl?: unknown; license?: unknown; licenseUrl?: unknown;
        batchId?: unknown; batchCreatedAt?: unknown; batchIndex?: unknown };
      const mimeType = legacy.mimeType;
      const fileName = legacy.file ?? imageFiles[mimeType];
      if (typeof fileName !== 'string' || (fileName !== imageFiles[mimeType]
        && !new RegExp(`^image-[a-f0-9]{64}\\.${imageFiles[mimeType].split('.')[1]}$`).test(fileName))) {
        throw new Error('Invalid image file');
      }
      if ((legacy.title !== undefined && typeof legacy.title !== 'string')
        || (legacy.sourceName !== undefined && typeof legacy.sourceName !== 'string')
        || (legacy.sourceUrl !== undefined && typeof legacy.sourceUrl !== 'string')
        || (legacy.originalUrl !== undefined && typeof legacy.originalUrl !== 'string')
        || (legacy.license !== undefined && legacy.license !== 'CC BY 4.0' && legacy.license !== 'CC BY-SA 4.0')
        || (legacy.licenseUrl !== undefined && typeof legacy.licenseUrl !== 'string')
        || (legacy.batchId !== undefined && typeof legacy.batchId !== 'string')
        || (legacy.batchCreatedAt !== undefined && typeof legacy.batchCreatedAt !== 'number')
        || (legacy.batchIndex !== undefined && (!Number.isSafeInteger(legacy.batchIndex) || Number(legacy.batchIndex) < 0))) throw new Error('Invalid image source metadata');
      return [{
        id: wordImageId(fs.readFileSync(path.join(folder, fileName))),
        mimeType,
        createdAt: typeof legacy.createdAt === 'number' ? legacy.createdAt : 0,
        method: legacy.method === 'source' ? 'source' : 'generation',
        vendor: typeof legacy.vendor === 'string' ? legacy.vendor : 'Pollinations',
        file: fileName,
        ...(typeof legacy.title === 'string' ? { title: legacy.title } : {}),
        ...(typeof legacy.sourceName === 'string' ? { sourceName: legacy.sourceName } : {}),
        ...(typeof legacy.sourceUrl === 'string' ? { sourceUrl: legacy.sourceUrl } : {}),
        ...(typeof legacy.originalUrl === 'string' ? { originalUrl: legacy.originalUrl } : {}),
        ...(legacy.license === 'CC BY 4.0' || legacy.license === 'CC BY-SA 4.0' ? { license: legacy.license } : {}),
        ...(typeof legacy.licenseUrl === 'string' ? { licenseUrl: legacy.licenseUrl } : {}),
        ...(typeof legacy.batchId === 'string' ? { batchId: legacy.batchId } : {}),
        ...(typeof legacy.batchCreatedAt === 'number' ? { batchCreatedAt: legacy.batchCreatedAt } : {}),
        ...(typeof legacy.batchIndex === 'number' ? { batchIndex: legacy.batchIndex } : {}),
      }];
    } catch {
      throw new Error('Could not read the saved word image.');
    }
  };
  const get = (root: string, id?: string): WordImageRecord | undefined => {
    const folder = imageDirectory(root);
    let entries: WordImageMetadata[];
    try { entries = metadata(root); }
    catch (error) {
      if (!fs.existsSync(folder)) return undefined;
      throw error;
    }
    const entry = id ? entries.find(candidate => candidate.id === id) : entries[0];
    if (!entry) return undefined;
    try {
      const file = path.join(folder, entry.file);
      if (fs.statSync(file).size > MAX_IMAGE_BYTES) throw new Error('Oversized image');
      const image = fs.readFileSync(file);
      if (imageType(image) !== entry.mimeType) throw new Error('Invalid image');
      return { mimeType: entry.mimeType, image };
    } catch {
      throw new Error('Could not read the saved word image.');
    }
  };
  const list = (root: string): WordImageMetadata[] => {
    try { return metadata(root); }
    catch (error) {
      if (!fs.existsSync(imageDirectory(root))) return [];
      throw error;
    }
  };
  const writeGallery = (root: string, entries: WordImageMetadata[]) => {
    const folder = imageDirectory(root);
    const temporary = path.join(folder, `.gallery-${process.pid}-${randomUUID()}.json`);
    fs.writeFileSync(temporary, JSON.stringify(entries, null, 2) + '\n', { flag: 'wx' });
    try { fs.renameSync(temporary, path.join(folder, 'gallery.json')); }
    finally { fs.rmSync(temporary, { force: true }); }
  };
  const add = (root: string, record: WordImageRecord, details: WordImageDetails): WordImageRecord => {
    if (imageType(record.image) !== record.mimeType) throw new Error('Unsupported image.');
    const existing = list(root);
    if (!existing.length) return save(root, record, Date.now(), false, details);
    const id = wordImageId(record.image);
    if (existing.some(entry => entry.id === id)) return get(root, id)!;
    const folder = imageDirectory(root);
    const extension = imageFiles[record.mimeType].split('.')[1];
    const file = `image-${id}.${extension}`;
    const imagePath = path.join(folder, file);
    try { fs.writeFileSync(imagePath, record.image, { flag: 'wx' }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || !fs.readFileSync(imagePath).equals(record.image)) throw error;
    }
    const entry = { id, mimeType: record.mimeType, createdAt: details.createdAt ?? Date.now(), ...details, file };
    const insertionIndex = details.method === 'generation'
      ? existing.findIndex(image => image.method === 'source')
      : existing.findIndex(image => image.method === 'source'
        && ((image.batchCreatedAt ?? image.createdAt) > (details.batchCreatedAt ?? entry.createdAt)
          || ((image.batchCreatedAt ?? image.createdAt) === (details.batchCreatedAt ?? entry.createdAt)
            && (image.batchIndex ?? 0) > (details.batchIndex ?? 0))));
    const index = insertionIndex < 0 ? existing.length : insertionIndex;
    writeGallery(root, [...existing.slice(0, index), entry, ...existing.slice(index)]);
    return record;
  };
  const remove = (root: string, id: string): boolean => {
    const entries = list(root);
    const removed = entries.find(entry => entry.id === id);
    if (!removed) return false;
    const remaining = entries.filter(entry => entry.id !== id);
    if (remaining.length) writeGallery(root, remaining);
    else fs.rmSync(imageDirectory(root), { recursive: true, force: true });
    if (remaining.length && !remaining.some(entry => entry.file === removed.file)) fs.rmSync(path.join(imageDirectory(root), removed.file), { force: true });
    return true;
  };
  function save(root: string, record: WordImageRecord, createdAt = Date.now(), replace = false,
    details: WordImageDetails = { method: 'generation', vendor: 'Pollinations' }): WordImageRecord {
    const existing = get(root);
    if (existing && !replace) return existing;
    if (imageType(record.image) !== record.mimeType) throw new Error('Unsupported image.');
    const existingMetadata = existing ? metadata(root) : [];
    fs.mkdirSync(directory, { recursive: true });
    const temporary = fs.mkdtempSync(path.join(directory, '.pending-'));
    try {
      if (existing && replace) {
        const digest = wordImageId(record.image);
        const file = `image-${digest}.${imageFiles[record.mimeType].split('.')[1]}`;
        fs.writeFileSync(path.join(temporary, file), record.image, { flag: 'wx' });
        if (fs.existsSync(path.join(imageDirectory(root), 'gallery.json'))) {
          const target = path.join(imageDirectory(root), file);
          try { fs.renameSync(path.join(temporary, file), target); }
          catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || !fs.readFileSync(target).equals(record.image)) throw error;
          }
          writeGallery(root, [{ id: digest, mimeType: record.mimeType, createdAt, ...details, file }, ...existingMetadata.slice(1)]);
          return record;
        }
        fs.writeFileSync(path.join(temporary, 'metadata.json'), JSON.stringify({ root: root.normalize('NFC').trim(), mimeType: record.mimeType, createdAt, file, ...details }, null, 2) + '\n', { flag: 'wx' });
        fs.renameSync(path.join(temporary, file), path.join(imageDirectory(root), file));
        fs.renameSync(path.join(temporary, 'metadata.json'), path.join(imageDirectory(root), 'metadata.json'));
        return record;
      }
      fs.writeFileSync(path.join(temporary, imageFiles[record.mimeType]), record.image, { flag: 'wx' });
      fs.writeFileSync(path.join(temporary, 'metadata.json'), JSON.stringify({ root: root.normalize('NFC').trim(), mimeType: record.mimeType, createdAt, ...details }, null, 2) + '\n', { flag: 'wx' });
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
  }
  return { get, list, save, add, remove, replace: (root: string, record: WordImageRecord) => save(root, record, Date.now(), true) };
}