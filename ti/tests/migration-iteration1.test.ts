import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';

test('upgrades the accepted Iteration 1 SQLite schema without losing live state', { concurrency: false }, async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'telugu-iteration1-migration-'));
  const databasePath = path.join(directory, 'iteration1.sqlite');
  const legacy = new Database(databasePath);

  try {
    legacy.pragma('foreign_keys = ON');
    legacy.exec(`
      CREATE TABLE profiles (
        code TEXT PRIMARY KEY,
        current_position INTEGER,
        consumed_since_replenishment INTEGER NOT NULL DEFAULT 0,
        last_client_seen_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE observations (
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

      CREATE TABLE queue_items (
        profile_code TEXT NOT NULL,
        queue_position INTEGER NOT NULL,
        observation_id TEXT NOT NULL UNIQUE,
        PRIMARY KEY (profile_code, queue_position),
        FOREIGN KEY (profile_code) REFERENCES profiles(code) ON DELETE CASCADE,
        FOREIGN KEY (observation_id) REFERENCES observations(id) ON DELETE CASCADE
      );

      CREATE TABLE history_entries (
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

      CREATE TABLE observation_acquisitions (
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

      INSERT INTO profiles (
        code, current_position, last_client_seen_at, created_at, updated_at
      ) VALUES ('001', 0, 1300, 1000, 1300);

      INSERT INTO observations (
        id, source_id, source_key, status, text, selected_at, prepared_at,
        request_started_at, request_completed_at, request_duration_ms,
        group_id, group_kind, group_size, group_position
      ) VALUES
        ('legacy-ready', 'mock', 'ready-key', 'ready', 'తెలుగు', 1000, 1100,
         1010, 1100, 90, 'launch', 'launch-fill', 1, 1),
        ('legacy-preparing', 'mock', 'preparing-key', 'preparing', NULL, 1200, NULL,
         1210, NULL, NULL, 'rolling', 'rolling-replenishment', 1, 1);

      INSERT INTO history_entries (
        profile_code, history_position, observation_id, absolute_started_at,
        absolute_elapsed_ms, visible_elapsed_ms
      ) VALUES ('001', 0, 'legacy-ready', 1100, 200, 150);

      INSERT INTO queue_items (profile_code, queue_position, observation_id)
      VALUES ('001', 1, 'legacy-preparing');

      INSERT INTO observation_acquisitions (
        observation_id, profile_code, acquisition_number, trigger_kind,
        triggered_at, waiting_ahead_at_trigger, preparation_in_flight_at_trigger
      ) VALUES ('legacy-ready', '001', 1, 'initial-fill', 1000, 0, 0);
    `);
  } finally {
    legacy.close();
  }

  process.env.DATABASE_PATH = databasePath;
  process.env.PROFILE_CODES = '001';
  process.env.MOCK_DELAY_MIN_MS = '0';
  process.env.MOCK_DELAY_MAX_MS = '0';

  const { db } = await import('../server/src/db/database');
  const settingsService = await import('../server/src/services/selection-settings-service');

  try {
    const observationColumns = db.prepare('PRAGMA table_info(observations)').all() as Array<{ name: string }>;
    assert.ok(observationColumns.some((column) => column.name === 'cache_hit'));

    const acquisitionColumns = db.prepare('PRAGMA table_info(observation_acquisitions)').all() as Array<{ name: string }>;
    assert.ok(acquisitionColumns.some((column) => column.name === 'selection_snapshot_json'));

    const observationSql = (db.prepare(`
      SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'observations'
    `).get() as { sql: string }).sql;
    assert.equal(/UNIQUE\s*\(\s*source_id\s*,\s*source_key\s*\)/i.test(observationSql), false);

    // Prove repeats are now representable at the observation/acquisition level.
    db.prepare(`
      INSERT INTO observations (
        id, source_id, source_key, status, text, selected_at, prepared_at,
        group_id, group_kind, group_size, group_position
      ) VALUES (?, 'mock', 'ready-key', 'ready', 'మళ్లీ', 1400, 1400, 'repeat', 'rolling-replenishment', 1, 1)
    `).run('repeat-observation');

    const cached = db.prepare(`
      SELECT text, media_json, prepared_at FROM source_records
      WHERE source_id = 'mock' AND source_key = 'ready-key'
    `).get() as { text: string; media_json: string; prepared_at: number } | undefined;
    assert.equal(cached?.text, 'తెలుగు');
    assert.equal(cached?.prepared_at, 1100);
    assert.equal(cached?.media_json, '[]');

    const restarted = db.prepare(`
      SELECT status, request_started_at, request_completed_at, request_duration_ms, cache_hit
      FROM observations WHERE id = 'legacy-preparing'
    `).get() as {
      status: string;
      request_started_at: number | null;
      request_completed_at: number | null;
      request_duration_ms: number | null;
      cache_hit: number | null;
    };
    assert.equal(restarted.status, 'pending');
    assert.equal(restarted.request_started_at, null);
    assert.equal(restarted.request_completed_at, null);
    assert.equal(restarted.request_duration_ms, null);
    assert.equal(restarted.cache_hit, null);

    const acquisitions = db.prepare(`
      SELECT observation_id, acquisition_number, selection_snapshot_json
      FROM observation_acquisitions
      WHERE profile_code = '001'
      ORDER BY acquisition_number
    `).all() as Array<{
      observation_id: string;
      acquisition_number: number;
      selection_snapshot_json: string;
    }>;
    assert.deepEqual(acquisitions.map((row) => [row.observation_id, row.acquisition_number, row.selection_snapshot_json]), [
      ['legacy-ready', 1, '{}'],
      ['legacy-preparing', 2, '{}'],
    ]);

    assert.equal(
      (db.prepare(`SELECT COUNT(*) AS count FROM history_entries WHERE profile_code = '001'`).get() as { count: number }).count,
      1,
    );
    assert.equal(
      (db.prepare(`SELECT COUNT(*) AS count FROM queue_items WHERE profile_code = '001'`).get() as { count: number }).count,
      1,
    );
    assert.deepEqual(db.pragma('foreign_key_check'), []);

    const settings = settingsService.getProfileSelectionSettings('001');
    assert.deepEqual(settings.sourceWeights, { source1: 1, source2: 1, source3: 1 });
    assert.equal(settings.complexityPercentileTarget, 0.5);
    assert.equal(settings.complexityPercentileSpread, 0.25);
  } finally {
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
