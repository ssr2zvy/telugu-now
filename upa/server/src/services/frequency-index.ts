import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { config } from '../config/config';
import { clean_word, token_spans, TOKENIZER_VERSION } from './telugu-tokenizer';

export interface FrequencyIndexOptions {
  corpusDatabasePath: string;
  corpusFrequencyPath: string;
}

function removeStaleFrequencyIndexes(options: FrequencyIndexOptions): void {
  const directory = path.dirname(options.corpusFrequencyPath);
  if (!fs.existsSync(directory)) return;
  const prefix = `${path.basename(options.corpusFrequencyPath)}.`;
  const stagedSuffix = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.pending(?:-(?:journal|wal|shm))?$/iu;
  for (const name of fs.readdirSync(directory)) {
    if (name.startsWith(prefix) && stagedSuffix.test(name.slice(prefix.length))) {
      fs.rmSync(path.join(directory, name), { force: true });
    }
  }
}

export function frequencyIndexIdentity(options: FrequencyIndexOptions): string {
  const stat = fs.statSync(options.corpusDatabasePath);
  return JSON.stringify({
    version: 1,
    tokenizerVersion: TOKENIZER_VERSION,
    canonical: [
      path.resolve(options.corpusDatabasePath),
      stat.dev,
      stat.ino,
      stat.size,
      stat.mtimeMs,
      stat.ctimeMs,
    ],
  });
}

export function openFrequencyIndex(options: FrequencyIndexOptions = config): Database.Database | null {
  if (!fs.existsSync(options.corpusFrequencyPath)) return null;
  const database = new Database(options.corpusFrequencyPath, { readonly: true, fileMustExist: true });
  try {
    const metadata = database.prepare(
      'SELECT identity, tokenizer_version FROM metadata',
    ).get() as { identity: string; tokenizer_version: string } | undefined;
    if (metadata?.identity !== frequencyIndexIdentity(options)
      || metadata.tokenizer_version !== TOKENIZER_VERSION) {
      database.close();
      return null;
    }
    database.prepare(`
      SELECT occurrence_index, source_id, source_key, token_ordinal, start_offset,
             end_offset, original_token, normalized_word FROM occurrences LIMIT 0
    `).all();
    database.prepare('SELECT normalized_word, occurrence_count FROM frequencies LIMIT 0').all();
    database.prepare('SELECT source_id, transcript_count, occurrence_count FROM source_counts LIMIT 0').all();
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}

export function refreshFrequencyIndex(options: FrequencyIndexOptions = config): string {
  if (path.resolve(options.corpusDatabasePath) === path.resolve(options.corpusFrequencyPath)) {
    throw new Error('Canonical and frequency databases must be separate.');
  }
  const identity = frequencyIndexIdentity(options);
  fs.mkdirSync(path.dirname(options.corpusFrequencyPath), { recursive: true });
  removeStaleFrequencyIndexes(options);
  const generation = randomUUID();
  const staged = `${options.corpusFrequencyPath}.${generation}.pending`;
  const canonical = new Database(options.corpusDatabasePath, { readonly: true, fileMustExist: true });
  let snapshot: Database.Database | undefined;
  try {
    snapshot = new Database(staged);
    snapshot.pragma('journal_mode = DELETE');
    snapshot.exec(`
      CREATE TABLE metadata (
        generation TEXT NOT NULL,
        identity TEXT NOT NULL,
        tokenizer_version TEXT NOT NULL,
        corpus_fingerprint_sha256 TEXT NOT NULL,
        total_occurrences INTEGER NOT NULL
      );
      CREATE TABLE occurrences (
        occurrence_index INTEGER PRIMARY KEY,
        source_id TEXT NOT NULL,
        source_key TEXT NOT NULL,
        token_ordinal INTEGER NOT NULL,
        start_offset INTEGER NOT NULL,
        end_offset INTEGER NOT NULL,
        original_token TEXT NOT NULL,
        normalized_word TEXT NOT NULL
      );
      CREATE TABLE frequencies (
        normalized_word TEXT PRIMARY KEY,
        occurrence_count INTEGER NOT NULL
      ) WITHOUT ROWID;
      CREATE TABLE source_counts (
        source_id TEXT PRIMARY KEY,
        transcript_count INTEGER NOT NULL,
        occurrence_count INTEGER NOT NULL
      ) WITHOUT ROWID;
    `);
    const insertOccurrence = snapshot.prepare('INSERT INTO occurrences VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    const incrementFrequency = snapshot.prepare(`
      INSERT INTO frequencies VALUES (?, 1)
      ON CONFLICT(normalized_word) DO UPDATE SET occurrence_count = occurrence_count + 1
    `);
    const incrementSource = snapshot.prepare(`
      INSERT INTO source_counts VALUES (?, 1, ?)
      ON CONFLICT(source_id) DO UPDATE SET
        transcript_count = transcript_count + 1,
        occurrence_count = occurrence_count + excluded.occurrence_count
    `);
    const fingerprint = createHash('sha256');
    let totalOccurrences = 0;
    snapshot.exec('BEGIN');
    const sources = canonical.prepare(`
      SELECT source_id, catalog_version
      FROM sources WHERE status IN ('ready', 'fixture')
      ORDER BY source_id COLLATE BINARY
    `).all() as Array<{ source_id: string; catalog_version: number }>;
    for (const source of sources) {
      fingerprint.update(`${JSON.stringify([source.source_id, source.catalog_version])}\n`);
    }
    const transcripts = canonical.prepare(`
      SELECT r.source_id, r.source_key, r.text
      FROM source_rows r JOIN sources s ON s.source_id = r.source_id
      WHERE s.status IN ('ready', 'fixture')
      ORDER BY r.source_id COLLATE BINARY, r.source_key COLLATE BINARY
    `).iterate() as Iterable<{ source_id: string; source_key: string; text: string }>;
    for (const transcript of transcripts) {
      fingerprint.update(`${JSON.stringify([transcript.source_id, transcript.source_key, transcript.text])}\n`);
      let transcriptOccurrences = 0;
      const spans = token_spans(transcript.text);
      for (let tokenOrdinal = 0; tokenOrdinal < spans.length; tokenOrdinal += 1) {
        const span = spans[tokenOrdinal]!;
        const word = clean_word(span.token);
        if (word === null) continue;
        totalOccurrences += 1;
        transcriptOccurrences += 1;
        insertOccurrence.run(
          totalOccurrences, transcript.source_id, transcript.source_key, tokenOrdinal,
          span.start, span.end, span.token, word,
        );
        incrementFrequency.run(word);
      }
      incrementSource.run(transcript.source_id, transcriptOccurrences);
    }
    snapshot.prepare('INSERT INTO metadata VALUES (?, ?, ?, ?, ?)').run(
      generation, identity, TOKENIZER_VERSION, fingerprint.digest('hex'), totalOccurrences,
    );
    snapshot.exec('COMMIT');
    snapshot.exec(`
      CREATE INDEX occurrence_source ON occurrences(source_id, source_key);
      CREATE INDEX occurrence_word ON occurrences(normalized_word);
    `);
    snapshot.close();
    snapshot = undefined;
    if (identity !== frequencyIndexIdentity(options)) {
      throw new Error('Canonical corpus changed during frequency index refresh.');
    }
    const descriptor = fs.openSync(staged, 'r');
    try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
    fs.renameSync(staged, options.corpusFrequencyPath);
    const directory = fs.openSync(path.dirname(options.corpusFrequencyPath), 'r');
    try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
    return generation;
  } finally {
    snapshot?.close();
    canonical.close();
    for (const suffix of ['', '-journal', '-wal', '-shm']) fs.rmSync(staged + suffix, { force: true });
  }
}

export function ensureFrequencyIndex(
  options: FrequencyIndexOptions = config,
  rebuildIfMissing = false,
): void {
  removeStaleFrequencyIndexes(options);
  const existing = openFrequencyIndex(options);
  if (existing) {
    existing.close();
    return;
  }
  if (!rebuildIfMissing) throw new Error('CORPUS_FREQUENCY_MISSING_OR_INCOMPATIBLE');
  refreshFrequencyIndex(options);
}
