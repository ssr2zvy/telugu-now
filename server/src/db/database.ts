import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { config } from '../config/config';

fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });

export const db = new Database(config.databasePath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

db.exec(`
  CREATE TABLE IF NOT EXISTS profiles (
    code TEXT PRIMARY KEY,
    current_position INTEGER,
    consumed_since_replenishment INTEGER NOT NULL DEFAULT 0,
    last_client_seen_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS observations (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL,
    source_key TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'preparing', 'ready')),
    text TEXT,
    selected_at INTEGER NOT NULL,
    prepared_at INTEGER,
    request_started_at INTEGER,
    request_completed_at INTEGER,
    request_duration_ms INTEGER,
    group_id TEXT NOT NULL,
    group_kind TEXT NOT NULL CHECK (group_kind IN ('launch-fill', 'rolling-replenishment')),
    group_size INTEGER NOT NULL,
    group_position INTEGER NOT NULL,
    UNIQUE (source_id, source_key)
  );

  CREATE TABLE IF NOT EXISTS queue_items (
    profile_code TEXT NOT NULL,
    queue_position INTEGER NOT NULL,
    observation_id TEXT NOT NULL UNIQUE,
    PRIMARY KEY (profile_code, queue_position),
    FOREIGN KEY (profile_code) REFERENCES profiles(code) ON DELETE CASCADE,
    FOREIGN KEY (observation_id) REFERENCES observations(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS history_entries (
    profile_code TEXT NOT NULL,
    history_position INTEGER NOT NULL,
    observation_id TEXT NOT NULL,
    presentation_state_json TEXT NOT NULL DEFAULT '{}',
    absolute_started_at INTEGER NOT NULL,
    absolute_elapsed_ms INTEGER NOT NULL DEFAULT 0,
    visible_elapsed_ms INTEGER NOT NULL DEFAULT 0,
    visible_started_at INTEGER,
    finalized_at INTEGER,
    PRIMARY KEY (profile_code, history_position),
    FOREIGN KEY (profile_code) REFERENCES profiles(code) ON DELETE CASCADE,
    FOREIGN KEY (observation_id) REFERENCES observations(id)
  );

  CREATE INDEX IF NOT EXISTS idx_queue_profile_position
    ON queue_items(profile_code, queue_position);

  CREATE INDEX IF NOT EXISTS idx_observations_status_selected
    ON observations(status, selected_at);

  CREATE INDEX IF NOT EXISTS idx_history_profile_position
    ON history_entries(profile_code, history_position);
`);

// A server interruption cannot leave an external request alive. Preserve the selection,
// but return any in-flight observation to pending so preparation can restart.
db.prepare(`
  UPDATE observations
  SET status = 'pending',
      request_started_at = NULL
  WHERE status = 'preparing'
`).run();
