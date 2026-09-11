import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { config } from '../config/config';
import { getCorpusObjectStore, isSafeObjectKey, type CorpusObject } from './corpus-object-store';

export interface AvailabilityOptions {
  corpusDatabasePath: string;
  corpusAvailabilityPath: string;
  corpusObjectsPath: string;
  corpusBackend: string;
  bucketName?: string | undefined;
  corpusObjectsPrefix: string;
  awsEndpointUrlS3?: string | undefined;
}

export function availabilityIdentity(options: AvailabilityOptions): string {
  const stat = fs.statSync(options.corpusDatabasePath);
  return JSON.stringify({
    version: 2,
    canonical: [path.resolve(options.corpusDatabasePath), stat.size, stat.mtimeMs],
    storage: options.corpusBackend === 'local'
      ? ['local', path.resolve(options.corpusObjectsPath)]
      : ['tigris', options.awsEndpointUrlS3 ?? '', options.bucketName, options.corpusObjectsPrefix],
  });
}

export function openAvailability(options: AvailabilityOptions): Database.Database | null {
  if (!fs.existsSync(options.corpusAvailabilityPath)) return null;
  const db = new Database(options.corpusAvailabilityPath, { readonly: true, fileMustExist: true });
  try {
    const metadata = db.prepare('SELECT identity FROM metadata').get() as { identity: string } | undefined;
    if (metadata?.identity !== availabilityIdentity(options)) {
      db.close();
      return null;
    }
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

export async function* localCorpusInventory(root: string): AsyncIterable<CorpusObject> {
  // Fail a missing/unreadable root rather than replacing a working pool with an empty one.
  const actualRoot = await fs.promises.realpath(root);
  async function* walk(directory: string, prefix = ''): AsyncIterable<CorpusObject> {
    const entries = await fs.promises.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const key = prefix + entry.name;
      if (!isSafeObjectKey(key)) continue;
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) yield* walk(file, `${key}/`);
      else if (entry.isFile() || entry.isSymbolicLink()) {
        const actual = await fs.promises.realpath(file);
        if (!actual.startsWith(actualRoot + path.sep)) continue;
        const stat = await fs.promises.stat(actual);
        if (stat.isFile()) yield { key, size: stat.size };
      }
    }
  }
  yield* walk(actualRoot);
}

export async function refreshAvailability(
  options: AvailabilityOptions = config,
  inventory: AsyncIterable<CorpusObject> = options.corpusBackend === 'local'
    ? localCorpusInventory(options.corpusObjectsPath) : getCorpusObjectStore().inventory(),
): Promise<string> {
  const identity = availabilityIdentity(options);
  if (path.resolve(options.corpusDatabasePath) === path.resolve(options.corpusAvailabilityPath)) {
    throw new Error('Canonical and availability databases must be separate.');
  }
  fs.mkdirSync(path.dirname(options.corpusAvailabilityPath), { recursive: true });
  const generation = randomUUID();
  const staged = `${options.corpusAvailabilityPath}.${generation}.pending`;
  const canonical = new Database(options.corpusDatabasePath, { readonly: true, fileMustExist: true });
  let snapshot: Database.Database | undefined;
  try {
    snapshot = new Database(staged);
    snapshot.pragma('journal_mode = DELETE');
    snapshot.exec(`
      CREATE TABLE metadata (generation TEXT NOT NULL, identity TEXT NOT NULL, pool_hash TEXT NOT NULL);
      CREATE TABLE objects (object_key TEXT PRIMARY KEY, size INTEGER NOT NULL) WITHOUT ROWID;
      CREATE TABLE eligible (
        source_id TEXT NOT NULL, source_key TEXT NOT NULL, grapheme_count INTEGER NOT NULL CHECK (grapheme_count > 0),
        PRIMARY KEY (source_id, source_key)
      ) WITHOUT ROWID;
    `);
    const insertObject = snapshot.prepare('INSERT INTO objects VALUES (?, ?)');
    snapshot.exec('BEGIN');
    for await (const object of inventory) {
      if (!isSafeObjectKey(object.key) || !Number.isSafeInteger(object.size) || object.size < 0) {
        throw new Error('Invalid corpus availability inventory.');
      }
      insertObject.run(object.key, object.size);
    }
    snapshot.exec('COMMIT');
    const available = snapshot.prepare('SELECT 1 FROM objects WHERE object_key = ? AND size > 0');
    const insert = snapshot.prepare('INSERT INTO eligible VALUES (?, ?, ?)');
    const poolHash = createHash('sha256');
    let digest = '';
    snapshot.transaction(() => {
      const rows = canonical.prepare(`
        SELECT r.source_id, r.source_key, r.grapheme_count, r.audio_object_key
        FROM source_rows r JOIN sources s ON s.source_id = r.source_id
        WHERE s.status = 'ready' AND s.complexity_metric = 'grapheme-count' AND s.accepted_rows > 0
      `).iterate() as Iterable<{ source_id: string; source_key: string; grapheme_count: number; audio_object_key: string }>;
      for (const row of rows) {
        if (available.get(row.audio_object_key)) {
          insert.run(row.source_id, row.source_key, row.grapheme_count);
          poolHash.update(JSON.stringify([row.source_id, row.source_key, row.grapheme_count]) + '\n');
        }
      }
      digest = poolHash.digest('hex');
      snapshot!.exec(`
        CREATE TABLE source_complexity_members (
          source_id TEXT NOT NULL, grapheme_count INTEGER NOT NULL,
          class_index INTEGER NOT NULL, source_key TEXT NOT NULL,
          PRIMARY KEY (source_id, grapheme_count, class_index),
          UNIQUE (source_id, source_key)
        ) WITHOUT ROWID;
        INSERT INTO source_complexity_members
          SELECT source_id, grapheme_count,
            ROW_NUMBER() OVER (PARTITION BY source_id, grapheme_count ORDER BY source_key) - 1,
            source_key FROM eligible;
        CREATE TABLE source_counts (source_id TEXT PRIMARY KEY, row_count INTEGER NOT NULL) WITHOUT ROWID;
        INSERT INTO source_counts SELECT source_id, COUNT(*) FROM eligible GROUP BY source_id;
        CREATE TABLE complexity_counts (
          source_id TEXT NOT NULL, grapheme_count INTEGER NOT NULL, row_count INTEGER NOT NULL,
          PRIMARY KEY (source_id, grapheme_count)
        ) WITHOUT ROWID;
        INSERT INTO complexity_counts
          SELECT source_id, grapheme_count, COUNT(*) FROM eligible GROUP BY source_id, grapheme_count;
        DROP TABLE eligible;
        DROP TABLE objects;
      `);
      snapshot!.prepare('INSERT INTO metadata VALUES (?, ?, ?)').run(generation, identity, digest);
    })();
    snapshot.close();
    snapshot = undefined;
    if (identity !== availabilityIdentity(options)) throw new Error('Canonical corpus changed during availability refresh.');
    const previous = openAvailability(options);
    if (previous) {
      try {
        const metadata = previous.prepare('SELECT generation, pool_hash FROM metadata').get() as { generation: string; pool_hash: string };
        if (metadata.pool_hash === digest) return metadata.generation;
      } finally { previous.close(); }
    }
    const fd = fs.openSync(staged, 'r');
    try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(staged, options.corpusAvailabilityPath);
    const directory = fs.openSync(path.dirname(options.corpusAvailabilityPath), 'r');
    try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
    return generation;
  } finally {
    snapshot?.close();
    canonical.close();
    for (const suffix of ['', '-journal', '-wal', '-shm']) fs.rmSync(staged + suffix, { force: true });
  }
}
