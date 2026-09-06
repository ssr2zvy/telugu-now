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
  process.env.DATABASE_PATH = path.join(directory, 'preparation.sqlite');
  process.env.PROFILE_CODES = '001';
  process.env.MOCK_DELAY_MIN_MS = '1';
  process.env.MOCK_DELAY_MAX_MS = '1';

  const { db } = await import('../server/src/db/database');
  const { sourceRegistry } = await import('../server/src/services/source-registry');
  const { preparationService } = await import('../server/src/services/preparation-service');
  const source = sourceRegistry.get('source1');
  const originalPrepare = source.prepare.bind(source);

  let active = 0;
  let maxActive = 0;
  const sourceCallOrder: string[] = [];
  source.prepare = async (candidate) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    sourceCallOrder.push(candidate.sourceKey);
    try {
      await new Promise<void>((resolve) => setTimeout(resolve, 4));
      return await originalPrepare(candidate);
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
  } finally {
    source.prepare = originalPrepare;
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
