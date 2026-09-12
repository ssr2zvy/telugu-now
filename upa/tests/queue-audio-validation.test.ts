import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import Database from 'better-sqlite3';
import { wavFixture } from './helpers/audio-fixture';

test('real corpus quarantine replaces reservations, survives restart and rechecks browser resume without replaying history', {
  skip: spawnSync('ffmpeg', ['-version']).status === 0 ? false : 'ffmpeg is required for actual decoding',
}, async () => {
  const directory = path.resolve('test-results', `queue-audio-${randomUUID()}`);
  const objects = path.join(directory, 'objects');
  fs.mkdirSync(objects, { recursive: true });
  const corpus = path.join(directory, 'corpus.sqlite');
  const fixture = new Database(corpus);
  fixture.exec(`
    CREATE TABLE sources (
      source_id TEXT PRIMARY KEY, display_name TEXT, provider TEXT, license TEXT, upstream_url TEXT,
      catalog_version INTEGER, accepted_rows INTEGER, rejected_rows INTEGER, complexity_metric TEXT, status TEXT
    );
    INSERT INTO sources VALUES ('fleurs-te', 'FLEURS', 'test', 'test', NULL, 1, 2, 0, 'grapheme-count', 'ready');
    CREATE TABLE source_rows (
      source_id TEXT, source_key TEXT, grapheme_count INTEGER, audio_object_key TEXT, text TEXT,
      audio_sha256 TEXT, audio_mime_type TEXT, duration_seconds REAL, PRIMARY KEY (source_id, source_key)
    );
  `);
  const wav = wavFixture();
  for (const [key, bytes] of [['a', Buffer.from('corrupted WAV')], ['b', wav]] as const) {
    fs.writeFileSync(path.join(objects, `${key}.wav`), bytes);
    fixture.prepare("INSERT INTO source_rows VALUES ('fleurs-te', ?, 5, ?, 'తెలుగు', ?, 'audio/wav', 0.1)")
      .run(key, `${key}.wav`, createHash('sha256').update(bytes).digest('hex'));
  }
  fixture.close();
  Object.assign(process.env, {
    NODE_ENV: 'test', DATA_DIRECTORY: directory, DATABASE_PATH: path.join(directory, 'users.sqlite'),
    CORPUS_DATABASE_PATH: corpus, CORPUS_AVAILABILITY_PATH: path.join(directory, 'availability.sqlite'),
    AUDIO_VALIDATION_PATH: path.join(directory, 'audio-validation.sqlite'),
    CORPUS_OBJECTS_PATH: objects, CORPUS_BACKEND: 'local', PROFILE_CODES: '001',
    MOCK_DELAY_MIN_MS: '0', MOCK_DELAY_MAX_MS: '0',
  });
  const originalRandom = Math.random;
  Math.random = () => 0;
  const { refreshAvailability } = await import('../server/src/services/corpus-availability');
  await refreshAvailability();
  const { db } = await import('../server/src/db/database');
  const profile = await import('../server/src/services/profile-service');
  const { updateProfileSelectionSettings } = await import('../server/src/services/selection-settings-service');
  const { preparedCorpusStore } = await import('../server/src/sources/prepared-corpus/prepared-corpus-store');
  const { audioValidationStore } = await import('../server/src/services/audio-validation-store');
  const waitFor = async (predicate: () => boolean) => {
    const deadline = Date.now() + 10_000;
    while (!predicate()) {
      if (Date.now() > deadline) throw new Error('Timed out waiting for corpus queue preparation');
      await new Promise(resolve => setTimeout(resolve, 5));
    }
  };
  const queued = () => db.prepare(`
    SELECT o.id, o.source_key, o.status, a.acquisition_number, a.selection_snapshot_json
    FROM queue_items q JOIN observations o ON o.id = q.observation_id
    JOIN observation_acquisitions a ON a.observation_id = o.id
    WHERE q.profile_code = '001' ORDER BY q.queue_position
  `).all() as Array<{ id: string; source_key: string; status: string; acquisition_number: number; selection_snapshot_json: string }>;
  try {
    profile.ensureProfileRow('001');
    updateProfileSelectionSettings('001', {
      sourceWeights: { source1: 0, source2: 0, source3: 0, 'fleurs-te': 1 },
      complexityPercentileTarget: 0.01, complexityPercentileSpread: 0.01,
    });
    db.prepare("INSERT INTO source_records VALUES ('001', 'fleurs-te', 'b', 'obsolete transcription', ?, 1)").run(JSON.stringify([
      { kind: 'audio', objectKey: 'obsolete-object.wav', mimeType: 'audio/wav', durationSeconds: 1, sha256: '' },
    ]));
    profile.loadProfile('001', true);
    const rejectedIds = queued().map(row => row.id);
    assert.ok(queued().every(row => row.source_key === 'a'));
    await waitFor(() => queued().every(row => row.status === 'ready'));
    assert.equal(queued().length, 10);
    assert.ok(queued().every(row => row.source_key === 'b' && !rejectedIds.includes(row.id)));
    assert.deepEqual(queued().map(row => row.acquisition_number), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    for (const row of queued()) {
      const snapshot = JSON.parse(row.selection_snapshot_json);
      assert.equal(snapshot.sourceRowCount, 1);
      assert.equal(snapshot.overallProbability, 1);
    }
    assert.equal(preparedCorpusStore.rowCount('fleurs-te'), 1);
    assert.equal(audioValidationStore.invalidReason('a.wav'), 'audio-conversion-failed');
    assert.equal(audioValidationStore.invalidReason('obsolete-object.wav'), null, 'outdated metadata is refreshed, not repeatedly rejected');
    assert.equal((db.prepare("SELECT text FROM source_records WHERE source_id = 'fleurs-te' AND source_key = 'b'").get() as { text: string }).text, 'తెలుగు');
    assert.equal((db.prepare('SELECT COUNT(*) AS count FROM recording_displays').get() as { count: number }).count, 0);

    const first = profile.navigateNext('001', true);
    const second = profile.navigateNext('001', true);
    assert.notEqual(first.currentObservation!.id, second.currentObservation!.id);
    assert.equal(second.currentObservation!.sourceKey, first.currentObservation!.sourceKey);
    assert.equal(second.currentObservation!.diagnostic.repeat?.recording.occurrenceCount, 2);
    await waitFor(() => queued().every(row => row.status === 'ready'));
    profile.navigateBack('001', true);
    const restored = profile.loadProfile('001', true);
    assert.equal(restored.currentObservation!.id, first.currentObservation!.id);
    assert.equal(restored.currentPosition, 0, 'relaunch restores the saved historical cursor, not a new selection');
    assert.equal(profile.navigateNext('001', true).currentObservation!.id, second.currentObservation!.id);
    await waitFor(() => queued().every(row => row.status === 'ready'));

    const restart = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `
      const { db } = await import('./server/src/db/database.ts');
      const { preparedCorpusStore } = await import('./server/src/sources/prepared-corpus/prepared-corpus-store.ts');
      console.log(JSON.stringify({
        profile: db.prepare("SELECT current_position FROM profiles WHERE code = '001'").get(),
        queue: db.prepare("SELECT DISTINCT o.status FROM queue_items q JOIN observations o ON o.id = q.observation_id").all(),
        count: db.prepare("SELECT SUM(occurrence_count) AS total FROM recording_displays").get(),
        selectable: preparedCorpusStore.rowCount('fleurs-te')
      }));
      preparedCorpusStore.close(); db.close();
    `], { encoding: 'utf8', env: { ...process.env, NODE_DISABLE_COMPILE_CACHE: '1' } });
    assert.equal(restart.status, 0, restart.stderr);
    assert.deepEqual(JSON.parse(restart.stdout), {
      profile: { current_position: 1 }, queue: [{ status: 'pending' }], count: { total: 2 }, selectable: 1,
    });
    profile.loadProfile('001', true);
    await waitFor(() => queued().every(row => row.status === 'ready'));

    // The server stayed running, but an object disappeared while the browser was
    // away. Visibility resume must not trust a previous ready marker indefinitely.
    fs.unlinkSync(path.join(objects, 'b.wav'));
    profile.setProfileVisibility('001', true);
    const resuming = profile.getProfileState('001', true);
    assert.equal(resuming.currentObservation!.id, second.currentObservation!.id);
    assert.equal(resuming.canNext, false);
    await waitFor(() => (db.prepare(`
      SELECT COUNT(*) AS count FROM observations WHERE status = 'preparing'
        OR (status = 'pending' AND preparation_attempts < 3 AND (preparation_error IS NULL OR preparation_retry_at IS NOT NULL))
    `).get() as { count: number }).count === 0);
    const exhausted = profile.getProfileState('001', true);
    assert.equal(exhausted.canNext, false);
    assert.equal(exhausted.queue.preparationError?.code, 'no-selectable-replacement');
    assert.equal(exhausted.queue.preparationError?.attempts, 1, 'terminal pool exhaustion does not fabricate extra attempts');
    assert.equal(audioValidationStore.invalidReason('b.wav'), 'audio-not-found');
    assert.equal(preparedCorpusStore.rowCount('fleurs-te'), 0);
    assert.equal((db.prepare('SELECT SUM(occurrence_count) AS count FROM recording_displays').get() as { count: number }).count, 2);
    assert.deepEqual(db.pragma('foreign_key_check'), []);
  } finally {
    Math.random = originalRandom;
    preparedCorpusStore.close();
    audioValidationStore.close();
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
