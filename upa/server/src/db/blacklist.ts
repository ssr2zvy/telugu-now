import type Database from 'better-sqlite3';

export function initializeBlacklistSchema(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS profile_blacklisted_sentences (
      profile_code TEXT NOT NULL REFERENCES profiles(code) ON DELETE CASCADE,
      text TEXT NOT NULL CHECK (length(text) BETWEEN 1 AND 4000),
      created_at INTEGER NOT NULL,
      PRIMARY KEY (profile_code, text)
    );
    CREATE INDEX IF NOT EXISTS idx_profile_blacklisted_sentences_created
      ON profile_blacklisted_sentences(profile_code, created_at DESC);
  `);
}
