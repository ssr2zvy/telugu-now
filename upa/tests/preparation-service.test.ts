import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

async function waitFor(predicate: () => boolean, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('timed out waiting for preparation');
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
}

test('live preparation is sequential, respects queue order, and reuses the shared cache', { concurrency: false }, async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'telugu-preparation-'));
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_PATH = path.join(directory, 'preparation.sqlite');
  process.env.CORPUS_AVAILABILITY_PATH = path.join(directory, 'availability.sqlite');
  process.env.CORPUS_OBJECTS_PATH = path.join(directory, 'objects');
  fs.mkdirSync(process.env.CORPUS_OBJECTS_PATH, { recursive: true });
  process.env.PROFILE_CODES = '001';
  process.env.MOCK_DELAY_MIN_MS = '1';
  process.env.MOCK_DELAY_MAX_MS = '1';

  const { db } = await import('../server/src/db/database');
  const { sourceRegistry } = await import('../server/src/services/source-registry');
  const { preparationService } = await import('../server/src/services/preparation-service');
  const { config } = await import('../server/src/config/config');
  // The app ships no dummy sources; this test needs a deterministic fixture source.
  const { DummyDataSource } = await import('./fixtures/dummy-data-source');
  const { source1Rows } = await import('./fixtures/source1');
  const { source2Rows } = await import('./fixtures/source2');
  sourceRegistry.register(new DummyDataSource('source1', source1Rows));
  sourceRegistry.register(new DummyDataSource('source2', source2Rows));
  Object.assign(config.defaultSourceWeights, { source1: 1, source2: 0 });
  const source = sourceRegistry.get('source1');
  const originalPrepare = source.prepare.bind(source);

  let active = 0;
  let maxActive = 0;
  const sourceCallOrder: string[] = [];
  source.prepare = async (sourceKey) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    sourceCallOrder.push(sourceKey);
    try {
      await new Promise<void>((resolve) => setTimeout(resolve, 4));
      return await originalPrepare(sourceKey);
    } finally {
      active -= 1;
    }
  };

  try {
    db.prepare(`
      INSERT INTO profiles (code, current_position, created_at, updated_at)
      VALUES ('001', NULL, 1, 1)
    `).run();

    const insertObservation = db.prepare(`
      INSERT INTO observations (
        id, source_id, source_key, status, selected_at,
        group_id, group_kind, group_size, group_position
      ) VALUES (?, 'source1', ?, 'pending', 100, 'test', 'launch-fill', 3, ?)
    `);
    const insertQueue = db.prepare(`
      INSERT INTO queue_items (profile_code, queue_position, observation_id)
      VALUES ('001', ?, ?)
    `);

    for (const [index, sourceKey] of ['source1-001', 'source1-002', 'source1-003'].entries()) {
      const id = `observation-${index + 1}`;
      insertObservation.run(id, sourceKey, index + 1);
      insertQueue.run(index, id);
    }

    preparationService.kick();
    await waitFor(() => {
      const row = db.prepare(`
        SELECT COUNT(*) AS count FROM observations WHERE status = 'ready'
      `).get() as { count: number };
      return row.count === 3;
    });

    assert.equal(maxActive, 1);
    assert.deepEqual(sourceCallOrder, ['source1-001', 'source1-002', 'source1-003']);

    const firstPass = db.prepare(`
      SELECT source_key, status, cache_hit, request_started_at,
             request_completed_at, request_duration_ms, text
      FROM observations
      ORDER BY group_position
    `).all() as Array<{
      source_key: string;
      status: string;
      cache_hit: number | null;
      request_started_at: number | null;
      request_completed_at: number | null;
      request_duration_ms: number | null;
      text: string | null;
    }>;
    assert.equal(firstPass.length, 3);
    assert.ok(firstPass.every((row) => row.status === 'ready' && row.cache_hit === 0));
    assert.ok(firstPass.every((row) => row.request_started_at !== null && row.request_completed_at !== null));
    assert.ok(firstPass.every((row) => row.request_duration_ms !== null && row.request_duration_ms >= 0));
    assert.ok(firstPass.every((row) => typeof row.text === 'string' && row.text.length > 0));

    // A later live observation for an already-resolved row must skip the source call.
    db.prepare(`
      INSERT INTO observations (
        id, source_id, source_key, status, selected_at,
        group_id, group_kind, group_size, group_position
      ) VALUES ('observation-repeat', 'source1', 'source1-001', 'pending', 200,
                'repeat', 'rolling-replenishment', 1, 1)
    `).run();
    db.prepare(`
      INSERT INTO queue_items (profile_code, queue_position, observation_id)
      VALUES ('001', 3, 'observation-repeat')
    `).run();

    preparationService.kick();
    await waitFor(() => {
      const row = db.prepare(`
        SELECT status FROM observations WHERE id = 'observation-repeat'
      `).get() as { status: string };
      return row.status === 'ready';
    });

    const repeated = db.prepare(`
      SELECT cache_hit, request_started_at, request_completed_at, request_duration_ms
      FROM observations WHERE id = 'observation-repeat'
    `).get() as {
      cache_hit: number;
      request_started_at: number | null;
      request_completed_at: number | null;
      request_duration_ms: number | null;
    };
    assert.equal(repeated.cache_hit, 1);
    assert.equal(repeated.request_started_at, null);
    assert.equal(repeated.request_completed_at, null);
    assert.equal(repeated.request_duration_ms, null);
    assert.deepEqual(sourceCallOrder, ['source1-001', 'source1-002', 'source1-003']);

    // A transient source failure must back off, exhaust three attempts, and stay
    // visible in state rather than spinning forever or being quarantined.
    source.prepare = async () => { throw new Error('transient fixture failure'); };
    insertObservation.run('transient', 'source1-005', 5);
    insertQueue.run(4, 'transient');
    const attempts = () => db.prepare('SELECT status, preparation_attempts, preparation_retry_at, preparation_error FROM observations WHERE id = ?')
      .get('transient') as { status: string; preparation_attempts: number; preparation_retry_at: number | null; preparation_error: string | null };
    preparationService.kick();
    await waitFor(() => attempts().preparation_error !== null);
    assert.equal(attempts().preparation_attempts, 1);
    assert.ok(attempts().preparation_retry_at! > Date.now());
    for (let n = 0; n < 10; n++) preparationService.kick();
    assert.equal(attempts().preparation_attempts, 1);
    for (const expected of [2, 3]) {
      db.prepare("UPDATE observations SET preparation_retry_at = 0 WHERE id = 'transient'").run();
      preparationService.kick();
      await waitFor(() => attempts().status === 'pending' && attempts().preparation_attempts === expected);
    }
    assert.equal(attempts().preparation_retry_at, null);
    preparationService.kick();
    assert.equal(attempts().preparation_attempts, 3);
    const profile = await import('../server/src/services/profile-service');
    assert.deepEqual(profile.getProfileState('001', false).queue.preparationError, {
      code: 'source-preparation-unavailable', attempts: 3, retryAt: null,
    });
    source.prepare = originalPrepare;

    db.exec('DELETE FROM queue_items; DELETE FROM observations;');
    const { updateProfileSelectionSettings } = await import('../server/src/services/selection-settings-service');
    updateProfileSelectionSettings('001', {
      sourceWeights: { source1: 0, source2: 1 },
      complexityPercentileTarget: 0.5, complexityPercentileSpread: 0.25,
    });
    const badMedia = JSON.stringify([{ kind: 'audio', objectKey: 'missing.wav', mimeType: 'audio/wav', durationSeconds: 1, sha256: '' }]);
    db.prepare("INSERT INTO source_records VALUES ('001', 'source1', 'bad-audio', 'తెలుగు', ?, 1)").run(badMedia);
    const seedLegacyAudio = (id: string, acquisition: number, position: number, validated: number | null) => {
      insertObservation.run(id, 'bad-audio', 1);
      db.prepare("UPDATE observations SET status = 'ready', text = 'తెలుగు', audio_validated_at = ? WHERE id = ?").run(validated, id);
      insertQueue.run(position, id);
      db.prepare(`
        INSERT INTO observation_acquisitions (observation_id, profile_code, acquisition_number, trigger_kind, triggered_at)
        VALUES (?, '001', ?, 'initial-fill', 100)
      `).run(id, acquisition);
    };
    seedLegacyAudio('legacy-bad', 1, 0, null);
    assert.equal(profile.getProfileState('001', false).canNext, false, 'legacy ready audio is not admitted before validation');
    assert.throws(() => profile.navigateNext('001', false), /not ready/);
    const replacement = (position: number) => db.prepare(`
      SELECT o.id, o.status, o.source_id, a.acquisition_number FROM queue_items q
      JOIN observations o ON o.id = q.observation_id JOIN observation_acquisitions a ON a.observation_id = o.id
      WHERE q.profile_code = '001' AND q.queue_position = ?
    `).get(position) as { id: string; status: string; source_id: string; acquisition_number: number };
    await waitFor(() => replacement(0)?.status === 'ready');
    assert.notEqual(replacement(0).id, 'legacy-bad');
    assert.equal(replacement(0).source_id, 'source2');
    assert.equal(replacement(0).acquisition_number, 1, 'rejects do not create phantom acquisitions');
    assert.equal(db.prepare("SELECT 1 FROM observations WHERE id = 'legacy-bad'").get(), undefined);
    const { audioValidationStore } = await import('../server/src/services/audio-validation-store');
    assert.equal(audioValidationStore.invalidReason('missing.wav'), 'audio-not-found');
    seedLegacyAudio('already-ready-bad', 2, 1, 100);
    preparationService.kick();
    await waitFor(() => replacement(1)?.status === 'ready' && replacement(1)?.id !== 'already-ready-bad');
    assert.equal(replacement(1).source_id, 'source2');
    assert.equal(replacement(1).acquisition_number, 2);
    assert.equal((db.prepare('SELECT COUNT(*) AS count FROM recording_displays').get() as { count: number }).count, 0);
    assert.deepEqual(db.pragma('foreign_key_check'), []);
    audioValidationStore.close();
  } finally {
    source.prepare = originalPrepare;
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
