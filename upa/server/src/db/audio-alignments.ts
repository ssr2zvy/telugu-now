import type Database from 'better-sqlite3';

export function initializeAudioAlignmentSchema(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS sentence_audio_alignments (
      cache_key TEXT PRIMARY KEY,
      engine_version TEXT NOT NULL,
      audio_sha256 TEXT NOT NULL,
      transcript TEXT NOT NULL,
      result_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS word_audio_alignments (
      cache_key TEXT PRIMARY KEY,
      engine_version TEXT NOT NULL,
      audio_sha256 TEXT NOT NULL,
      word_text TEXT NOT NULL,
      sentence_start_seconds REAL NOT NULL,
      sentence_end_seconds REAL NOT NULL,
      result_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);
}
