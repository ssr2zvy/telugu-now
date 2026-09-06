import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after, before } from 'node:test';
import type { SelectionSnapshot } from '../shared/contracts';
import { buildStandaloneExportHtml } from '../frontend/src/export-html';

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'telugu-iteration2-core-'));
process.env.DATABASE_PATH = path.join(temporaryDirectory, 'core.sqlite');
process.env.PROFILE_CODES = '001';
process.env.MOCK_DELAY_MIN_MS = '0';
process.env.MOCK_DELAY_MAX_MS = '0';

let db: typeof import('../server/src/db/database')['db'];
let profileService: typeof import('../server/src/services/profile-service');
let queueService: typeof import('../server/src/services/queue-service');
let preparationService: typeof import('../server/src/services/preparation-service')['preparationService'];
let settingsService: typeof import('../server/src/services/selection-settings-service');
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
  ({ db } = await import('../server/src/db/database'));
  profileService = await import('../server/src/services/profile-service');
  queueService = await import('../server/src/services/queue-service');
  ({ preparationService } = await import('../server/src/services/preparation-service'));
  settingsService = await import('../server/src/services/selection-settings-service');
  exportService = await import('../server/src/services/export-service');
  ({ sourceRecordService } = await import('../server/src/services/source-record-service'));
  selectionModule = await import('../server/src/services/selection-engine');
  sourceRegistryModule = await import('../server/src/services/source-registry');
  ({ config: appConfig } = await import('../server/src/config/config'));

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

    db.prepare(`UPDATE observations SET status = 'ready', text = 'తె', prepared_at = ? WHERE id = ?`).run(now, first);
    state = profileService.getProfileState('001', false);
    assert.equal(state.canNext, true);
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
    db.prepare(`UPDATE observations SET status = 'ready', text = 'వర్షం', prepared_at = ? WHERE id = ?`).run(now, first.observation_id);
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
});

test('Iteration 2 selection, settings, repeats, cache and export', { concurrency: false }, async (suite) => {
  await suite.test('contains exactly three selectable deterministic catalogs of 12, 24 and 36 rows', () => {
    resetDatabase();
    const sources = sourceRegistryModule.sourceRegistry.selectableSources();
    assert.deepEqual(sources.map((source) => source.id), ['source1', 'source2', 'source3']);
    assert.deepEqual(sources.map((source) => source.catalog().length), [12, 24, 36]);
    for (const source of sources) {
      assert.ok(source.catalog().every((row) => row.wordCount > 0));
      assert.equal(new Set(source.catalog().map((row) => row.sourceKey)).size, source.catalog().length);
    }
  });

  await suite.test('builds one global percentile reference from all 72 rows', () => {
    resetDatabase();
    const reference = selectionModule.selectionEngine.describeReference();
    assert.equal(reference.version, 1);
    assert.equal(reference.totalRows, 72);
    assert.equal(reference.classes[0]?.percentileStart, 0);
    assert.equal(reference.classes.at(-1)?.percentileEnd, 1);
    for (let index = 1; index < reference.classes.length; index += 1) {
      assert.equal(reference.classes[index - 1]?.percentileEnd, reference.classes[index]?.percentileStart);
    }
  });

  await suite.test('rejects noncanonical source weights and persists valid profile settings', () => {
    resetDatabase();
    ensureProfile();
    assert.throws(() => settingsService.updateProfileSelectionSettings('001', {
      sourceWeights: { source1: 0.8, source2: 0.4, source3: 0.2 },
      complexityPercentileTarget: 0.5,
      complexityPercentileSpread: 0.25,
    }), settingsService.InvalidSelectionSettingsError);

    const saved = settingsService.updateProfileSelectionSettings('001', {
      sourceWeights: { source1: 1, source2: 0.4, source3: 0 },
      complexityPercentileTarget: 0.7,
      complexityPercentileSpread: 0.15,
    });
    assert.deepEqual(saved.sourceWeights, { source1: 1, source2: 0.4, source3: 0 });
    assert.equal(saved.complexityPercentileTarget, 0.7);
    assert.equal(saved.complexityPercentileSpread, 0.15);
  });



  await suite.test('persists exact Iteration 2 defaults for a new profile', () => {
    resetDatabase();
    ensureProfile();
    const settings = settingsService.getProfileSelectionSettings('001');
    assert.deepEqual(settings.sourceWeights, { source1: 1, source2: 1, source3: 1 });
    assert.equal(settings.complexityPercentileTarget, 0.5);
    assert.equal(settings.complexityPercentileSpread, 0.25);
    assert.equal(settings.complexityReferenceVersion, 1);
  });

  await suite.test('rejects every invalid settings family, including non-finite values and incomplete source maps', () => {
    resetDatabase();
    ensureProfile();
    const valid = {
      sourceWeights: { source1: 1, source2: 0.5, source3: 0 },
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
      { ...valid, sourceWeights: { source1: 1, source2: 0.5 } },
      { ...valid, sourceWeights: { source1: 1, source2: 0.5, source3: 0, source4: 0 } },
      { ...valid, sourceWeights: { source1: 1.1, source2: 0.5, source3: 0 } },
      { ...valid, sourceWeights: { source1: -0.1, source2: 1, source3: 0 } },
      { ...valid, sourceWeights: { source1: Number.NaN, source2: 1, source3: 0 } },
      { ...valid, sourceWeights: { source1: 0.8, source2: 0.4, source3: 0.2 } },
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
    const registry = new sourceRegistryModule.SourceRegistry();
    const randoms = [0.2, 0.5, 0.5];
    const engine = new selectionModule.SelectionEngine(registry, () => randoms.shift() ?? 0.5);
    const selected = engine.select({
      sourceWeights: { source1: 1, source2: 1, source3: 1 },
      complexityPercentileTarget: 0.5,
      complexityPercentileSpread: 0.25,
      complexityReferenceVersion: 1,
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
    assert.equal(rows[0]?.source_id, 'source1');
    assert.equal(rows[0]?.source_key, 'source1-001');
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
      sourceWeights: { source1: 1, source2: 0, source3: 0 },
      complexityPercentileTarget: 0.9,
      complexityPercentileSpread: 0.1,
    });

    const first = db.prepare(`
      SELECT observation_id FROM queue_items WHERE profile_code = '001'
      ORDER BY queue_position LIMIT 1
    `).get() as { observation_id: string };
    db.prepare(`UPDATE observations SET status = 'ready', text = 'వర్షం', prepared_at = ? WHERE id = ?`).run(now, first.observation_id);
    profileService.navigateNext('001', false);

    const after = acquisitionSnapshots();
    assert.equal(after.length, 11);
    assert.ok(after.slice(0, 10).every((snapshot) => snapshot.complexityPercentileTarget === 0.5));
    assert.equal(after[10]?.complexityPercentileTarget, 0.9);
    assert.deepEqual(after[10]?.sourceWeights, { source1: 1, source2: 0, source3: 0 });
  });

  await suite.test('shared SourceRecord cache turns a repeated resolution into a cache hit', async () => {
    resetDatabase();
    const first = await sourceRecordService.resolve('source1', 'source1-001');
    const second = await sourceRecordService.resolve('source1', 'source1-001');
    assert.equal(first.cacheHit, false);
    assert.equal(second.cacheHit, true);
    assert.equal(first.text, second.text);
    const count = (db.prepare(`SELECT COUNT(*) AS count FROM source_records`).get() as { count: number }).count;
    assert.equal(count, 1);
  });



  await suite.test('failed source resolution clears in-flight state so a later attempt can retry and cache', async () => {
    resetDatabase();
    const source = sourceRegistryModule.sourceRegistry.get('source1');
    const originalPrepare = source.prepare.bind(source);
    let calls = 0;
    source.prepare = async (candidate) => {
      calls += 1;
      if (calls === 1) throw new Error('intentional first failure');
      return originalPrepare(candidate);
    };

    try {
      await assert.rejects(sourceRecordService.resolve('source1', 'source1-002'));
      const retried = await sourceRecordService.resolve('source1', 'source1-002');
      const cached = await sourceRecordService.resolve('source1', 'source1-002');
      assert.equal(calls, 2);
      assert.equal(retried.cacheHit, false);
      assert.equal(cached.cacheHit, true);
    } finally {
      source.prepare = originalPrepare;
    }
  });

  await suite.test('concurrent resolutions of one uncached source record coalesce to one source call', async () => {
    resetDatabase();
    const source = sourceRegistryModule.sourceRegistry.get('source1');
    const originalPrepare = source.prepare.bind(source);
    let calls = 0;
    let release!: () => void;
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });

    source.prepare = async (candidate) => {
      calls += 1;
      markStarted();
      await gate;
      return originalPrepare(candidate);
    };

    try {
      const firstPromise = sourceRecordService.resolve('source1', 'source1-003');
      await started;
      const secondPromise = sourceRecordService.resolve('source1', 'source1-003');
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
      sourceWeights: { source1: 1, source2: 0, source3: 0 },
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

    source.prepare = async (candidate) => {
      if (first) {
        first = false;
        markStarted();
        await gate;
      }
      return originalPrepare(candidate);
    };

    try {
      const exportPromise = exportService.generateExport('001', 2);
      await started;
      settingsService.updateProfileSelectionSettings('001', {
        sourceWeights: { source1: 0, source2: 0, source3: 1 },
        complexityPercentileTarget: 0.9,
        complexityPercentileSpread: 0.1,
      });
      release();
      const exported = await exportPromise;

      assert.deepEqual(exported.settings.sourceWeights, { source1: 1, source2: 0, source3: 0 });
      assert.equal(exported.settings.complexityPercentileTarget, 0.2);
      assert.equal(exported.settings.complexityPercentileSpread, 0.3);
      assert.ok(exported.entries.every((entry) => entry.sourceId === 'source1'));
      assert.ok(exported.entries.every((entry) => entry.diagnostic.selection.complexityPercentileTarget === 0.2));
      assert.ok(exported.entries.every((entry) => entry.diagnostic.selection.complexityPercentileSpread === 0.3));

      const current = settingsService.getProfileSelectionSettings('001');
      assert.deepEqual(current.sourceWeights, { source1: 0, source2: 0, source3: 1 });
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
      sourceWeights: { source1: 1, source2: 0, source3: 0 },
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

    const cached = await sourceRecordService.resolve('source1', exported.entries[0]!.sourceKey);
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
