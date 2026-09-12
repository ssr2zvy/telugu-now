import type Database from 'better-sqlite3';

export function initializeEonSchema(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS profile_eons (
      id TEXT PRIMARY KEY,
      profile_code TEXT NOT NULL REFERENCES profiles(code) ON DELETE CASCADE,
      name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
      started_at INTEGER NOT NULL,
      stopped_at INTEGER CHECK (stopped_at IS NULL OR stopped_at >= started_at),
      UNIQUE (profile_code, id)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_profile_eons_active
      ON profile_eons(profile_code) WHERE stopped_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_profile_eons_started
      ON profile_eons(profile_code, started_at DESC);

    CREATE TABLE IF NOT EXISTS observation_views (
      id INTEGER PRIMARY KEY,
      profile_code TEXT NOT NULL REFERENCES profiles(code) ON DELETE CASCADE,
      observation_id TEXT NOT NULL REFERENCES observations(id) ON DELETE CASCADE,
      history_position INTEGER NOT NULL,
      eon_id TEXT,
      viewed_at INTEGER NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('load', 'resume', 'back', 'forward', 'next', 'eon-start')),
      FOREIGN KEY (profile_code, eon_id) REFERENCES profile_eons(profile_code, id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_observation_views_eon
      ON observation_views(profile_code, eon_id, observation_id);
    CREATE INDEX IF NOT EXISTS idx_observation_views_time
      ON observation_views(profile_code, observation_id, viewed_at);
  `);
}
