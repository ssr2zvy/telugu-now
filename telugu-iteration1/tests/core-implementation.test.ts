import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after, before } from 'node:test';

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'telugu-iteration1-core-'));
process.env.DATABASE_PATH = path.join(temporaryDirectory, 'core.sqlite');
process.env.PROFILE_CODES = '001';

let db: typeof import('../server/src/db/database')['db'];
let profileService: typeof import('../server/src/services/profile-service');
let queueService: typeof import('../server/src/services/queue-service');
let preparationService: typeof import('../server/src/services/preparation-service')['preparationService'];

type ObservationStatus = 'pending' | 'preparing' | 'ready';

interface HistoryTimingRow {
  history_position: number;
  absolute_elapsed_ms: number;
  visible_elapsed_ms: number;
  finalized_at: number | null;
}

const originalDateNow = Date.now;
let now = 1_000;
Date.now = () => now;

before(async () => {
  ({ db } = await import('../server/src/db/database'));
  profileService = await import('../server/src/services/profile-service');
  queueService = await import('../server/src/services/queue-service');
  ({ preparationService } = await import('../server/src/services/preparation-service'));

  // Core tests deliberately do not exercise the temporary MockDataSource preparation.
  // Queue/history behavior is tested with explicitly seeded observation states.
  preparationService.kick = () => undefined;
});

function resetDatabase(): void {
  db.exec(`
    DELETE FROM history_entries;
    DELETE FROM queue_items;
    DELETE FROM observation_acquisitions;
    DELETE FROM observations;
    DELETE FROM profiles;
  `);
  now = 1_000;
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

test('Iteration 1 core implementation', { concurrency: false }, async (suite) => {
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

    db.prepare(`
      UPDATE observations
      SET status = 'ready', text = 'తె', prepared_at = ?
      WHERE id = ?
    `).run(now, first);

    state = profileService.getProfileState('001', false);
    assert.equal(state.canNext, true);
    assert.equal(state.nextStatus, 'ready');
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

  await suite.test('history navigation does not add timing to historical entries', () => {
    resetDatabase();
    seedQueue(['ready', 'ready', 'ready']);

    now = 1_000;
    profileService.navigateNext('001', true); // A begins.

    now = 2_000;
    profileService.navigateNext('001', true); // A finalizes; B begins.

    now = 3_000;
    profileService.navigateBack('001', true); // Show A in history mode; B visible timing pauses.

    now = 5_000;
    profileService.navigateNext('001', true); // Return to B; B visible timing resumes.

    now = 6_000;
    const state = profileService.navigateNext('001', true); // B finalizes; C begins.

    assert.equal(state.currentPosition, 2);
    assert.equal(state.historyLength, 3);

    const rows = historyTiming();
    assert.equal(rows.length, 3);

    assert.equal(rows[0]?.absolute_elapsed_ms, 1_000);
    assert.equal(rows[0]?.visible_elapsed_ms, 1_000);
    assert.equal(rows[0]?.finalized_at, 2_000);

    assert.equal(rows[1]?.absolute_elapsed_ms, 4_000);
    assert.equal(rows[1]?.visible_elapsed_ms, 2_000);
    assert.equal(rows[1]?.finalized_at, 6_000);

    assert.equal(rows[2]?.finalized_at, null);
  });

  await suite.test('walking back and forward through history neither consumes future slots nor creates replacements', () => {
    resetDatabase();
    seedQueue(['ready', 'ready', 'ready']);

    now = 1_000;
    profileService.navigateNext('001', true);
    now = 2_000;
    profileService.navigateNext('001', true);

    assert.equal(queueService.getQueueCount('001'), 3);
    assert.equal(acquisitionCount(), 5);

    now = 3_000;
    profileService.navigateBack('001', true);
    assert.equal(queueService.getQueueCount('001'), 3);
    assert.equal(acquisitionCount(), 5);

    now = 4_000;
    const state = profileService.navigateNext('001', true);
    assert.equal(state.currentPosition, 1);
    assert.equal(queueService.getQueueCount('001'), 3);
    assert.equal(acquisitionCount(), 5);
  });

  await suite.test('preserves absolute time across an unreported client absence while capping visible time at the last heartbeat', () => {
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

    now = 11_000;
    profileService.navigateNext('001', true);
    const [first] = historyTiming();
    assert.equal(first?.absolute_elapsed_ms, 10_000);
    assert.equal(first?.visible_elapsed_ms, 2_000);
  });

  await suite.test('fills to ten on load and replenishes one-for-one on first-time consumption', () => {
    resetDatabase();
    ensureProfile();

    assert.equal(queueService.ensureLaunchQueue('001'), true);
    assert.equal(queueService.getQueueCount('001'), 10);
    assert.equal(acquisitionCount(), 10);
    assert.equal(queueService.ensureLaunchQueue('001'), false);
    assert.equal(queueService.getQueueCount('001'), 10);

    const initial = db.prepare(`
      SELECT acquisition_number, trigger_kind
      FROM observation_acquisitions
      WHERE profile_code = '001'
      ORDER BY acquisition_number
    `).all() as Array<{ acquisition_number: number; trigger_kind: string }>;

    assert.deepEqual(initial.map((row) => row.acquisition_number), [1,2,3,4,5,6,7,8,9,10]);
    assert.ok(initial.every((row) => row.trigger_kind === 'initial-fill'));

    const first = db.prepare(`
      SELECT q.observation_id
      FROM queue_items q
      WHERE q.profile_code = '001'
      ORDER BY q.queue_position
      LIMIT 1
    `).get() as { observation_id: string };

    db.prepare(`
      UPDATE observations
      SET status = 'ready', text = 'తె', prepared_at = ?
      WHERE id = ?
    `).run(now, first.observation_id);

    now = 2_000;
    profileService.navigateNext('001', true);

    assert.equal(queueService.getQueueCount('001'), 10);
    assert.equal(acquisitionCount(), 11);

    const replacement = db.prepare(`
      SELECT acquisition_number, trigger_kind, trigger_observation_id,
             trigger_history_position, triggered_at,
             waiting_ahead_at_trigger, preparation_in_flight_at_trigger
      FROM observation_acquisitions
      WHERE profile_code = '001' AND acquisition_number = 11
    `).get() as {
      acquisition_number: number;
      trigger_kind: string;
      trigger_observation_id: string | null;
      trigger_history_position: number | null;
      triggered_at: number;
      waiting_ahead_at_trigger: number;
      preparation_in_flight_at_trigger: number;
    };

    assert.equal(replacement.trigger_kind, 'observation-consumed');
    assert.equal(replacement.trigger_observation_id, first.observation_id);
    assert.equal(replacement.trigger_history_position, 0);
    assert.equal(replacement.triggered_at, 2_000);
    assert.equal(replacement.preparation_in_flight_at_trigger, 0);
    assert.equal(replacement.waiting_ahead_at_trigger, 9);
  });

  await suite.test('launch loading tops a partially persisted future queue back to ten', () => {
    resetDatabase();
    ensureProfile();
    queueService.ensureLaunchQueue('001');

    const remove = db.prepare(`
      SELECT observation_id FROM queue_items
      WHERE profile_code = '001'
      ORDER BY queue_position
      LIMIT 3
    `).all() as Array<{ observation_id: string }>;

    const deleteObservation = db.prepare('DELETE FROM observations WHERE id = ?');
    db.transaction(() => {
      for (const row of remove) deleteObservation.run(row.observation_id);
    })();

    assert.equal(queueService.getQueueCount('001'), 7);
    assert.equal(queueService.ensureLaunchQueue('001'), true);
    assert.equal(queueService.getQueueCount('001'), 10);
    assert.equal(acquisitionCount(), 10);
  });
});

after(() => {
  Date.now = originalDateNow;
  db.close();
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});
