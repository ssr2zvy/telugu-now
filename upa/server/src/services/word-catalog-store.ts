import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { config } from '../config/config';
import { imageType, type WordImageRecord } from './word-image-store';

export type CatalogSource = 'generated' | 'search';

export interface CatalogEntry {
  id: string;
  root: string;
  mimeType: string;
  createdAt: number;
  /** The sentence that was on screen when the image was requested. */
  sentence: string | null;
  prompt: string | null;
  source: CatalogSource;
  /** Upstream page for searched images; null for generated ones. */
  sourceUrl: string | null;
}

interface CatalogRow {
  id: string; root: string; mime_type: string; file: string; created_at: number;
  sentence: string | null; prompt: string | null; source: string; source_url: string | null;
}

const extensions: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

/**
 * Catalog of every image ever produced for a word, shared by all users. Images
 * accumulate instead of replacing one another, and each carries the metadata
 * shown by the image view's information control.
 */
export function wordCatalogStore(database: Database.Database, directory = path.join(config.dataDirectory, 'word-images')) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS word_image_catalog (
      id TEXT PRIMARY KEY,
      root TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      file TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      sentence TEXT,
      prompt TEXT,
      source TEXT NOT NULL DEFAULT 'generated',
      source_url TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_word_image_catalog_root
      ON word_image_catalog(root, created_at);
  `);

  const folderFor = (root: string) => path.join(directory, createHash('sha256').update(root.normalize('NFC').trim()).digest('hex'));
  const toEntry = (row: CatalogRow): CatalogEntry => ({
    id: row.id,
    root: row.root,
    mimeType: row.mime_type,
    createdAt: row.created_at,
    sentence: row.sentence,
    prompt: row.prompt,
    source: row.source === 'search' ? 'search' : 'generated',
    sourceUrl: row.source_url,
  });

  return {
    list(root: string): CatalogEntry[] {
      const rows = database.prepare(
        'SELECT * FROM word_image_catalog WHERE root = ? ORDER BY created_at, id',
      ).all(root.normalize('NFC').trim()) as CatalogRow[];
      return rows.map(toEntry);
    },

    read(id: string): WordImageRecord | undefined {
      const row = database.prepare('SELECT * FROM word_image_catalog WHERE id = ?').get(id) as CatalogRow | undefined;
      if (!row) return undefined;
      const file = path.join(folderFor(row.root), row.file);
      let image: Buffer;
      try { image = fs.readFileSync(file); }
      catch { throw new Error('Could not read the saved word image.'); }
      const mime = imageType(image);
      if (!mime || mime !== row.mime_type) throw new Error('Could not read the saved word image.');
      return { mimeType: mime, image };
    },

    /** Adds an image. Identical bytes for the same word are not duplicated. */
    add(root: string, record: WordImageRecord, metadata: {
      sentence?: string | null; prompt?: string | null; source: CatalogSource; sourceUrl?: string | null;
    }): CatalogEntry {
      const normalized = root.normalize('NFC').trim();
      const digest = createHash('sha256').update(record.image).digest('hex');
      const file = `image-${digest}.${extensions[record.mimeType] ?? 'png'}`;
      const existing = database.prepare(
        'SELECT * FROM word_image_catalog WHERE root = ? AND file = ?',
      ).get(normalized, file) as CatalogRow | undefined;
      if (existing) return toEntry(existing);
      const folder = folderFor(normalized);
      fs.mkdirSync(folder, { recursive: true });
      const target = path.join(folder, file);
      if (!fs.existsSync(target)) fs.writeFileSync(target, record.image, { flag: 'wx' });
      if (!fs.readFileSync(target).equals(record.image)) throw new Error('Could not verify the saved word image.');
      const row: CatalogRow = {
        id: randomUUID(),
        root: normalized,
        mime_type: record.mimeType,
        file,
        created_at: Date.now(),
        sentence: metadata.sentence?.normalize('NFC').trim() || null,
        prompt: metadata.prompt ?? null,
        source: metadata.source,
        source_url: metadata.sourceUrl ?? null,
      };
      database.prepare(`
        INSERT INTO word_image_catalog (id, root, mime_type, file, created_at, sentence, prompt, source, source_url)
        VALUES (@id, @root, @mime_type, @file, @created_at, @sentence, @prompt, @source, @source_url)
      `).run(row);
      return toEntry(row);
    },

    /** Brings pre-catalog single images for a word into the catalog. */
    adoptLegacy(root: string, record: WordImageRecord): CatalogEntry {
      return this.add(root, record, { source: 'generated', sentence: null, prompt: null });
    },
  };
}
