import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after, before } from 'node:test';
import Database from 'better-sqlite3';
import type { SelectionSnapshot } from '../shared/contracts';
import { buildStandaloneExportHtml } from '../frontend/src/export-html';
import { wavFixture } from './helpers/audio-fixture';
import { buildDiagnosticSections } from '../frontend/src/settings/diagnostic';

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'telugu-iteration2-core-'));
process.env.NODE_ENV = 'test';
process.env.DATABASE_PATH = path.join(temporaryDirectory, 'core.sqlite');
process.env.PROFILE_CODES = '001';
process.env.MOCK_DELAY_MIN_MS = '0';
process.env.MOCK_DELAY_MAX_MS = '0';
const corpusDatabasePath = path.join(temporaryDirectory, 'corpus.sqlite');
const corpusFixture = new Database(corpusDatabasePath);
corpusFixture.exec(`CREATE TABLE sources (source_id TEXT PRIMARY KEY, display_name TEXT NOT NULL, provider TEXT NOT NULL, license TEXT NOT NULL, upstream_url TEXT, catalog_version INTEGER NOT NULL, accepted_rows INTEGER NOT NULL, rejected_rows INTEGER NOT NULL, complexity_metric TEXT NOT NULL, status TEXT NOT NULL); CREATE TABLE source_rows (source_id TEXT NOT NULL, source_key TEXT NOT NULL, canonical_split TEXT NOT NULL DEFAULT 'train', upstream_split TEXT NOT NULL DEFAULT 'train', text TEXT NOT NULL, grapheme_count INTEGER NOT NULL, text_sha256 TEXT NOT NULL DEFAULT '', audio_sha256 TEXT NOT NULL, audio_object_key TEXT NOT NULL, audio_mime_type TEXT NOT NULL, duration_seconds REAL NOT NULL, source_metadata_json TEXT NOT NULL DEFAULT '{}', PRIMARY KEY(source_id, source_key)); CREATE TABLE source_complexity_members (source_id TEXT NOT NULL, grapheme_count INTEGER NOT NULL, class_index INTEGER NOT NULL, source_key TEXT NOT NULL, PRIMARY KEY(source_id, grapheme_count, class_index));`);
for (const sourceId of ['fleurs-te', 'shrutilipi-te', 'indicvoices-te']) {
  corpusFixture.prepare('INSERT INTO sources VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(sourceId, sourceId, 'test', 'CC BY 4.0', null, 1, 1, 0, 'grapheme-count', 'ready');
  corpusFixture.prepare('INSERT INTO source_rows (source_id, source_key, text, grapheme_count, audio_sha256, audio_object_key, audio_mime_type, duration_seconds) VALUES (?, ?, ?, 1, ?, ?, ?, 1)').run(sourceId, 'train:fixture', 'తె', 'sha', `media/${sourceId}/fixture.wav`, 'audio/wav');
  corpusFixture.prepare('INSERT INTO source_complexity_members VALUES (?, 1, 0, ?)').run(sourceId, 'train:fixture');
}
corpusFixture.close();
process.env.CORPUS_DATABASE_PATH = corpusDatabasePath;
process.env.CORPUS_AVAILABILITY_PATH = path.join(temporaryDirectory, 'availability.sqlite');
process.env.CORPUS_OBJECTS_PATH = path.join(temporaryDirectory, 'objects');
for (const sourceId of ['fleurs-te', 'shrutilipi-te', 'indicvoices-te']) {
  const file = path.join(process.env.CORPUS_OBJECTS_PATH, `media/${sourceId}/fixture.wav`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, wavFixture());
}

let db: typeof import('../server/src/db/database')['db'];
let profileService: typeof import('../server/src/services/profile-service');
let queueService: typeof import('../server/src/services/queue-service');
let preparationService: typeof import('../server/src/services/preparation-service')['preparationService'];
let settingsService: typeof import('../server/src/services/selection-settings-service');
let audioSettingsService: typeof import('../server/src/services/audio-settings-service');
let exportService: typeof import('../server/src/services/export-service');
let sourceRecordService: typeof import('../server/src/services/source-record-service')['sourceRecordService'];
let selectionModule: typeof import('../server/src/services/selection-engine');
let sourceRegistryModule: typeof import('../server/src/services/source-registry');
let appConfig: typeof import('../server/src/config/config')['config'];

type ObservationStatus = 'pending' | 'preparing' | 'ready';

interface HistoryTimingRow {
  history_position: number;
  absolute_elapsed_ms: number;
  visible_elapsed_ms: number;
  finalized_at: number | null;
}

const originalDateNow = Date.now;
const originalMathRandom = Math.random;
let now = 1_000;
Date.now = () => now;

before(async () => {
  const { refreshAvailability } = await import('../server/src/services/corpus-availability');
  await refreshAvailability();
  ({ db } = await import('../server/src/db/database'));
  profileService = await import('../server/src/services/profile-service');
  queueService = await import('../server/src/services/queue-service');
  ({ preparationService } = await import('../server/src/services/preparation-service'));
  settingsService = await import('../server/src/services/selection-settings-service');
  audioSettingsService = await import('../server/src/services/audio-settings-service');
  exportService = await import('../server/src/services/export-service');
  ({ sourceRecordService } = await import('../server/src/services/source-record-service'));
  selectionModule = await import('../server/src/services/selection-engine');
  sourceRegistryModule = await import('../server/src/services/source-registry');
  // The app ships no dummy sources any more; these tests still pin their exact
  // distribution, so they register the fixtures into the shared registry.
  const { DummyDataSource } = await import('./fixtures/dummy-data-source');
  const { source1Rows } = await import('./fixtures/source1');
  const { source2Rows } = await import('./fixtures/source2');
  const { source3Rows } = await import('./fixtures/source3');
  sourceRegistryModule.sourceRegistry.register(new DummyDataSource('source1', source1Rows));
  sourceRegistryModule.sourceRegistry.register(new DummyDataSource('source2', source2Rows));
  sourceRegistryModule.sourceRegistry.register(new DummyDataSource('source3', source3Rows));
  ({ config: appConfig } = await import('../server/src/config/config'));
  Object.assign(appConfig.defaultSourceWeights, { source1: 1, source2: 1, source3: 1 });

  // Core queue/history tests explicitly seed readiness. Source-record caching and export
  // are tested separately by calling their services directly.
  preparationService.kick = () => undefined;
});

function resetDatabase(): void {
  db.exec(`
    DELETE FROM history_entries;
    DELETE FROM queue_items;
    DELETE FROM observation_acquisitions;
    DELETE FROM observations;
    DELETE FROM source_records;
    DELETE FROM profile_source_weights;
    DELETE FROM profile_selection_settings;
    DELETE FROM profile_audio_settings;
    DELETE FROM profiles;
  `);
  now = 1_000;
  Math.random = originalMathRandom;
}

function ensureProfile(): void {
  profileService.getProfileState('001', false);
}

let sourceSequence = 0;
function seedQueue(
  statuses: ObservationStatus[],
  texts: string[] = [],
): string[] {
  ensureProfile();
  const ids: string[] = [];
  const insertObservation = db.prepare(`
    INSERT INTO observations (
      id, source_id, source_key, status, text, selected_at, prepared_at,
      request_started_at, request_completed_at, request_duration_ms,
      group_id, group_kind, group_size, group_position
    ) VALUES (?, 'test-source', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'launch-fill', ?, ?)
  `);
  const insertAcquisition = db.prepare(`
    INSERT INTO observation_acquisitions (
      observation_id, profile_code, acquisition_number, trigger_kind,
      trigger_observation_id, trigger_history_position, triggered_at,
      waiting_ahead_at_trigger, preparation_in_flight_at_trigger
    ) VALUES (?, '001', ?, 'initial-fill', NULL, NULL, ?, ?, 0)
  `);
  const insertQueue = db.prepare(`
    INSERT INTO queue_items (profile_code, queue_position, observation_id)
    VALUES ('001', ?, ?)
  `);

  const transaction = db.transaction(() => {
    statuses.forEach((status, index) => {
      const id = `observation-${sourceSequence}-${index}`;
      const sourceKey = `test-${sourceSequence}-${index}`;
      const text = texts[index] ?? `తె${index}`;
      const ready = status === 'ready';
      ids.push(id);
      insertObservation.run(
        id,
        sourceKey,
        status,
        ready ? text : null,
        now + index,
        ready ? now + index : null,
        ready ? now : null,
        ready ? now + index : null,
        ready ? index : null,
        `test-group-${sourceSequence}`,
        statuses.length,
        index + 1,
      );
      insertAcquisition.run(id, index + 1, now + index, index);
      insertQueue.run(index, id);
    });
  });

  transaction();
  sourceSequence += 1;
  return ids;
}

function historyTiming(): HistoryTimingRow[] {
  return db.prepare(`
    SELECT history_position, absolute_elapsed_ms, visible_elapsed_ms, finalized_at
    FROM history_entries
    WHERE profile_code = '001'
    ORDER BY history_position ASC
  `).all() as HistoryTimingRow[];
}

function acquisitionCount(): number {
  return (db.prepare(`
    SELECT COUNT(*) AS count
    FROM observation_acquisitions
    WHERE profile_code = '001'
  `).get() as { count: number }).count;
}

function historyCount(): number {
  return (db.prepare(`SELECT COUNT(*) AS count FROM history_entries WHERE profile_code = '001'`).get() as { count: number }).count;
}

function acquisitionSnapshots(): SelectionSnapshot[] {
  return (db.prepare(`
    SELECT selection_snapshot_json
    FROM observation_acquisitions
    WHERE profile_code = '001'
    ORDER BY acquisition_number
  `).all() as Array<{ selection_snapshot_json: string }>)
    .map((row) => JSON.parse(row.selection_snapshot_json) as SelectionSnapshot)
    .filter((snapshot) => typeof snapshot.sourceId === 'string');
}

const ZERO_REAL_SOURCE_WEIGHTS = {
  'fleurs-te': 0,
  'shrutilipi-te': 0,
  'indicvoices-te': 0,
} as const;
const SOURCE1_ONLY_WEIGHTS = {
  source1: 1,
  source2: 0,
  source3: 0,
  ...ZERO_REAL_SOURCE_WEIGHTS,
} as const;
const SOURCE3_ONLY_WEIGHTS = {
  source1: 0,
  source2: 0,
  source3: 1,
  ...ZERO_REAL_SOURCE_WEIGHTS,
} as const;
const DUMMY_ALL_ONES_WEIGHTS = {
  source1: 1,
  source2: 1,
  source3: 1,
  ...ZERO_REAL_SOURCE_WEIGHTS,
} as const;
const DEFAULT_SIX_SOURCE_WEIGHTS = {
  source1: 1,
  source2: 1,
  source3: 1,
  'fleurs-te': 1,
  'shrutilipi-te': 1,
  'indicvoices-te': 1,
} as const;

test('Iteration 1 invariants remain intact', { concurrency: false }, async (suite) => {
  await suite.test('rejects an unconfigured profile code', () => {
    resetDatabase();
    assert.throws(
      () => profileService.getProfileState('999', false),
      (error: unknown) => error instanceof profileService.InvalidProfileCodeError,
    );
  });

  await suite.test('keeps queue order authoritative over readiness', () => {
    resetDatabase();
    const [first] = seedQueue(['pending', 'ready']);
    let state = profileService.getProfileState('001', false);
    assert.equal(state.canNext, false);
    assert.equal(state.nextStatus, 'pending');
    assert.equal(state.queue.unseenCount, 2);
    assert.equal(state.queue.readyCount, 1);

    db.prepare(`UPDATE observations SET status = 'ready', text = 'తె', prepared_at = ?, audio_validated_at = ? WHERE id = ?`).run(now, now, first);
    state = profileService.getProfileState('001', false);
    assert.equal(state.canNext, true);
  });

  await suite.test('audio hints preserve ordered forward history and ready queue slots without consuming or exposing pending audio', context => {
    resetDatabase();
    context.mock.method(preparationService, 'checkQueue', () => {});
    const ids = seedQueue(['ready', 'ready', 'pending', 'ready', 'ready', 'ready']);
    ids.forEach((id, index) => {
      const row = db.prepare('SELECT source_key FROM observations WHERE id = ?').get(id) as { source_key: string };
      db.prepare("INSERT INTO source_records VALUES ('001', 'test-source', ?, 'తెలుగు', ?, ?)")
        .run(row.source_key, JSON.stringify([{ kind: 'audio', objectKey: `${index}.wav`, mimeType: 'audio/wav', durationSeconds: 1 }]), now);
    });
    const urls = () => profileService.getProfileState('001', false).upcomingAudio?.map(audio => audio.url);
    assert.deepEqual(urls(), [0, 1, 3].map(index => `/api/audio/${index}.wav?v=2`));
    profileService.navigateNext('001', false);
    profileService.navigateNext('001', false);
    profileService.navigateBack('001', false);
    const before = db.prepare("SELECT * FROM queue_items WHERE profile_code = '001' ORDER BY queue_position").all();
    const acquisitions = acquisitionCount();
    assert.deepEqual(urls(), [1, 3, 4].map(index => `/api/audio/${index}.wav?v=2`));
    assert.deepEqual(db.prepare("SELECT * FROM queue_items WHERE profile_code = '001' ORDER BY queue_position").all(), before);
    assert.equal(acquisitionCount(), acquisitions);
    profileService.navigateNext('001', false);
    assert.equal(profileService.getProfileState('001', false).canNext, false);
  });

  await suite.test('does not allow Back from the first history entry', () => {
    resetDatabase();
    seedQueue(['ready']);
    profileService.navigateNext('001', true);
    assert.throws(
      () => profileService.navigateBack('001', true),
      (error: unknown) => error instanceof profileService.NavigationUnavailableError,
    );
  });

  await suite.test('history navigation preserves absolute and visible timing semantics', () => {
    resetDatabase();
    seedQueue(['ready', 'ready', 'ready']);
    now = 1_000;
    profileService.navigateNext('001', true);
    now = 2_000;
    profileService.navigateNext('001', true);
    now = 3_000;
    profileService.navigateBack('001', true);
    now = 5_000;
    profileService.navigateNext('001', true);
    now = 6_000;
    profileService.navigateNext('001', true);

    const rows = historyTiming();
    assert.equal(rows[0]?.absolute_elapsed_ms, 1_000);
    assert.equal(rows[0]?.visible_elapsed_ms, 1_000);
    assert.equal(rows[1]?.absolute_elapsed_ms, 4_000);
    assert.equal(rows[1]?.visible_elapsed_ms, 2_000);
    assert.equal(rows[2]?.finalized_at, null);
  });

  await suite.test('walking through history neither consumes future slots nor creates replacements', () => {
    resetDatabase();
    seedQueue(['ready', 'ready', 'ready']);
    profileService.navigateNext('001', true);
    profileService.navigateNext('001', true);
    assert.equal(queueService.getQueueCount('001'), 3);
    assert.equal(acquisitionCount(), 5);
    profileService.navigateBack('001', true);
    profileService.navigateNext('001', true);
    assert.equal(queueService.getQueueCount('001'), 3);
    assert.equal(acquisitionCount(), 5);
  });

  await suite.test('preserves absolute time across an unreported client absence', () => {
    resetDatabase();
    seedQueue(Array.from({ length: 11 }, () => 'ready' as const));
    now = 1_000;
    profileService.navigateNext('001', true);
    now = 2_000;
    profileService.getProfileState('001', true);
    now = 10_000;
    const restored = profileService.loadProfile('001', true);
    assert.equal(restored.timing?.absoluteElapsedMs, 9_000);
    assert.equal(restored.timing?.visibleElapsedMs, 1_000);
  });

  await suite.test('fills to ten and replenishes exactly one-for-one', () => {
    resetDatabase();
    Math.random = () => 0;
    ensureProfile();
    assert.equal(queueService.ensureLaunchQueue('001'), true);
    assert.equal(queueService.getQueueCount('001'), 10);
    assert.equal(acquisitionCount(), 10);

    const first = db.prepare(`
      SELECT observation_id FROM queue_items WHERE profile_code = '001'
      ORDER BY queue_position LIMIT 1
    `).get() as { observation_id: string };
    db.prepare(`UPDATE observations SET status = 'ready', text = 'వర్షం', prepared_at = ?, audio_validated_at = ? WHERE id = ?`).run(now, now, first.observation_id);
    now = 2_000;
    profileService.navigateNext('001', true);
    assert.equal(queueService.getQueueCount('001'), 10);
    assert.equal(acquisitionCount(), 11);

    const replacement = db.prepare(`
      SELECT trigger_kind, trigger_observation_id, trigger_history_position,
             waiting_ahead_at_trigger
      FROM observation_acquisitions
      WHERE profile_code = '001' AND acquisition_number = 11
    `).get() as {
      trigger_kind: string;
      trigger_observation_id: string;
      trigger_history_position: number;
      waiting_ahead_at_trigger: number;
    };
    assert.equal(replacement.trigger_kind, 'observation-consumed');
    assert.equal(replacement.trigger_observation_id, first.observation_id);
    assert.equal(replacement.trigger_history_position, 0);
    assert.equal(replacement.waiting_ahead_at_trigger, 9);
  });

  await suite.test('counts only first displays, distinguishes same text, and restores the persisted cursor on relaunch', () => {
    resetDatabase();
    const ids = seedQueue(['ready', 'ready', 'ready'], ['తెలుగు', 'తెలుగు', 'తెలుగు']);
    const firstKey = (db.prepare('SELECT source_key FROM observations WHERE id = ?').get(ids[0]) as { source_key: string }).source_key;
    db.prepare('UPDATE observations SET source_key = ? WHERE id = ?').run(firstKey, ids[2]);
    assert.equal((db.prepare('SELECT COUNT(*) AS count FROM recording_displays').get() as { count: number }).count, 0);
    const first = profileService.navigateNext('001', true);
    assert.deepEqual(first.currentObservation!.diagnostic.repeat?.recording, {
      isRepeat: false, occurrenceCount: 1, knownOccurrenceCount: 1, previousSeenAt: null,
    });
    now = 2_000;
    const counterpart = profileService.navigateNext('001', true);
    assert.equal(counterpart.currentObservation!.diagnostic.repeat?.recording.isRepeat, false);
    assert.deepEqual(counterpart.currentObservation!.diagnostic.repeat?.sameTextOtherRecordings, {
      seenBefore: true, previousDisplayCount: 1, knownPreviousDisplayCount: 1, previousSeenAt: 1_000,
    });
    now = 3_000;
    const repeat = profileService.navigateNext('001', true);
    assert.deepEqual(repeat.currentObservation!.diagnostic.repeat?.recording, {
      isRepeat: true, occurrenceCount: 2, knownOccurrenceCount: 2, previousSeenAt: 1_000,
    });
    profileService.navigateBack('001', true);
    const resumed = profileService.loadProfile('001', true);
    assert.equal(resumed.currentObservation!.id, counterpart.currentObservation!.id);
    assert.equal(resumed.currentPosition, 1);
    const forward = profileService.navigateNext('001', true);
    assert.deepEqual(forward.currentObservation!.diagnostic.repeat, repeat.currentObservation!.diagnostic.repeat);
    assert.equal((db.prepare('SELECT SUM(occurrence_count) AS count FROM recording_displays').get() as { count: number }).count, 3);
    const rows = buildDiagnosticSections(forward, 'en')![0]!.rows;
    assert.equal(rows.find(row => row.key === 'recordingOccurrence')?.value, '2');
    assert.equal(rows.find(row => row.key === 'sameTextOtherCount')?.value, '1');
  });

  await suite.test('existing profiles get concrete counts and old history snapshots exclude future appearances', () => {
    resetDatabase();
    db.prepare("UPDATE profiles SET repeat_tracking_complete = 0 WHERE code = '001'").run();
    const ids = seedQueue(['ready', 'ready'], ['తెలుగు', 'తెలుగు']);
    const firstKey = (db.prepare('SELECT source_key FROM observations WHERE id = ?').get(ids[0]) as { source_key: string }).source_key;
    db.prepare('UPDATE observations SET source_key = ? WHERE id = ?').run(firstKey, ids[1]);
    const first = profileService.navigateNext('001', false);
    assert.equal(first.currentObservation!.diagnostic.repeat!.recording.occurrenceCount, 1);
    assert.equal(first.currentObservation!.diagnostic.repeat!.recording.isRepeat, false);
    now = 2_000;
    const second = profileService.navigateNext('001', false);
    const oldSnapshot = second.currentObservation!.diagnostic.repeat!;
    oldSnapshot.recording.occurrenceCount = null;
    oldSnapshot.recording.isRepeat = null;
    oldSnapshot.sameTextOtherRecordings.previousDisplayCount = null;
    oldSnapshot.sameTextOtherRecordings.seenBefore = null;
    db.prepare('UPDATE observations SET repeat_snapshot_json = ? WHERE id = ?').run(JSON.stringify(oldSnapshot), ids[1]);
    db.prepare('UPDATE observations SET repeat_snapshot_json = NULL WHERE id = ?').run(ids[0]);
    const historical = profileService.navigateBack('001', false);
    assert.equal(historical.currentObservation!.diagnostic.repeat!.recording.occurrenceCount, 1);
    assert.equal(historical.currentObservation!.diagnostic.repeat!.recording.previousSeenAt, null);
    const restored = profileService.navigateNext('001', false);
    assert.equal(restored.currentObservation!.diagnostic.repeat!.recording.occurrenceCount, 2);
    assert.equal(restored.currentObservation!.diagnostic.repeat!.recording.previousSeenAt, 1_000);
    const rows = buildDiagnosticSections(restored, 'en')![0]!.rows;
    assert.equal(rows.find(row => row.key === 'recordingRepeat')?.value, 'Yes');
    assert.equal(rows.find(row => row.key === 'recordingOccurrence')?.value, '2');
    assert.equal(rows.find(row => row.key === 'sameTextOtherRecordings')?.value, 'No');
    assert.equal(rows.find(row => row.key === 'sameTextOtherCount')?.value, '0');
    assert.ok(rows.every(row => !row.value.includes('Unknown')));
    assert.equal((db.prepare('SELECT SUM(occurrence_count) AS count FROM recording_displays').get() as { count: number }).count, 2);
  });

  await suite.test('repeat totals outlive pruning and navigation skips missing history positions', () => {
    resetDatabase();
    const ids = seedQueue(['ready', 'ready', 'ready', 'ready']);
    const firstKey = (db.prepare('SELECT source_key FROM observations WHERE id = ?').get(ids[0]) as { source_key: string }).source_key;
    db.prepare('UPDATE observations SET source_key = ? WHERE id = ?').run(firstKey, ids[3]);
    profileService.navigateNext('001', false);
    now = 2_000;
    profileService.navigateNext('001', false);
    now = 3_000;
    profileService.navigateNext('001', false);
    db.prepare("DELETE FROM history_entries WHERE profile_code = '001' AND history_position = 1").run();
    assert.equal(profileService.navigateBack('001', false).currentPosition, 0);
    assert.equal(profileService.navigateNext('001', false).currentPosition, 2);
    db.prepare("DELETE FROM history_entries WHERE profile_code = '001' AND history_position = 0").run();
    assert.equal(profileService.getProfileState('001', false).canBack, false);
    now = 4_000;
    const repeated = profileService.navigateNext('001', false).currentObservation!.diagnostic.repeat;
    assert.equal(repeated?.recording.occurrenceCount, 2);
    assert.equal(repeated?.recording.previousSeenAt, 1_000);
  });
});

test(
  'Iteration 3 selection, settings, repeats, cache and export',
  { concurrency: false },
  async (suite) => {
  await suite.test(
    'contains six selectable sources: three prepared catalogs plus the test fixtures',
    () => {
      resetDatabase();
      const sources =
        sourceRegistryModule.sourceRegistry
          .selectableSources();
      assert.deepEqual(
        sources.map((source) => source.id),
        [
          'fleurs-te',
          'shrutilipi-te',
          'indicvoices-te',
          'source1',
          'source2',
          'source3',
        ],
      );
      assert.deepEqual(
        sources.map((source) => source.rowCount()),
        [1, 1, 1, 12, 24, 36],
      );
      for (const source of sources) {
        const complexityRows =
          source.complexityClasses().reduce(
            (sum, item) => {
              assert.ok(item.complexityValue > 0);
              assert.ok(item.rowCount > 0);
              return sum + item.rowCount;
            },
            0,
          );
        assert.equal(
          complexityRows,
          source.rowCount(),
        );
      }
    },
  );

  await suite.test(
    'builds the complexity reference from all six test sources',
    () => {
      resetDatabase();
      const reference =
        selectionModule.selectionEngine
          .describeReference();
      assert.equal(reference.version, 3);
      assert.equal(reference.totalRows, 75);
      assert.equal(
        reference.classes[0]?.percentileStart,
        0,
      );
      assert.equal(
        reference.classes.at(-1)?.percentileEnd,
        1,
      );
      for (
        let index = 1;
        index < reference.classes.length;
        index += 1
      ) {
        assert.equal(
          reference.classes[index - 1]
            ?.percentileEnd,
          reference.classes[index]
            ?.percentileStart,
        );
      }
    },
  );

  await suite.test('rejects noncanonical source weights and persists valid profile settings', () => {
    resetDatabase();
    ensureProfile();
    assert.throws(() => settingsService.updateProfileSelectionSettings('001', {
      sourceWeights: { source1: 0.8, source2: 0.4, source3: 0.2 },
      complexityPercentileTarget: 0.5,
      complexityPercentileSpread: 0.25,
    }), settingsService.InvalidSelectionSettingsError);

    const saved =
      settingsService
        .updateProfileSelectionSettings(
          '001',
          {
            sourceWeights: {
              source1: 1,
              source2: 0.4,
              source3: 0,
              ...ZERO_REAL_SOURCE_WEIGHTS,
            },
            complexityPercentileTarget: 0.7,
            complexityPercentileSpread: 0.15,
          },
        );
    assert.deepEqual(
      saved.sourceWeights,
      {
        source1: 1,
        source2: 0.4,
        source3: 0,
        ...ZERO_REAL_SOURCE_WEIGHTS,
      },
    );
    assert.equal(saved.complexityPercentileTarget, 0.7);
    assert.equal(saved.complexityPercentileSpread, 0.15);
  });



  await suite.test(
    'persists exact Iteration 3 defaults for a new profile',
    () => {
      resetDatabase();
      ensureProfile();
      const settings =
        settingsService
          .getProfileSelectionSettings(
            '001',
          );
      assert.deepEqual(
        settings.sourceWeights,
        DEFAULT_SIX_SOURCE_WEIGHTS,
      );
      assert.equal(
        settings.complexityPercentileTarget,
        0.5,
      );
      assert.equal(
        settings.complexityPercentileSpread,
        0.25,
      );
      assert.equal(
        settings.complexityReferenceVersion,
        3,
      );
      assert.equal(settings.commonWordReduction, 2);
    },
  );

  await suite.test('persists the configured default playback rate for a new profile and exposes it in profile state', () => {
    resetDatabase();
    ensureProfile();
    const settings = audioSettingsService.getProfileAudioSettings('001');
    assert.equal(settings.playbackRate, appConfig.defaultAudioPlaybackRate);

    const state = profileService.getProfileState('001', false);
    assert.equal(state.audioSettings.playbackRate, appConfig.defaultAudioPlaybackRate);
  });

  await suite.test('updateProfileAudioSettings persists a valid playback rate and rejects out-of-range or non-finite values', () => {
    resetDatabase();
    ensureProfile();

    const minimum = audioSettingsService.updateProfileAudioSettings('001', { playbackRate: 0.1 });
    assert.equal(minimum.playbackRate, 0.1);
    const saved = audioSettingsService.updateProfileAudioSettings('001', { playbackRate: 1.5 });
    assert.equal(saved.playbackRate, 1.5);
    assert.equal(audioSettingsService.getProfileAudioSettings('001').playbackRate, 1.5);

    for (const invalid of [0.09, 1.51, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.throws(
        () => audioSettingsService.updateProfileAudioSettings('001', { playbackRate: invalid }),
        audioSettingsService.InvalidAudioSettingsError,
      );
    }
    // A rejected update leaves the previously persisted rate untouched.
    assert.equal(audioSettingsService.getProfileAudioSettings('001').playbackRate, 1.5);
  });

  await suite.test('rejects every invalid settings family, including non-finite values and incomplete source maps', () => {
    resetDatabase();
    ensureProfile();
    const valid = {
      sourceWeights: {
        source1: 1,
        source2: 0.5,
        source3: 0,
        ...ZERO_REAL_SOURCE_WEIGHTS,
      },
      complexityPercentileTarget: 0.5,
      complexityPercentileSpread: 0.25,
    };

    const invalid = [
      { ...valid, complexityPercentileTarget: -0.0001 },
      { ...valid, complexityPercentileTarget: 1.0001 },
      { ...valid, complexityPercentileTarget: Number.NaN },
      { ...valid, complexityPercentileTarget: Number.POSITIVE_INFINITY },
      { ...valid, complexityPercentileSpread: 0 },
      { ...valid, complexityPercentileSpread: -0.1 },
      { ...valid, complexityPercentileSpread: Number.NaN },
      { ...valid, complexityPercentileSpread: Number.POSITIVE_INFINITY },
      { ...valid, sourceWeights: { source1: 1, source2: 0.5, source3: 0, 'fleurs-te': 0, 'shrutilipi-te': 0 } },
      { ...valid, sourceWeights: { source1: 1, source2: 0.5, source3: 0, ...ZERO_REAL_SOURCE_WEIGHTS, source4: 0 } },
      { ...valid, sourceWeights: { source1: 1.1, source2: 0.5, source3: 0, ...ZERO_REAL_SOURCE_WEIGHTS } },
      { ...valid, sourceWeights: { source1: -0.1, source2: 1, source3: 0, ...ZERO_REAL_SOURCE_WEIGHTS } },
      { ...valid, sourceWeights: { source1: Number.NaN, source2: 1, source3: 0, ...ZERO_REAL_SOURCE_WEIGHTS } },
      { ...valid, sourceWeights: { source1: 0.8, source2: 0.4, source3: 0.2, ...ZERO_REAL_SOURCE_WEIGHTS } },
    ];

    for (const request of invalid) {
      assert.throws(
        () => settingsService.updateProfileSelectionSettings('001', request),
        settingsService.InvalidSelectionSettingsError,
      );
    }
  });

  await suite.test('source probability uses row count times profile weight and snapshots exact row probabilities', () => {
    resetDatabase();
    // The shared registry already carries the prepared catalogs plus the fixtures.
    const registry = sourceRegistryModule.sourceRegistry;
    const randoms = [0.2, 0.5, 0.5];
    const engine = new selectionModule.SelectionEngine(registry, () => randoms.shift() ?? 0.5);
    const selected = engine.select({
      sourceWeights: {
        ...DUMMY_ALL_ONES_WEIGHTS,
      },
      complexityPercentileTarget: 0.5,
      complexityPercentileSpread: 0.25,
      complexityReferenceVersion: 3,
      commonWordReduction: 0,
    });

    assert.equal(selected.sourceId, 'source2');
    assert.equal(selected.snapshot.sourceRowCount, 24);
    assert.equal(selected.snapshot.totalSourceMass, 72);
    assert.equal(selected.snapshot.sourceProbability, 24 / 72);
    assert.equal(
      selected.snapshot.rowProbabilityWithinSource,
      selected.snapshot.globalPerRowComplexityMass / selected.snapshot.selectedSourceNormalizationDenominator,
    );
    assert.equal(
      selected.snapshot.overallProbability,
      selected.snapshot.sourceProbability * selected.snapshot.rowProbabilityWithinSource,
    );
  });

  await suite.test('permits repeated source rows as distinct normal acquisitions', () => {
    resetDatabase();
    Math.random = () => 0;
    ensureProfile();
    queueService.ensureLaunchQueue('001');
    const rows = db.prepare(`
      SELECT source_id, source_key, COUNT(*) AS count
      FROM observations
      GROUP BY source_id, source_key
      ORDER BY count DESC
    `).all() as Array<{ source_id: string; source_key: string; count: number }>;
    // A zero needle always lands on the first row of the first selectable source,
    // so all ten acquisitions repeat that single row.
    const firstSource = sourceRegistryModule.sourceRegistry.selectableSources()[0]!;
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.source_id, firstSource.id);
    assert.equal(rows[0]?.count, 10);
    assert.equal(acquisitionCount(), 10);
  });

  await suite.test('settings changes leave existing queue snapshots unchanged and affect only a new replacement', () => {
    resetDatabase();
    Math.random = () => 0;
    ensureProfile();
    queueService.ensureLaunchQueue('001');
    const before = acquisitionSnapshots();
    assert.equal(before.length, 10);
    assert.ok(before.every((snapshot) => snapshot.complexityPercentileTarget === 0.5));

    settingsService.updateProfileSelectionSettings('001', {
      sourceWeights: {
        ...SOURCE1_ONLY_WEIGHTS,
      },
      complexityPercentileTarget: 0.9,
      complexityPercentileSpread: 0.1,
    });

    const first = db.prepare(`
      SELECT observation_id FROM queue_items WHERE profile_code = '001'
      ORDER BY queue_position LIMIT 1
    `).get() as { observation_id: string };
    db.prepare(`UPDATE observations SET status = 'ready', text = 'వర్షం', prepared_at = ?, audio_validated_at = ? WHERE id = ?`).run(now, now, first.observation_id);
    profileService.navigateNext('001', false);

    const after = acquisitionSnapshots();
    assert.equal(after.length, 11);
    assert.ok(after.slice(0, 10).every((snapshot) => snapshot.complexityPercentileTarget === 0.5));
    assert.equal(after[10]?.complexityPercentileTarget, 0.9);
    assert.deepEqual(
      after[10]?.sourceWeights,
      SOURCE1_ONLY_WEIGHTS,
    );
  });

  await suite.test('clearQueue removes queued observations, their acquisitions, and queue items only', () => {
    resetDatabase();
    Math.random = () => 0;
    ensureProfile();
    queueService.ensureLaunchQueue('001');
    assert.equal(queueService.getQueueCount('001'), 10);
    assert.equal(acquisitionCount(), 10);

    queueService.clearQueue('001');

    assert.equal(queueService.getQueueCount('001'), 0);
    assert.equal(acquisitionCount(), 0);
    assert.equal(
      (db.prepare(`SELECT COUNT(*) AS count FROM observations`).get() as { count: number }).count,
      0,
    );

    // Clearing an already-empty queue is a no-op, not an error.
    queueService.clearQueue('001');
    assert.equal(queueService.getQueueCount('001'), 0);
  });

  await suite.test('resetting the queue clears queued observations but keeps the currently displayed one', () => {
    resetDatabase();
    Math.random = () => 0;
    ensureProfile();
    queueService.ensureLaunchQueue('001');

    const first = db.prepare(`
      SELECT observation_id FROM queue_items WHERE profile_code = '001'
      ORDER BY queue_position LIMIT 1
    `).get() as { observation_id: string };
    db.prepare(`UPDATE observations SET status = 'ready', text = 'వర్షం', prepared_at = ?, audio_validated_at = ? WHERE id = ?`).run(now, now, first.observation_id);
    profileService.navigateNext('001', false);

    const beforeQueueIds = (db.prepare(`
      SELECT observation_id FROM queue_items WHERE profile_code = '001'
    `).all() as Array<{ observation_id: string }>).map((row) => row.observation_id);

    const state = profileService.resetQueue('001', false);

    assert.equal(state.currentObservation?.id, first.observation_id);
    assert.equal(queueService.getQueueCount('001'), 10);

    const afterQueueIds = new Set((db.prepare(`
      SELECT observation_id FROM queue_items WHERE profile_code = '001'
    `).all() as Array<{ observation_id: string }>).map((row) => row.observation_id));
    assert.ok(beforeQueueIds.every((id) => !afterQueueIds.has(id)));

    for (const id of beforeQueueIds) {
      const remaining = db.prepare(`SELECT COUNT(*) AS count FROM observations WHERE id = ?`).get(id) as { count: number };
      assert.equal(remaining.count, 0);
    }
  });

  await suite.test('currentObservation exposes no audio when no source record cache entry exists yet', () => {
    resetDatabase();
    Math.random = () => 0;
    ensureProfile();
    queueService.ensureLaunchQueue('001');
    const first = db.prepare(`
      SELECT observation_id FROM queue_items WHERE profile_code = '001'
      ORDER BY queue_position LIMIT 1
    `).get() as { observation_id: string };
    db.prepare(`UPDATE observations SET status = 'ready', text = 'వర్షం', prepared_at = ?, audio_validated_at = ? WHERE id = ?`).run(now, now, first.observation_id);
    profileService.navigateNext('001', false);

    const state = profileService.getProfileState('001', false);
    assert.equal(state.currentObservation?.id, first.observation_id);
    assert.equal(state.currentObservation?.audio, null);
  });

  await suite.test('currentObservation exposes a streamable audio URL when the resolved source record includes audio media', async () => {
    resetDatabase();
    ensureProfile();
    const resolved = await sourceRecordService.resolve('001', 'fleurs-te', 'train:fixture');
    assert.ok(resolved.media.some((item) => item.kind === 'audio'));

    db.prepare(`
      INSERT INTO observations (
        id, source_id, source_key, status, text, selected_at, prepared_at,
        group_id, group_kind, group_size, group_position
      ) VALUES ('audio-observation', 'fleurs-te', 'train:fixture', 'ready', ?, ?, ?, 'audio-test', 'launch-fill', 1, 1)
    `).run(resolved.text, now, now);
    db.prepare(`
      INSERT INTO observation_acquisitions (
        observation_id, profile_code, acquisition_number, trigger_kind,
        triggered_at, waiting_ahead_at_trigger, preparation_in_flight_at_trigger
      ) VALUES ('audio-observation', '001', 1, 'initial-fill', ?, 0, 0)
    `).run(now);
    db.prepare(`
      INSERT INTO history_entries (profile_code, history_position, observation_id, absolute_started_at)
      VALUES ('001', 0, 'audio-observation', ?)
    `).run(now);
    db.prepare(`UPDATE profiles SET current_position = 0 WHERE code = '001'`).run();

    const state = profileService.getProfileState('001', false);
    assert.equal(state.currentObservation?.audio?.mimeType, 'audio/wav');
    assert.equal(state.currentObservation?.audio?.url, '/api/audio/media/fleurs-te/fixture.wav?v=2');
    assert.ok((state.currentObservation?.audio?.durationSeconds ?? 0) > 0);
    settingsService.updateProfileSelectionSettings('001', {
      sourceWeights: { ...SOURCE1_ONLY_WEIGHTS, source1: 0, 'fleurs-te': 1 },
      complexityPercentileTarget: 0.5,
      complexityPercentileSpread: 0.25,
    });
    const exported = await exportService.generateExport('001', 2);
    assert.ok(exported.entries.every(entry => entry.sourceId === 'fleurs-te'));
    assert.deepEqual(exported.entries[0]!.audio, state.currentObservation!.audio);
    assert.deepEqual(exported.entries[1]!.audio, state.currentObservation!.audio);
  });

  await suite.test('updating settings resets the queue with the new settings while keeping the currently displayed observation', () => {
    resetDatabase();
    Math.random = () => 0;
    ensureProfile();
    queueService.ensureLaunchQueue('001');

    const first = db.prepare(`
      SELECT observation_id FROM queue_items WHERE profile_code = '001'
      ORDER BY queue_position LIMIT 1
    `).get() as { observation_id: string };
    db.prepare(`UPDATE observations SET status = 'ready', text = 'వర్షం', prepared_at = ?, audio_validated_at = ? WHERE id = ?`).run(now, now, first.observation_id);
    profileService.navigateNext('001', false);

    const settings = profileService.updateSelectionSettingsAndResetQueue('001', {
      sourceWeights: {
        ...SOURCE1_ONLY_WEIGHTS,
      },
      complexityPercentileTarget: 0.9,
      complexityPercentileSpread: 0.1,
    });
    assert.equal(settings.complexityPercentileTarget, 0.9);
    assert.deepEqual(settings.sourceWeights, SOURCE1_ONLY_WEIGHTS);

    const state = profileService.getProfileState('001', false);
    assert.equal(state.currentObservation?.id, first.observation_id);
    assert.equal(queueService.getQueueCount('001'), 10);

    const afterSnapshots = acquisitionSnapshots();
    assert.equal(afterSnapshots.length, 11);
    assert.equal(afterSnapshots[0]?.complexityPercentileTarget, 0.5);
    assert.ok(afterSnapshots.slice(1).every((snapshot) => snapshot.complexityPercentileTarget === 0.9));
    assert.deepEqual(afterSnapshots[1]?.sourceWeights, SOURCE1_ONLY_WEIGHTS);
  });

  await suite.test('profile SourceRecord cache turns a repeated resolution into a cache hit', async () => {
    resetDatabase();
    ensureProfile();
    const first = await sourceRecordService.resolve('001', 'source1', 'source1-001');
    const second = await sourceRecordService.resolve('001', 'source1', 'source1-001');
    assert.equal(first.cacheHit, false);
    assert.equal(second.cacheHit, true);
    assert.equal(first.text, second.text);
    const count = (db.prepare(`SELECT COUNT(*) AS count FROM source_records`).get() as { count: number }).count;
    assert.equal(count, 1);
  });

  await suite.test('source records and concurrent requests are isolated by profile', async () => {
    resetDatabase();
    ensureProfile();
    appConfig.profileCodes.add('002');
    profileService.ensureProfileRow('002');
    const source = sourceRegistryModule.sourceRegistry.get('source1');
    const originalPrepare = source.prepare.bind(source);
    let calls = 0;
    source.prepare = async key => { calls += 1; return originalPrepare(key); };
    try {
      const [first, second] = await Promise.all([
        sourceRecordService.resolve('001', 'source1', 'source1-004'),
        sourceRecordService.resolve('002', 'source1', 'source1-004'),
      ]);
      assert.equal(calls, 2);
      assert.equal(first.cacheHit, false);
      assert.equal(second.cacheHit, false);
      db.prepare("UPDATE source_records SET text = 'profile-specific' WHERE profile_code = '001'").run();
      assert.equal((await sourceRecordService.resolve('001', 'source1', 'source1-004')).text, 'profile-specific');
      assert.equal((await sourceRecordService.resolve('002', 'source1', 'source1-004')).text, second.text);
      await assert.rejects(sourceRecordService.resolve('999', 'source1', 'source1-004'), /Unknown cache profile/);
    } finally { source.prepare = originalPrepare; appConfig.profileCodes.delete('002'); }
  });

  await suite.test(
    'historical cached rows with empty media synthesize TextMedia',
    async () => {
      resetDatabase();
      ensureProfile();
      db.prepare(`
        INSERT INTO source_records (
          profile_code,
          source_id,
          source_key,
          text,
          media_json,
          prepared_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        '001',
        'source1',
        'historical-text-only',
        'చరిత్ర',
        '[]',
        now,
      );
      const resolved =
        await sourceRecordService.resolve(
          '001',
          'source1',
          'historical-text-only',
        );
      assert.equal(resolved.cacheHit, true);
      assert.equal(resolved.text, 'చరిత్ర');
      assert.deepEqual(
        resolved.media,
        [
          {
            kind: 'text',
            language: 'te',
            text: 'చరిత్ర',
          },
        ],
      );
    },
  );



  await suite.test('failed source resolution clears in-flight state so a later attempt can retry and cache', async () => {
    resetDatabase();
    ensureProfile();
    const source = sourceRegistryModule.sourceRegistry.get('source1');
    const originalPrepare = source.prepare.bind(source);
    let calls = 0;
    source.prepare = async (sourceKey) => {
      calls += 1;
      if (calls === 1) throw new Error('intentional first failure');
      return originalPrepare(sourceKey);
    };

    try {
      await assert.rejects(sourceRecordService.resolve('001', 'source1', 'source1-002'));
      const retried = await sourceRecordService.resolve('001', 'source1', 'source1-002');
      const cached = await sourceRecordService.resolve('001', 'source1', 'source1-002');
      assert.equal(calls, 2);
      assert.equal(retried.cacheHit, false);
      assert.equal(cached.cacheHit, true);
    } finally {
      source.prepare = originalPrepare;
    }
  });

  await suite.test('concurrent resolutions of one uncached source record coalesce to one source call', async () => {
    resetDatabase();
    ensureProfile();
    const source = sourceRegistryModule.sourceRegistry.get('source1');
    const originalPrepare = source.prepare.bind(source);
    let calls = 0;
    let release!: () => void;
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });

    source.prepare = async (sourceKey) => {
      calls += 1;
      markStarted();
      await gate;
      return originalPrepare(sourceKey);
    };

    try {
      const firstPromise = sourceRecordService.resolve('001', 'source1', 'source1-003');
      await started;
      const secondPromise = sourceRecordService.resolve('001', 'source1', 'source1-003');
      release();
      const [first, second] = await Promise.all([firstPromise, secondPromise]);
      assert.equal(calls, 1);
      assert.equal(first.text, second.text);
      assert.equal(
        (db.prepare(`SELECT COUNT(*) AS count FROM source_records`).get() as { count: number }).count,
        1,
      );
    } finally {
      source.prepare = originalPrepare;
    }
  });

  await suite.test('rejects invalid export counts before any live state changes', async () => {
    resetDatabase();
    ensureProfile();
    const before = {
      queue: queueService.getQueueCount('001'),
      acquisitions: acquisitionCount(),
      history: historyCount(),
    };

    for (const count of [0, -1, 1.5, appConfig.maxExportCount + 1]) {
      await assert.rejects(
        exportService.generateExport('001', count),
        exportService.InvalidExportRequestError,
      );
    }

    assert.equal(queueService.getQueueCount('001'), before.queue);
    assert.equal(acquisitionCount(), before.acquisitions);
    assert.equal(historyCount(), before.history);
  });

  await suite.test('export freezes one settings snapshot even if profile settings change during source retrieval', async () => {
    resetDatabase();
    ensureProfile();
    Math.random = () => 0;
    settingsService.updateProfileSelectionSettings('001', {
      sourceWeights: {
        ...SOURCE1_ONLY_WEIGHTS,
      },
      complexityPercentileTarget: 0.2,
      complexityPercentileSpread: 0.3,
    });

    const source = sourceRegistryModule.sourceRegistry.get('source1');
    const originalPrepare = source.prepare.bind(source);
    let release!: () => void;
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let first = true;

    source.prepare = async (sourceKey) => {
      if (first) {
        first = false;
        markStarted();
        await gate;
      }
      return originalPrepare(sourceKey);
    };

    try {
      const exportPromise = exportService.generateExport('001', 2);
      await started;
      settingsService.updateProfileSelectionSettings('001', {
        sourceWeights: {
          ...SOURCE3_ONLY_WEIGHTS,
        },
        complexityPercentileTarget: 0.9,
        complexityPercentileSpread: 0.1,
      });
      release();
      const exported = await exportPromise;

      assert.deepEqual(
        exported.settings.sourceWeights,
        SOURCE1_ONLY_WEIGHTS,
      );
      assert.equal(exported.settings.complexityPercentileTarget, 0.2);
      assert.equal(exported.settings.complexityPercentileSpread, 0.3);
      assert.ok(exported.entries.every((entry) => entry.sourceId === 'source1'));
      assert.ok(exported.entries.every((entry) => entry.diagnostic.selection.complexityPercentileTarget === 0.2));
      assert.ok(exported.entries.every((entry) => entry.diagnostic.selection.complexityPercentileSpread === 0.3));

      const current = settingsService.getProfileSelectionSettings('001');
      assert.deepEqual(
        current.sourceWeights,
        SOURCE3_ONLY_WEIGHTS,
      );
      assert.equal(current.complexityPercentileTarget, 0.9);
    } finally {
      release?.();
      source.prepare = originalPrepare;
    }
  });

  await suite.test('export uses one settings snapshot, generates fresh selections, warms cache and leaves live progression untouched', async () => {
    resetDatabase();
    ensureProfile();
    Math.random = () => 0;
    queueService.ensureLaunchQueue('001');
    const queueBefore = queueService.getQueueCount('001');
    const acquisitionsBefore = acquisitionCount();
    const historyBefore = historyCount();

    settingsService.updateProfileSelectionSettings('001', {
      sourceWeights: {
        ...SOURCE1_ONLY_WEIGHTS,
      },
      complexityPercentileTarget: 0.5,
      complexityPercentileSpread: 0.25,
    });
    const exported = await exportService.generateExport('001', 3);

    assert.equal(exported.entries.length, 3);
    assert.ok(exported.entries.every((entry) => entry.sourceId === 'source1'));
    assert.equal(exported.entries[0]?.diagnostic.cacheHit, false);
    assert.equal(exported.entries[1]?.diagnostic.cacheHit, true);
    assert.equal(exported.entries[2]?.diagnostic.cacheHit, true);
    assert.equal(queueService.getQueueCount('001'), queueBefore);
    assert.equal(acquisitionCount(), acquisitionsBefore);
    assert.equal(historyCount(), historyBefore);

    const cached = await sourceRecordService.resolve('001', 'source1', exported.entries[0]!.sourceKey);
    assert.equal(cached.cacheHit, true);

    const html = buildStandaloneExportHtml(exported);
    assert.match(html, /<!doctype html>/i);
    assert.ok(exported.entries.every((entry) => html.includes(entry.text)));
    assert.equal(/<script[^>]+src=/i.test(html), false);
    assert.equal(/fetch\s*\(/.test(html), false);
  });
});

after(() => {
  Date.now = originalDateNow;
  Math.random = originalMathRandom;
  db.close();
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});
