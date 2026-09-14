import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import test, { after, before, beforeEach } from 'node:test';
import { Hono } from 'hono';
import { EonError, profileEonsRoutes, profileEonsStore } from '../server/src/services/eon-service';
import { initializeEonSchema } from '../server/src/db/eons';
import { profilePreferencesRoutes } from '../server/src/services/profile-preferences-service';
import type { ProfileEonsResponse } from '../shared/contracts';

const directory = path.resolve('test-results', `eons-${randomUUID()}`);
fs.mkdirSync(directory, { recursive: true });
Object.assign(process.env, {
  NODE_ENV: 'test', DATA_DIRECTORY: directory, DATABASE_PATH: path.join(directory, 'users.sqlite'),
  CORPUS_DATABASE_PATH: path.join(directory, 'corpus.sqlite'),
  CORPUS_AVAILABILITY_PATH: path.join(directory, 'availability.sqlite'),
  AUDIO_VALIDATION_PATH: path.join(directory, 'audio-validation.sqlite'),
  CORPUS_OBJECTS_PATH: path.join(directory, 'objects'), CORPUS_BACKEND: 'local', PROFILE_CODES: '001,002,003',
});
let db: typeof import('../server/src/db/database')['db'];
let profile: typeof import('../server/src/services/profile-service');
let store: ReturnType<typeof profileEonsStore>;
const originalNow = Date.now;
let now = 1_000;

before(async () => {
  ({ db } = await import('../server/src/db/database'));
  profile = await import('../server/src/services/profile-service');
  const { preparationService } = await import('../server/src/services/preparation-service');
  preparationService.kick = () => {};
  // No prepared corpus exists here, and the app ships no dummy sources, so the
  // selection engine needs a fixture source to have anything to choose from.
  const { sourceRegistry } = await import('../server/src/services/source-registry');
  const { config } = await import('../server/src/config/config');
  const { DummyDataSource } = await import('./fixtures/dummy-data-source');
  const { source1Rows } = await import('./fixtures/source1');
  sourceRegistry.register(new DummyDataSource('source1', source1Rows));
  Object.assign(config.defaultSourceWeights, { source1: 1 });
  store = profileEonsStore(db);
  Date.now = () => now;
});
beforeEach(() => {
  db.exec('DELETE FROM profiles; DELETE FROM observations;');
  now = 1_000;
});
after(async () => {
  Date.now = originalNow;
  (await import('../server/src/sources/prepared-corpus/prepared-corpus-store')).preparedCorpusStore.close();
  (await import('../server/src/services/audio-validation-store')).audioValidationStore.close();
  db.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

interface ViewRow {
  observation_id: string;
  eon_id: string | null;
  kind: string;
  viewed_at: number;
  history_position: number;
}
const views = (code = '001') => db.prepare(`
  SELECT observation_id, eon_id, kind, viewed_at, history_position
  FROM observation_views WHERE profile_code = ? ORDER BY id
`).all(code) as ViewRow[];
const queued = (code = '001') => db.prepare(`
  SELECT q.observation_id, a.selection_snapshot_json FROM queue_items q
  JOIN observation_acquisitions a ON a.observation_id = q.observation_id
  WHERE q.profile_code = ? ORDER BY q.queue_position
`).all(code) as Array<{ observation_id: string; selection_snapshot_json: string }>;
function readyProfile(code = '001'): void {
  profile.loadProfile(code, true);
  db.prepare(`
    UPDATE observations SET status = 'ready', text = 'తెలుగు', prepared_at = ?, audio_validated_at = ?
    WHERE id IN (SELECT observation_id FROM queue_items WHERE profile_code = ?)
  `).run(now, now, code);
}
function next(code = '001'): string {
  now += 100;
  return profile.navigateNext(code, true).currentObservation!.id;
}
function snapshot(id: string) {
  return db.prepare(`
    SELECT a.selection_snapshot_json, o.repeat_snapshot_json
    FROM observation_acquisitions a JOIN observations o ON o.id = a.observation_id WHERE o.id = ?
  `).get(id);
}

test('eons include current and prequeued observations by viewing, never by acquisition or polling', () => {
  readyProfile();
  const reservations = queued();
  assert.equal(reservations.length, 10);
  assert.deepEqual(views(), []);
  const first = next();
  const original = snapshot(first);
  const started = store.start('001', '  Morning Telugu  ');
  const eon = started.activeEon!;
  assert.equal(eon.name, 'Morning Telugu');
  assert.equal(eon.startedAt, now);
  assert.equal(eon.stoppedAt, null);
  assert.equal(eon.observationCount, 1);
  assert.equal(views()[0]!.eon_id, null);
  assert.deepEqual(views()[1], {
    observation_id: first, eon_id: eon.id, kind: 'eon-start', viewed_at: now, history_position: 0,
  });
  const second = next();
  assert.equal(second, reservations[1]!.observation_id);
  assert.equal(store.list('001').activeEon!.observationCount, 2);
  assert.equal(views().at(-1)!.eon_id, eon.id);
  assert.equal(views().at(-1)!.kind, 'next');
  assert.deepEqual(snapshot(first), original);
  for (const reservation of reservations) {
    const saved = db.prepare('SELECT selection_snapshot_json FROM observation_acquisitions WHERE observation_id = ?')
      .get(reservation.observation_id) as { selection_snapshot_json: string };
    assert.equal(saved.selection_snapshot_json, reservation.selection_snapshot_json);
  }
  const before = views();
  for (const visible of [true, false, true]) profile.getProfileState('001', visible);
  assert.deepEqual(views(), before);
  assert.ok(queued().every(row => !views().some(view => view.observation_id === row.observation_id)));
});

test('history revisits, reloads and explicit resumes append timestamps without changing generation or repeat snapshots', () => {
  readyProfile();
  const first = next();
  const second = next();
  const originalFirst = snapshot(first);
  const originalSecond = snapshot(second);
  const eon = store.start('001', 'Revisiting').activeEon!;
  now += 100;
  assert.equal(profile.navigateBack('001', true).currentObservation!.id, first);
  assert.equal(next(), second);
  now += 100;
  profile.loadProfile('001', true);
  now += 100;
  profile.setProfileVisibility('001', false);
  assert.equal(views().at(-1)!.kind, 'load');
  profile.setProfileVisibility('001', true);
  assert.deepEqual(views().filter(view => view.eon_id === eon.id).map(view => view.kind),
    ['eon-start', 'back', 'forward', 'load', 'resume']);
  assert.equal(views().at(-1)!.viewed_at, now);
  assert.equal(store.list('001').activeEon!.observationCount, 2);
  assert.deepEqual(snapshot(first), originalFirst);
  assert.deepEqual(snapshot(second), originalSecond);
});

test('stop and repeated-name restart permit the same observation in multiple eons and keep outside views', () => {
  readyProfile();
  const first = next();
  const firstEon = store.start('001', 'Daily practice').activeEon!;
  const second = next();
  const original = snapshot(second);
  now += 100;
  const stopped = store.stop('001', firstEon.id);
  assert.equal(stopped.activeEon, null);
  assert.equal(stopped.eons[0]!.stoppedAt, now);
  const third = next();
  assert.equal(views().at(-1)!.eon_id, null);
  const secondEon = store.start('001', 'Daily practice').activeEon!;
  now += 100;
  profile.navigateBack('001', true);
  assert.equal(views().at(-1)!.observation_id, second);
  assert.deepEqual(new Set(views().filter(view => view.observation_id === second).map(view => view.eon_id)),
    new Set([firstEon.id, secondEon.id]));
  assert.deepEqual(store.list('001').eons.map(eon => [eon.id, eon.observationCount]),
    [[secondEon.id, 2], [firstEon.id, 2]]);
  assert.ok(views().some(view => view.observation_id === first && view.eon_id === firstEon.id));
  assert.ok(views().some(view => view.observation_id === third && view.eon_id === secondEon.id));
  assert.deepEqual(snapshot(second), original);
});

test('active eons survive actual database startup and empty-current starts do not fabricate prior views', () => {
  readyProfile();
  const eon = store.start('001', 'From the beginning').activeEon!;
  assert.equal(eon.observationCount, 0);
  assert.deepEqual(views(), []);
  const first = next();
  const before = views();
  initializeEonSchema(db);
  assert.deepEqual(views(), before);
  const restarted = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `
    const { db } = await import('./server/src/db/database.ts');
    const { profileEonsStore } = await import('./server/src/services/eon-service.ts');
    console.log(JSON.stringify({
      eons: profileEonsStore(db).list('001'),
      views: db.prepare('SELECT COUNT(*) AS count FROM observation_views').get()
    }));
    db.close();
  `], { encoding: 'utf8', env: { ...process.env, NODE_DISABLE_COMPILE_CACHE: '1' } });
  assert.equal(restarted.status, 0, restarted.stderr);
  const saved = JSON.parse(restarted.stdout) as { eons: ProfileEonsResponse; views: { count: number } };
  assert.equal(saved.eons.activeEon!.id, eon.id);
  assert.equal(saved.eons.activeEon!.observationCount, 1);
  assert.equal(saved.views.count, 1);
  now += 100;
  assert.equal(profile.loadProfile('001', true).currentObservation!.id, first);
  assert.equal(views().at(-1)!.kind, 'load');
  assert.equal(views().at(-1)!.eon_id, eon.id);
});

test('upgrading a profile with existing history creates no retrospective eons or view events', () => {
  readyProfile();
  const first = next();
  const second = next();
  const snapshots = [snapshot(first), snapshot(second)];
  db.exec('DROP TABLE observation_views; DROP TABLE profile_eons;');
  initializeEonSchema(db);
  assert.deepEqual(views(), []);
  assert.deepEqual(store.list('001'), { activeEon: null, eons: [] });
  assert.deepEqual([snapshot(first), snapshot(second)], snapshots);
  const active = store.start('001', 'After upgrade').activeEon!;
  assert.equal(active.observationCount, 1);
  assert.equal(views()[0]!.observation_id, second);
  now += 100;
  profile.navigateBack('001', true);
  assert.equal(store.list('001').activeEon!.observationCount, 2);
});

test('view and eon rows isolate profiles and follow queue reset and profile deletion cascades', () => {
  readyProfile('001');
  readyProfile('002');
  const first = next('001');
  const second = next('002');
  const one = store.start('001', 'Shared name').activeEon!;
  const two = store.start('002', 'Shared name').activeEon!;
  assert.deepEqual(store.list('001').eons.map(eon => eon.id), [one.id]);
  assert.deepEqual(store.list('002').eons.map(eon => eon.id), [two.id]);
  assert.throws(() => store.stop('001', two.id), (error: unknown) => error instanceof EonError && error.status === 404);
  assert.throws(() => db.prepare(`
    INSERT INTO observation_views (profile_code, observation_id, history_position, eon_id, viewed_at, kind)
    VALUES ('001', ?, 0, ?, ?, 'next')
  `).run(first, two.id, now), /FOREIGN KEY/);
  const before = views();
  const discarded = queued().map(row => row.observation_id);
  profile.resetQueue('001', true);
  assert.deepEqual(views(), before);
  assert.equal(store.list('001').activeEon!.observationCount, 1);
  for (const id of discarded) assert.equal(db.prepare('SELECT 1 FROM observations WHERE id = ?').get(id), undefined);
  assert.ok(db.prepare('SELECT 1 FROM observations WHERE id = ?').get(first));
  db.prepare("DELETE FROM profiles WHERE code = '001'").run();
  assert.deepEqual(views(), []);
  assert.deepEqual(store.list('001'), { activeEon: null, eons: [] });
  assert.equal(views('002').at(-1)!.observation_id, second);
  assert.equal(store.list('002').activeEon!.id, two.id);
  db.prepare('DELETE FROM history_entries WHERE observation_id = ?').run(first);
  db.prepare('DELETE FROM observations WHERE id = ?').run(first);
  assert.deepEqual(db.pragma('foreign_key_check'), []);
});

test('eon start and navigation commit atomically with their view ledger and queue replacement', () => {
  readyProfile();
  const first = next();
  const initial = snapshot(first);
  db.exec(`CREATE TRIGGER reject_eon_view BEFORE INSERT ON observation_views
    BEGIN SELECT RAISE(ABORT, 'view-rejected'); END;`);
  try {
    assert.throws(() => store.start('001', 'Rolled back'), /view-rejected/);
    assert.deepEqual(store.list('001'), { activeEon: null, eons: [] });
    assert.throws(() => profile.navigateNext('001', true), /view-rejected/);
    assert.equal(profile.getProfileState('001', true).currentObservation!.id, first);
    assert.equal(views().length, 1);
    assert.deepEqual(snapshot(first), initial);
  } finally { db.exec('DROP TRIGGER reject_eon_view'); }
  const active = store.start('001', 'Atomic').activeEon!;
  assert.throws(() => db.prepare("INSERT INTO profile_eons (id, profile_code, name, started_at) VALUES (?, '001', 'Concurrent', ?)")
    .run(randomUUID(), now), /UNIQUE/);
  const second = next();
  const before = views();
  db.exec(`CREATE TRIGGER reject_history_view BEFORE INSERT ON observation_views
    BEGIN SELECT RAISE(ABORT, 'view-rejected'); END;`);
  try {
    assert.throws(() => profile.navigateBack('001', true), /view-rejected/);
    assert.equal(profile.getProfileState('001', true).currentObservation!.id, second);
    assert.deepEqual(views(), before);
  } finally { db.exec('DROP TRIGGER reject_history_view'); }
  profile.navigateBack('001', true);
  const beforeForward = views();
  db.exec(`CREATE TRIGGER reject_forward_view BEFORE INSERT ON observation_views
    BEGIN SELECT RAISE(ABORT, 'view-rejected'); END;`);
  try {
    assert.throws(() => profile.navigateNext('001', true), /view-rejected/);
    assert.equal(profile.getProfileState('001', true).currentObservation!.id, first);
    assert.deepEqual(views(), beforeForward);
  } finally { db.exec('DROP TRIGGER reject_forward_view'); }
  next();
  const beforeReplacement = views();
  db.exec(`CREATE TRIGGER reject_replacement BEFORE INSERT ON observation_acquisitions
    WHEN NEW.trigger_kind = 'observation-consumed' BEGIN SELECT RAISE(ABORT, 'replacement-rejected'); END;`);
  try {
    const pending = queued();
    assert.throws(() => profile.navigateNext('001', true), /replacement-rejected/);
    assert.deepEqual(queued(), pending);
    assert.deepEqual(views(), beforeReplacement);
    assert.equal(profile.getProfileState('001', true).currentObservation!.id, second);
    assert.equal(store.list('001').activeEon!.id, active.id);
  } finally { db.exec('DROP TRIGGER reject_replacement'); }
  profile.navigateBack('001', true);
  const historical = views();
  assert.throws(() => profile.navigateBack('001', true), profile.NavigationUnavailableError);
  assert.deepEqual(views(), historical);
});

test('eon routes validate names, isolate profiles, reject concurrent starts and use consistent stop statuses', async () => {
  profile.ensureProfileRow('001');
  profile.ensureProfileRow('002');
  const validCode = (code: string) => ['001', '002', '003'].includes(code);
  const app = new Hono().route('/api/profiles', profilePreferencesRoutes(db, validCode))
    .route('/api/profiles', profileEonsRoutes(db, validCode));
  const request = (code: string, method = 'GET', body?: unknown, suffix = '') => app.request(`/api/profiles/${code}/eons${suffix}`, {
    method, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  for (const code of ['999', '003']) assert.equal((await request(code)).status, 404);
  const empty = await request('001');
  assert.equal(empty.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(await empty.json(), { activeEon: null, eons: [] });
  for (const body of [null, [], {}, { name: '' }, { name: ' \n ' }, { name: false }, { name: 42 },
    { name: 'x'.repeat(81) }, { name: '\0name' }, { name: 'Valid', unexpected: true }]) {
    const response = await request('001', 'POST', body);
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: 'invalid-eon-name' });
  }
  assert.equal((await app.request('/api/profiles/001/eons', { method: 'POST', body: '{' })).status, 400);
  const concurrent = await Promise.all([request('001', 'POST', { name: '  తెలుగు  ' }), request('001', 'POST', { name: 'Another' })]);
  assert.deepEqual(concurrent.map(response => response.status).sort(), [201, 409]);
  const created = await concurrent.find(response => response.status === 201)!.json() as ProfileEonsResponse;
  const id = created.activeEon!.id;
  assert.equal(created.activeEon!.name, 'తెలుగు');
  assert.deepEqual(await concurrent.find(response => response.status === 409)!.json(), { error: 'eon-already-active' });
  for (const [code, eonId] of [['002', id], ['001', 'missing']]) {
    const response = await request(code!, 'POST', {}, `/${eonId}/stop`);
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: 'eon-not-found' });
  }
  const stopped = await request('001', 'POST', {}, `/${id}/stop`);
  assert.equal(stopped.status, 200);
  assert.equal((await stopped.json() as ProfileEonsResponse).activeEon, null);
  const repeatedStop = await request('001', 'POST', {}, `/${id}/stop`);
  assert.equal(repeatedStop.status, 409);
  assert.deepEqual(await repeatedStop.json(), { error: 'eon-already-stopped' });
  const restarted = await request('001', 'POST', { name: 'తెలుగు' });
  const response = await restarted.json() as ProfileEonsResponse;
  assert.equal(restarted.status, 201);
  assert.notEqual(response.activeEon!.id, id);
  assert.deepEqual(response.eons.map(eon => eon.id), [response.activeEon!.id, id], 'equal timestamps retain newest-first creation order');
  assert.equal((await request('002', 'POST', { name: 'x'.repeat(80) })).status, 201);
  assert.equal((await app.request('/api/profiles/001/eons', {
    method: 'POST', headers: { Origin: 'https://other.example', Host: 'localhost' }, body: '{"name":"Blocked"}',
  })).status, 403);
  assert.equal((await app.request('/api/profiles/001/eons', { method: 'POST', body: 'x'.repeat(4097) })).status, 413);
});
