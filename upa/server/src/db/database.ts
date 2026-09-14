import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { config } from '../config/config';
import { migrateUserDatabase } from './migrate-user-database';
import { initializeEonSchema } from './eons';

if (config.databasePath === config.corpusDatabasePath) throw new Error('User and corpus databases must be separate files.');
migrateUserDatabase(config.dataDirectory, config.databasePath);
fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });

export const db = new Database(config.databasePath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

const observationTableSql = `
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
    cache_hit INTEGER CHECK (cache_hit IS NULL OR cache_hit IN (0, 1)),
    group_id TEXT NOT NULL,
    group_kind TEXT NOT NULL CHECK (group_kind IN ('launch-fill', 'rolling-replenishment')),
    group_size INTEGER NOT NULL,
    group_position INTEGER NOT NULL
  );
`;

const sourceRecordTableSql = `
  CREATE TABLE IF NOT EXISTS source_records (
    profile_code TEXT NOT NULL REFERENCES profiles(code) ON DELETE CASCADE,
    source_id TEXT NOT NULL,
    source_key TEXT NOT NULL,
    text TEXT NOT NULL,
    media_json TEXT NOT NULL DEFAULT '[]',
    prepared_at INTEGER NOT NULL,
    PRIMARY KEY (profile_code, source_id, source_key)
  );
`;

const observationOwnershipSql = `
  SELECT profile_code, observation_id FROM queue_items
  UNION SELECT profile_code, observation_id FROM history_entries
  UNION SELECT profile_code, observation_id FROM observation_acquisitions
`;

db.exec(`
  CREATE TABLE IF NOT EXISTS profiles (
    code TEXT PRIMARY KEY,
    current_position INTEGER,
    consumed_since_replenishment INTEGER NOT NULL DEFAULT 0,
    last_client_seen_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  ${observationTableSql}

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
    selection_snapshot_json TEXT NOT NULL DEFAULT '{}',
    UNIQUE (profile_code, acquisition_number),
    FOREIGN KEY (observation_id) REFERENCES observations(id) ON DELETE CASCADE,
    FOREIGN KEY (profile_code) REFERENCES profiles(code) ON DELETE CASCADE,
    FOREIGN KEY (trigger_observation_id) REFERENCES observations(id)
  );

  ${sourceRecordTableSql}

  CREATE TABLE IF NOT EXISTS profile_selection_settings (
    profile_code TEXT PRIMARY KEY,
    complexity_percentile_target REAL NOT NULL,
    complexity_percentile_spread REAL NOT NULL,
    common_word_reduction INTEGER NOT NULL DEFAULT 2,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (profile_code) REFERENCES profiles(code) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS profile_source_weights (
    profile_code TEXT NOT NULL,
    source_id TEXT NOT NULL,
    weight REAL NOT NULL,
    PRIMARY KEY (profile_code, source_id),
    FOREIGN KEY (profile_code) REFERENCES profiles(code) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS profile_audio_settings (
    profile_code TEXT PRIMARY KEY,
    playback_rate REAL NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (profile_code) REFERENCES profiles(code) ON DELETE CASCADE
  );
`);

function tableSql(table: string): string | null {
  const row = db.prepare(`
    SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?
  `).get(table) as { sql: string | null } | undefined;
  return row?.sql ?? null;
}

function columnExists(table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return rows.some((row) => row.name === column);
}

// Iteration 1 made (source_id, source_key) unique on observations. Iteration 2 permits
// repeated selections, so remove that table-level uniqueness without destroying rows.
const observationsSql = tableSql('observations') ?? '';
if (/UNIQUE\s*\(\s*source_id\s*,\s*source_key\s*\)/i.test(observationsSql)) {
  db.pragma('foreign_keys = OFF');
  try {
    db.exec(`
      BEGIN IMMEDIATE;
      CREATE TABLE observations_iteration2 (
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
        cache_hit INTEGER CHECK (cache_hit IS NULL OR cache_hit IN (0, 1)),
        group_id TEXT NOT NULL,
        group_kind TEXT NOT NULL CHECK (group_kind IN ('launch-fill', 'rolling-replenishment')),
        group_size INTEGER NOT NULL,
        group_position INTEGER NOT NULL
      );

      INSERT INTO observations_iteration2 (
        id, source_id, source_key, status, text, selected_at, prepared_at,
        request_started_at, request_completed_at, request_duration_ms, cache_hit,
        group_id, group_kind, group_size, group_position
      )
      SELECT
        id, source_id, source_key, status, text, selected_at, prepared_at,
        request_started_at, request_completed_at, request_duration_ms, NULL,
        group_id, group_kind, group_size, group_position
      FROM observations;

      DROP TABLE observations;
      ALTER TABLE observations_iteration2 RENAME TO observations;
      COMMIT;
    `);
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* no-op */ }
    throw error;
  } finally {
    db.pragma('foreign_keys = ON');
  }
}

if (!columnExists('observations', 'cache_hit')) {
  db.exec(`
    ALTER TABLE observations
    ADD COLUMN cache_hit INTEGER CHECK (cache_hit IS NULL OR cache_hit IN (0, 1));
  `);
}

for (const [column, definition] of [
  ['audio_validated_at', 'INTEGER'],
  ['preparation_attempts', 'INTEGER NOT NULL DEFAULT 0'],
  ['preparation_retry_at', 'INTEGER'],
  ['preparation_error', 'TEXT'],
  ['repeat_snapshot_json', 'TEXT'],
  ['display_kind', "TEXT NOT NULL DEFAULT 'normal'"],
  ['question_mode', 'TEXT'],
  ['question_pool', 'TEXT'],
  ['question_keyboard', 'TEXT'],
] as const) {
  if (!columnExists('observations', column)) db.exec(`ALTER TABLE observations ADD COLUMN ${column} ${definition}`);
}

if (!columnExists('profile_selection_settings', 'common_word_reduction')) {
  db.exec('ALTER TABLE profile_selection_settings ADD COLUMN common_word_reduction INTEGER NOT NULL DEFAULT 2');
}

if (!columnExists('profiles', 'repeat_tracking_complete')) {
  db.exec('ALTER TABLE profiles ADD COLUMN repeat_tracking_complete INTEGER NOT NULL DEFAULT 0');
}

if (!tableSql('recording_displays')) {
  db.transaction(() => {
    db.exec(`
      CREATE TABLE recording_displays (
        profile_code TEXT NOT NULL REFERENCES profiles(code) ON DELETE CASCADE,
        source_id TEXT NOT NULL, source_key TEXT NOT NULL, text TEXT NOT NULL,
        occurrence_count INTEGER NOT NULL, last_seen_at INTEGER NOT NULL,
        PRIMARY KEY (profile_code, source_id, source_key, text)
      ) WITHOUT ROWID;
      INSERT INTO recording_displays
        SELECT h.profile_code, o.source_id, o.source_key, o.text,
               COUNT(DISTINCT o.id), MAX(h.absolute_started_at)
        FROM history_entries h JOIN observations o ON o.id = h.observation_id
        WHERE o.text IS NOT NULL
        GROUP BY h.profile_code, o.source_id, o.source_key, o.text;
    `);
  })();
}
db.exec('CREATE INDEX IF NOT EXISTS idx_recording_displays_text ON recording_displays(profile_code, text)');

if (!columnExists('observation_acquisitions', 'selection_snapshot_json')) {
  db.exec(`
    ALTER TABLE observation_acquisitions
    ADD COLUMN selection_snapshot_json TEXT NOT NULL DEFAULT '{}';
  `);
}

if (!columnExists('source_records', 'media_json')) {
  db.exec(`
    ALTER TABLE source_records
    ADD COLUMN media_json TEXT NOT NULL DEFAULT '[]';
  `);
}

if (!columnExists('source_records', 'profile_code')) {
  db.transaction(() => {
    db.exec(`ALTER TABLE source_records RENAME TO source_records_unscoped; ${sourceRecordTableSql}`);
    db.exec(`
      INSERT OR IGNORE INTO source_records (profile_code, source_id, source_key, text, media_json, prepared_at)
      SELECT owners.profile_code, cached.source_id, cached.source_key, cached.text, cached.media_json, cached.prepared_at
      FROM (${observationOwnershipSql}) owners
      JOIN observations observation ON observation.id = owners.observation_id
      JOIN source_records_unscoped cached ON cached.source_id = observation.source_id AND cached.source_key = observation.source_key;
      DROP TABLE source_records_unscoped;
    `);
  })();
}

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_queue_profile_position
    ON queue_items(profile_code, queue_position);

  CREATE INDEX IF NOT EXISTS idx_observations_status_selected
    ON observations(status, selected_at);

  CREATE INDEX IF NOT EXISTS idx_observations_source_record
    ON observations(source_id, source_key);

  CREATE INDEX IF NOT EXISTS idx_history_profile_position
    ON history_entries(profile_code, history_position);

  CREATE INDEX IF NOT EXISTS idx_acquisitions_profile_number
    ON observation_acquisitions(profile_code, acquisition_number);

  CREATE INDEX IF NOT EXISTS idx_profile_source_weights
    ON profile_source_weights(profile_code, source_id);
`);

db.exec(`
  INSERT OR IGNORE INTO source_records (profile_code, source_id, source_key, text, media_json, prepared_at)
  SELECT owners.profile_code, observation.source_id, observation.source_key, observation.text, '[]', COALESCE(observation.prepared_at, observation.selected_at)
  FROM observations observation
  JOIN (${observationOwnershipSql}) owners ON owners.observation_id = observation.id
  WHERE observation.status = 'ready' AND observation.text IS NOT NULL;
`);

// Backfill acquisition metadata for databases created by earlier Iteration 1 builds.
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
    waiting_ahead_at_trigger, preparation_in_flight_at_trigger,
    selection_snapshot_json
  ) VALUES (?, ?, ?, ?, NULL, NULL, ?, 0, 0, '{}')
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

// A process interruption cannot leave a source request alive. Preserve the acquisition,
// but return any in-flight observation to pending so preparation can restart.
db.prepare(`
  UPDATE observations
  SET status = 'pending',
      request_started_at = NULL,
      request_completed_at = NULL,
      request_duration_ms = NULL,
      cache_hit = NULL
  WHERE status = 'preparing'
`).run();

// Ready queue entries survive restarts, but their objects may not. Recheck metadata
// (and reuse only identity-matched decode results) before exposing them as ready.
db.prepare(`
  UPDATE observations SET status = 'pending', audio_validated_at = NULL,
    preparation_attempts = 0, preparation_retry_at = NULL
  WHERE status = 'ready' AND id IN (SELECT observation_id FROM queue_items)
    AND (source_id IN ('fleurs-te', 'shrutilipi-te', 'indicvoices-te') OR EXISTS (
      SELECT 1 FROM source_records sr, json_each(sr.media_json) media
      WHERE sr.source_id = observations.source_id AND sr.source_key = observations.source_key
        AND json_extract(media.value, '$.kind') = 'audio'
    ))
`).run();

// View events begin with this version; historical acquisitions are not fabricated views.
initializeEonSchema(db);

const foreignKeyProblems = db.pragma('foreign_key_check') as unknown[];
if (foreignKeyProblems.length > 0) {
  throw new Error(`SQLite foreign-key check failed after migration: ${JSON.stringify(foreignKeyProblems)}`);
}
