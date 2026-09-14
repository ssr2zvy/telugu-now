import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import test, { after, before, beforeEach } from 'node:test';
import { Hono } from 'hono';
import type { ProfileBlacklistResponse } from '../shared/contracts';

const directory = path.resolve('test-results', `blacklist-${randomUUID()}`);
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
let store: ReturnType<typeof import('../server/src/services/blacklist-service')['profileBlacklistStore']>;
let BlacklistError: typeof import('../server/src/services/blacklist-service')['BlacklistError'];
let profileBlacklistRoutes: typeof import('../server/src/services/blacklist-service')['profileBlacklistRoutes'];
let profileBlacklistStore: typeof import('../server/src/services/blacklist-service')['profileBlacklistStore'];
const originalNow = Date.now;
let now = 1_000;

before(async () => {
  ({ db } = await import('../server/src/db/database'));
  profile = await import('../server/src/services/profile-service');
  const { preparationService } = await import('../server/src/services/preparation-service');
  preparationService.kick = () => {};
  ({ BlacklistError, profileBlacklistRoutes, profileBlacklistStore } = await import('../server/src/services/blacklist-service'));
  store = profileBlacklistStore(db);
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

const queued = (code = '001') => db.prepare(`
  SELECT q.queue_position AS queuePosition, o.id, o.status, o.text FROM queue_items q
  JOIN observations o ON o.id = q.observation_id
  WHERE q.profile_code = ? ORDER BY q.queue_position
`).all(code) as Array<{ queuePosition: number; id: string; status: string; text: string | null }>;
function readyProfile(code = '001'): void {
  profile.loadProfile(code, true);
  db.prepare(`
    UPDATE observations SET status = 'ready', text = 'తెలుగు', prepared_at = ?, audio_validated_at = ?
    WHERE id IN (SELECT observation_id FROM queue_items WHERE profile_code = ?)
  `).run(now, now, code);
}

test('blacklist store validates text before inserting', () => {
  profile.ensureProfileRow('001');
  for (const value of ['', '   ', 42, null, undefined, 'x'.repeat(4001), 'bad\0text']) {
    assert.throws(() => store.add('001', value), BlacklistError);
  }
  assert.deepEqual(store.list('001'), { entries: [] });
});

test('add/list/remove manage entries scoped per profile, trimmed and de-duplicated', () => {
  profile.ensureProfileRow('001');
  profile.ensureProfileRow('002');
  now = 1_000;
  store.add('001', '  తెలుగు వాక్యం  ');
  now = 2_000;
  store.add('001', 'రెండో వాక్యం');
  store.add('002', 'వేరే ప్రొఫైల్');
  // Re-adding the same trimmed text is idempotent and keeps the original timestamp.
  now = 3_000;
  const again = store.add('001', 'తెలుగు వాక్యం');
  assert.deepEqual(again.entries.map(entry => entry.text), ['రెండో వాక్యం', 'తెలుగు వాక్యం']);
  assert.equal(again.entries.find(entry => entry.text === 'తెలుగు వాక్యం')!.createdAt, 1_000);
  assert.deepEqual(store.list('002').entries.map(entry => entry.text), ['వేరే ప్రొఫైల్']);
  const afterRemoval = store.remove('001', 'రెండో వాక్యం');
  assert.deepEqual(afterRemoval.entries.map(entry => entry.text), ['తెలుగు వాక్యం']);
  // Removing a sentence that was never blacklisted (or already removed) is a no-op.
  assert.deepEqual(store.remove('001', 'never blacklisted'), afterRemoval);
  assert.deepEqual(store.list('002').entries.map(entry => entry.text), ['వేరే ప్రొఫైల్']);
});

test('blacklisting a displayed-again sentence replaces only the matching ready reservations', () => {
  readyProfile();
  const before = queued();
  assert.equal(before.length, 10);
  const target = before[3]!;
  db.prepare("UPDATE observations SET text = 'బ్లాక్‌లిస్ట్ వాక్యం' WHERE id = ?").run(target.id);
  const result = store.add('001', 'బ్లాక్‌లిస్ట్ వాక్యం');
  assert.deepEqual(result.entries.map(entry => entry.text), ['బ్లాక్‌లిస్ట్ వాక్యం']);
  const after = queued();
  assert.equal(after.length, 10);
  for (let index = 0; index < before.length; index += 1) {
    if (index === 3) {
      assert.notEqual(after[index]!.id, target.id, 'the blacklisted reservation is replaced with a new observation');
      assert.equal(after[index]!.status, 'pending');
      assert.equal(after[index]!.text, null, 'a replacement has not been prepared yet');
      assert.equal(after[index]!.queuePosition, target.queuePosition, 'the queue slot itself is preserved');
    } else {
      assert.deepEqual(after[index], before[index], 'unrelated reservations stay untouched');
    }
  }
  assert.equal(db.prepare('SELECT status FROM observations WHERE id = ?').get(target.id), undefined,
    'the rejected reservation is deleted, not merely dequeued');
});

test('blacklist routes validate profiles, payloads and origins, and stay isolated per profile', async () => {
  profile.ensureProfileRow('001');
  profile.ensureProfileRow('002');
  const validCode = (code: string) => ['001', '002', '003'].includes(code);
  const app = new Hono().route('/api/profiles', profileBlacklistRoutes(db, validCode));
  const request = (code: string, method = 'GET', body?: unknown) => app.request(`/api/profiles/${code}/blacklist`, {
    method, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  for (const code of ['999', '003']) assert.equal((await request(code)).status, 404);
  const empty = await request('001');
  assert.equal(empty.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(await empty.json(), { entries: [] });
  for (const body of [null, [], {}, { text: '' }, { text: '   ' }, { text: 42 }, { text: null },
    { text: 'x'.repeat(4001) }, { text: 'Valid', unexpected: true }]) {
    const response = await request('001', 'POST', body);
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: 'invalid-blacklist-text' });
  }
  assert.equal((await app.request('/api/profiles/001/blacklist', { method: 'POST', body: '{' })).status, 400);
  const created = await request('001', 'POST', { text: '  వాక్యం  ' });
  assert.equal(created.status, 201);
  assert.deepEqual((await created.json() as ProfileBlacklistResponse).entries.map(entry => entry.text), ['వాక్యం']);
  assert.deepEqual((await (await request('002')).json() as ProfileBlacklistResponse).entries, []);
  const removed = await request('001', 'DELETE', { text: 'వాక్యం' });
  assert.equal(removed.status, 200);
  assert.deepEqual(await removed.json(), { entries: [] });
  assert.equal((await request('001', 'DELETE', { text: 42 })).status, 400);
  assert.equal((await app.request('/api/profiles/001/blacklist', {
    method: 'POST', headers: { Origin: 'https://other.example', Host: 'localhost' }, body: '{"text":"Blocked"}',
  })).status, 403);
  assert.equal((await app.request('/api/profiles/001/blacklist', { method: 'POST', body: 'x'.repeat(8193) })).status, 413);
});
