import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';

test('Core batches, mastery, per-core no repeats, parked queues and independent random selection', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'parsing-mode-'));
  const corpus = path.join(directory, 'corpus.sqlite'), availability = path.join(directory, 'availability.sqlite');
  const assets = path.join(directory, 'assets'); fs.mkdirSync(assets);
  const nodes: Record<string, { id: string; core: number; kind: string; label: string; forms: string[]; neighbors: string[] }> = {};
  for (let core = 1; core <= 3; core++) for (const letter of ['A', 'B']) {
    const id = `${core}${letter}`; nodes[id] = { id, core, kind: 'vocabulary', label: id, forms: [id], neighbors: [`${core}${letter === 'A' ? 'B' : 'A'}`] };
  }
  const graphBytes = JSON.stringify({ nodes }); fs.writeFileSync(path.join(assets, 'graph.json'), graphBytes);
  const fingerprint = createHash('sha256').update('graph.json').update(graphBytes).digest('hex');
  const words = ['ఇక్కడ', 'అక్కడ', 'నేను', 'నువ్వు', 'మనం', 'మీరు', 'ఇది', 'అది', 'ఇవి', 'అవి', 'ఎవరు', 'ఎక్కడ', 'ఇక్కడ'];
  const source = new Database(corpus);
  source.exec(`CREATE TABLE sources(source_id TEXT,display_name TEXT,provider TEXT,license TEXT,upstream_url TEXT,catalog_version INTEGER,accepted_rows INTEGER,rejected_rows INTEGER,complexity_metric TEXT,status TEXT);
    INSERT INTO sources VALUES('fleurs-te','Fleurs','test','test',NULL,1,13,0,'grapheme-count','ready');
    CREATE TABLE source_rows(source_id TEXT,source_key TEXT,text TEXT,grapheme_count INTEGER,audio_sha256 TEXT,audio_object_key TEXT,audio_mime_type TEXT,duration_seconds REAL,PRIMARY KEY(source_id,source_key));`);
  words.forEach((word, i) => source.prepare('INSERT INTO source_rows VALUES(?,?,?,?,?,?,?,?)').run('fleurs-te', String(i), word, i % 2 + 1, '', `audio/${i}.wav`, 'audio/wav', 1));
  source.close();
  const a = new Database(availability);
  a.exec(`CREATE TABLE metadata(generation TEXT,identity TEXT);CREATE TABLE source_complexity_members(source_id TEXT,source_key TEXT,grapheme_count INTEGER,class_index INTEGER);CREATE TABLE source_counts(source_id TEXT,row_count INTEGER);CREATE TABLE complexity_counts(source_id TEXT,grapheme_count INTEGER,row_count INTEGER);`);
  let even = 0, odd = 0;
  words.forEach((_, i) => a.prepare('INSERT INTO source_complexity_members VALUES(?,?,?,?)').run('fleurs-te', String(i), i % 2 + 1, i % 2 ? odd++ : even++));
  a.prepare('INSERT INTO source_counts VALUES(?,?)').run('fleurs-te', words.length);
  a.prepare('INSERT INTO complexity_counts VALUES(?,?,?)').run('fleurs-te', 1, even);
  a.prepare('INSERT INTO complexity_counts VALUES(?,?,?)').run('fleurs-te', 2, odd);
  Object.assign(process.env, { NODE_ENV: 'test', DATA_DIRECTORY: directory, DATABASE_PATH: path.join(directory, 'users.sqlite'),
    CORPUS_DATABASE_PATH: corpus, CORPUS_AVAILABILITY_PATH: availability, AUDIO_VALIDATION_PATH: path.join(directory, 'audio-validation.sqlite'),
    CORPUS_BACKEND: 'local', PROFILE_CODES: '001,002,003', PARSING_ASSETS_DIRECTORY: assets, GRAMMAR_MIGRATION_TOKEN: 'test-operator' });
  const { config } = await import('../server/src/config/config');
  const { availabilityIdentity } = await import('../server/src/services/corpus-availability');
  a.prepare('INSERT INTO metadata VALUES(?,?)').run('test', availabilityIdentity(config)); a.close();
  const { db } = await import('../server/src/db/database');
  for (const code of ['001', '002', '003']) db.prepare('INSERT INTO profiles(code,created_at,updated_at) VALUES(?,0,0)').run(code);
  const state = await import('../server/src/parsing/state');
  const { corpusStamp } = await import('../server/src/parsing/catalog');
  const file = path.join(directory, 'parsing.sqlite'), c = new Database(file);
  c.exec(`CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT);CREATE TABLE rows(id INTEGER PRIMARY KEY,source_id TEXT,source_key TEXT,text_hash TEXT,length INTEGER,audio_key TEXT);
    CREATE TABLE members(target_id TEXT,row_id INTEGER,core INTEGER,length INTEGER,PRIMARY KEY(target_id,row_id));CREATE INDEX shortest_member ON members(target_id,length,row_id);
    CREATE TABLE matches(row_id INTEGER,target_id TEXT,start_cp INTEGER,end_cp INTEGER,token_index INTEGER,surface TEXT,reason TEXT);
    CREATE TABLE words(surface TEXT,analysis_json TEXT);`);
  for (const [key, value] of Object.entries({ complete: true, identity: { schema: 1, inventoryId: 'fixture', parserHash: fingerprint }, stats: { total: 13, coreStats: [] } })) c.prepare('INSERT INTO metadata VALUES(?,?)').run(key, JSON.stringify(value));
  words.forEach((word, i) => {
    c.prepare('INSERT INTO rows VALUES(?,?,?,?,?,?)').run(i + 1, 'fleurs-te', String(i), state.textHash(word), 1, `audio/${i}.wav`);
    for (let core = 1; core <= 3; core++) {
      const target = `${core}${i % 2 ? 'B' : 'A'}`;
      c.prepare('INSERT INTO members VALUES(?,?,?,1)').run(target, i + 1, core);
      c.prepare("INSERT INTO matches VALUES(?,?,?,?,?,?, 'fixture')").run(i + 1, target, 0, Array.from(word).length, 0, word);
    }
  }); c.close();
  db.prepare('UPDATE parsing_system SET catalog_path=?,inventory_id=?,corpus_stamp=? WHERE id=1').run(file, 'fixture', corpusStamp());
  const queue = await import('../server/src/services/queue-service');
  const settings = await import('../server/src/services/selection-settings-service');
  const originalSettings = settings.getProfileSelectionSettings('001');
  db.prepare("UPDATE profile_selection_settings SET complexity_percentile_target=0.7,complexity_percentile_spread=0.2 WHERE profile_code='001'").run();
  const savedSettings = settings.getProfileSelectionSettings('001');
  const queued = (profile: string) => db.prepare('SELECT q.observation_id,a.mode,a.target_id,a.core,a.text_hash,a.batch_id,a.slot,o.source_key FROM queue_items q JOIN selection_attempts a ON a.observation_id=q.observation_id JOIN observations o ON o.id=q.observation_id WHERE q.profile_code=? ORDER BY q.queue_position').all(profile) as Array<{ observation_id: string; mode: string; target_id: string; core: number; text_hash: string; batch_id: string; slot: number; source_key: string }>;
  const answer = (profile: string, id: string, correct: boolean) => {
    const position = (db.prepare('SELECT COUNT(*) AS n FROM history_entries WHERE profile_code=?').get(profile) as { n: number }).n;
    db.prepare('INSERT INTO history_entries(profile_code,history_position,observation_id,presentation_state_json,absolute_started_at) VALUES(?,?,?,?,0)').run(profile, position, id, JSON.stringify({ questionPhase: 'observation' }));
    db.prepare('UPDATE profiles SET current_position=? WHERE code=?').run(position, profile);
    db.prepare('DELETE FROM queue_items WHERE observation_id=?').run(id);
    state.markDisplayed(profile, id); state.markDisplayed(profile, id);
    state.evaluate(profile, id, correct); state.evaluate(profile, id, correct);
    assert.throws(() => state.evaluate(profile, id, !correct), /final/);
  };
  const oldRandom = Math.random; Math.random = () => 0;
  try {
    queue.ensureLaunchQueue('001'); const normal = queued('001').map(r => r.observation_id);
    assert.equal(normal.length, 10);
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM observation_acquisitions WHERE observation_kind='question'").get() as { n: number }).n, 10);
    state.switchMode('001', 'core'); queue.ensureLaunchQueue('001'); const first = queued('001');
    assert.equal(first.length, 10); assert.equal(new Set(first.map(r => r.text_hash)).size, 10);
    assert.ok(first.every(r => r.core === 1)); assert.equal(state.coreProgress('001').core, 1);
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM core_used').get() as { n: number }).n, 0, 'reserved rows are not used');
    const snapshots = db.prepare('SELECT selection_snapshot_json FROM observation_acquisitions WHERE observation_id IN(SELECT observation_id FROM queue_items WHERE profile_code=?)').all('001') as Array<{ selection_snapshot_json: string }>;
    assert.ok(snapshots.every(r => { const s = JSON.parse(r.selection_snapshot_json); return s.length === 1 && s.questionType.textGiven === 2 / 3; }));
    state.switchMode('001', 'random'); queue.ensureLaunchQueue('001'); const randomQueue = queued('001'); assert.equal(randomQueue.length, 10);
    assert.ok(randomQueue.every(r => r.mode === 'random'));
    state.switchMode('001', 'weighted'); assert.deepEqual(queued('001').map(r => r.observation_id), normal);
    state.switchMode('001', 'core'); assert.deepEqual(queued('001').map(r => r.observation_id), first.map(r => r.observation_id));
    assert.deepEqual(settings.getProfileSelectionSettings('001'), savedSettings);
    first.forEach((r, i) => { answer('001', r.observation_id, i !== 9); if (i < 9) assert.deepEqual(state.coreProgress('001').streaks, {}); });
    assert.equal(state.coreProgress('001').streaks['1A'], 3); assert.equal(state.coreProgress('001').streaks['1B'], 0);
    queue.ensureLaunchQueue('001'); const short = queued('001'); assert.equal(short.length, 2);
    assert.equal(short[0]!.target_id, '1B', 'mastered target cannot be a seed');
    assert.equal(short[1]!.target_id, '1A', 'mastered target is reachable as neighbor');
    answer('001', short[0]!.observation_id, true); answer('001', short[1]!.observation_id, false);
    assert.equal(state.coreProgress('001').streaks['1A'], 0);
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM core_used WHERE profile_code='001' AND core=1").get() as { n: number }).n, 12);
    assert.throws(() => queue.ensureLaunchQueue('001'), /blocked/);
    assert.equal(state.coreProgress('001').core, 1, 'exhaustion does not skip requirements');
    state.switchMode('002', 'core');
    for (let core = 1; core <= 3; core++) {
      queue.ensureLaunchQueue('002'); const batch = queued('002'); assert.equal(batch.length, 10);
      assert.ok(batch.every(r => r.core === core));
      assert.equal(batch[0]!.source_key, '0', 'same sentence is reusable in a different core');
      batch.forEach((r, i) => { answer('002', r.observation_id, true); if (i < 9) assert.equal(state.coreProgress('002').core, core); });
      assert.equal(state.coreProgress('002').core, core + 1);
    }
    assert.equal(queue.ensureLaunchQueue('002'), false);
    assert.equal(state.questionChoice('002', () => 0.5).audioGiven, 2 / 3);
    assert.equal(state.coreProgress('003').core, 1, 'profile progress is isolated');
    const { SourceRegistry } = await import('../server/src/services/source-registry');
    const { uniformAudioRow } = await import('../server/src/parsing/random');
    const registry = new SourceRegistry({ includePreparedSources: false });
    for (const [id, count] of [['small', 2], ['large', 7]] as const) registry.register({ id, enabled: true, rowCount: () => count,
      complexityClasses: () => [{ complexityValue: 77, rowCount: count }], candidateAt: (_, i) => ({ sourceKey: String(i), complexityValue: 77 }),
      prepare: async () => ({ text: '', media: [] }), info: () => originalSettings as never });
    const draws = Array.from({ length: 9 }, (_, i) => uniformAudioRow(registry, () => (i + 0.5) / 9));
    assert.equal(new Set(draws.map(r => r.sourceId + r.sourceKey)).size, 9);
    assert.ok(draws.every(r => r.snapshot.rowProbability === 1 / 9));
    // Global builds retain the existing operator authorization, while invalid
    // profile codes and cross-origin mutations are rejected before any work.
    const { Hono } = await import('hono'); const { parsingRoutes } = await import('../server/src/parsing/routes');
    const app = new Hono(); app.route('/', parsingRoutes());
    assert.equal((await app.request('/999/parsing/status')).status, 404);
    assert.equal((await app.request('/001/parsing/build', { method: 'POST' })).status, 403);
    assert.equal((await app.request('/001/parsing/mode', { method: 'POST', headers: { origin: 'https://other.test', host: 'localhost' } })).status, 403);
    assert.equal((await app.request('/001/parsing/mode', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"mode":"invalid"}' })).status, 400);
    db.prepare("DELETE FROM profiles WHERE code='001'").run();
    for (const table of ['selection_modes', 'parked_queues', 'core_progress', 'core_streaks', 'core_used', 'core_batches', 'selection_attempts']) {
      assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE profile_code='001'`).get() as { n: number }).n, 0);
    }
  } finally { Math.random = oldRandom; }
});
