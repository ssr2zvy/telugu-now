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

  CREATE TABLE IF NOT EXISTS observation_acquisitions (
    observation_id TEXT PRIMARY KEY,
    profile_code TEXT NOT NULL,
    acquisition_number INTEGER NOT NULL,
    trigger_kind TEXT NOT NULL CHECK (trigger_kind IN ('initial-fill', 'observation-consumed')),
    trigger_observation_id TEXT,
    trigger_history_position INTEGER,
    triggered_at INTEGER NOT NULL,
    waiting_ahead_at_trigger INTEGER NOT NULL DEFAULT 0,
    preparation_in_flight_at_trigger INTEGER NOT NULL DEFAULT 0 CHECK (preparation_in_flight_at_trigger IN (0, 1)),
    UNIQUE (profile_code, acquisition_number),
    FOREIGN KEY (observation_id) REFERENCES observations(id) ON DELETE CASCADE,
    FOREIGN KEY (profile_code) REFERENCES profiles(code) ON DELETE CASCADE,
    FOREIGN KEY (trigger_observation_id) REFERENCES observations(id)
  );

  CREATE INDEX IF NOT EXISTS idx_queue_profile_position
    ON queue_items(profile_code, queue_position);

  CREATE INDEX IF NOT EXISTS idx_observations_status_selected
    ON observations(status, selected_at);

  CREATE INDEX IF NOT EXISTS idx_history_profile_position
    ON history_entries(profile_code, history_position);

  CREATE INDEX IF NOT EXISTS idx_acquisitions_profile_number
    ON observation_acquisitions(profile_code, acquisition_number);
`);

// Backfill acquisition metadata for databases created by earlier Iteration 1 builds.
// Existing rolling groups cannot recover their original trigger after the fact, so they
// are retained as consumption-triggered acquisitions with a null trigger observation.
const backfillProfiles = db.prepare('SELECT code FROM profiles ORDER BY code').all() as Array<{ code: string }>;
const findLegacyObservations = db.prepare(`
  SELECT o.id, o.group_kind, o.selected_at
  FROM observations o
  WHERE NOT EXISTS (
          SELECT 1 FROM observation_acquisitions a WHERE a.observation_id = o.id
        )
    AND (
      EXISTS (
        SELECT 1 FROM queue_items q
        WHERE q.observation_id = o.id AND q.profile_code = ?
      )
      OR EXISTS (
        SELECT 1 FROM history_entries h
        WHERE h.observation_id = o.id AND h.profile_code = ?
      )
    )
  ORDER BY o.selected_at ASC, o.id ASC
`);
const maxAcquisitionNumber = db.prepare(`
  SELECT COALESCE(MAX(acquisition_number), 0) AS max_number
  FROM observation_acquisitions
  WHERE profile_code = ?
`);
const insertBackfillAcquisition = db.prepare(`
  INSERT INTO observation_acquisitions (
    observation_id, profile_code, acquisition_number, trigger_kind,
    trigger_observation_id, trigger_history_position, triggered_at,
    waiting_ahead_at_trigger, preparation_in_flight_at_trigger
  ) VALUES (?, ?, ?, ?, NULL, NULL, ?, 0, 0)
`);

const backfillTransaction = db.transaction(() => {
  for (const { code } of backfillProfiles) {
    let nextNumber = (maxAcquisitionNumber.get(code) as { max_number: number }).max_number + 1;
    const rows = findLegacyObservations.all(code, code) as Array<{
      id: string;
      group_kind: 'launch-fill' | 'rolling-replenishment';
      selected_at: number;
    }>;

    for (const row of rows) {
      insertBackfillAcquisition.run(
        row.id,
        code,
        nextNumber,
        row.group_kind === 'launch-fill' ? 'initial-fill' : 'observation-consumed',
        row.selected_at,
      );
      nextNumber += 1;
    }
  }
});
backfillTransaction();

// A server interruption cannot leave an external request alive. Preserve the selection,
// but return any in-flight observation to pending so preparation can restart.
db.prepare(`
  UPDATE observations
  SET status = 'pending',
      request_started_at = NULL
  WHERE status = 'preparing'
`).run();
