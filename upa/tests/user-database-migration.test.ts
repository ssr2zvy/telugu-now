import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import Database from 'better-sqlite3';
import { migrateUserDatabase } from '../server/src/db/migrate-user-database';

function fixture(t: test.TestContext) {
  const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../test-results', `user-migration-${randomUUID()}`);
  fs.mkdirSync(directory, { recursive: true });
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return { directory, legacyPath: path.join(directory, 'users.sqlite'), target: path.join(directory, 'user/users.sqlite') };
}

test('migration includes committed WAL records and retains original user state and images', (t) => {
  const { directory, legacyPath, target } = fixture(t);
  const legacy = new Database(legacyPath);
  try {
    legacy.pragma('journal_mode = WAL');
    legacy.pragma('wal_autocheckpoint = 0');
    legacy.exec(`
      CREATE TABLE profiles (code TEXT PRIMARY KEY, preferences TEXT);
      CREATE TABLE history (profile TEXT, position INTEGER, text TEXT);
      CREATE TABLE word_images (root TEXT PRIMARY KEY, image BLOB);
      CREATE INDEX history_profile ON history(profile);
      PRAGMA user_version = 7;
      INSERT INTO profiles VALUES ('001', '{"theme":"dark"}');
      INSERT INTO history VALUES ('001', 3, 'తెలుగు');
      INSERT INTO word_images VALUES ('root', X'000102FF');
    `);
    assert.ok(fs.statSync(`${legacyPath}-wal`).size > 0);
    assert.equal(migrateUserDatabase(directory, target, false), true);
    const migrated = new Database(target, { readonly: true });
    try {
      assert.deepEqual(migrated.prepare('SELECT * FROM profiles').all(), legacy.prepare('SELECT * FROM profiles').all());
      assert.deepEqual(migrated.prepare('SELECT * FROM history').all(), legacy.prepare('SELECT * FROM history').all());
      assert.deepEqual(migrated.prepare('SELECT * FROM word_images').all(), legacy.prepare('SELECT * FROM word_images').all());
      assert.equal(migrated.pragma('user_version', { simple: true }), 7);
      assert.equal(migrated.pragma('integrity_check', { simple: true }), 'ok');
      assert.ok(migrated.prepare("SELECT 1 FROM sqlite_master WHERE name = 'history_profile'").get());
    } finally {
      migrated.close();
    }
    assert.ok(fs.existsSync(legacyPath));
    assert.deepEqual(fs.readdirSync(path.dirname(target)), ['users.sqlite']);
    assert.equal(migrateUserDatabase(directory, target, false), false);
  } finally {
    legacy.close();
  }
});

test('migration never overwrites an existing target or acts for an explicit override', (t) => {
  const { directory, legacyPath, target } = fixture(t);
  const legacy = new Database(legacyPath);
  legacy.exec('CREATE TABLE marker (value TEXT); INSERT INTO marker VALUES (\'old\')');
  legacy.close();
  assert.equal(migrateUserDatabase(directory, target, true), false);
  assert.equal(fs.existsSync(target), false);
  assert.equal(migrateUserDatabase(directory, path.join(directory, 'custom.sqlite'), false), false);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const current = new Database(target);
  current.exec('CREATE TABLE marker (value TEXT); INSERT INTO marker VALUES (\'current\')');
  current.close();
  const bytes = fs.readFileSync(target);
  assert.equal(migrateUserDatabase(directory, target, false), false);
  assert.deepEqual(fs.readFileSync(target), bytes);
});

test('migration handles absent legacy data and fails safely for corrupt input or orphaned WAL', (t) => {
  const { directory, legacyPath, target } = fixture(t);
  assert.equal(migrateUserDatabase(directory, target, false), false);
  fs.writeFileSync(legacyPath, 'not a SQLite database');
  assert.throws(() => migrateUserDatabase(directory, target, false));
  assert.equal(fs.existsSync(target), false);
  assert.equal(fs.readFileSync(legacyPath, 'utf8'), 'not a SQLite database');
  assert.deepEqual(fs.readdirSync(path.dirname(target)), []);
  fs.writeFileSync(`${target}-wal`, 'preserve');
  assert.throws(() => migrateUserDatabase(directory, target, false), /sidecars already exist/);
  assert.equal(fs.readFileSync(`${target}-wal`, 'utf8'), 'preserve');
});
