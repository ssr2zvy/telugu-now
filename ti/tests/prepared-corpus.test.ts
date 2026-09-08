import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import { PreparedCorpusStore } from '../server/src/sources/prepared-corpus/prepared-corpus-store';
import { PreparedCorpusDataSource } from '../server/src/sources/prepared-corpus/prepared-corpus-data-source';

test('prepared corpus store and data source expose indexed metadata', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'telugu-prepared-'));
  const databasePath = path.join(directory, 'corpus.sqlite');
  const db = new Database(databasePath);
  try {
    db.exec(`CREATE TABLE sources (source_id TEXT PRIMARY KEY, display_name TEXT NOT NULL, provider TEXT NOT NULL, license TEXT NOT NULL, upstream_url TEXT, catalog_version INTEGER NOT NULL, accepted_rows INTEGER NOT NULL, rejected_rows INTEGER NOT NULL, complexity_metric TEXT NOT NULL, status TEXT NOT NULL); CREATE TABLE source_rows (source_id TEXT NOT NULL, source_key TEXT NOT NULL, text TEXT NOT NULL, grapheme_count INTEGER NOT NULL, audio_sha256 TEXT NOT NULL, audio_object_key TEXT NOT NULL, audio_mime_type TEXT NOT NULL, duration_seconds REAL NOT NULL, PRIMARY KEY(source_id, source_key)); CREATE TABLE source_complexity_members (source_id TEXT NOT NULL, grapheme_count INTEGER NOT NULL, class_index INTEGER NOT NULL, source_key TEXT NOT NULL, PRIMARY KEY(source_id, grapheme_count, class_index));`);
    db.prepare('INSERT INTO sources VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run('fleurs-te', 'FLEURS', 'Google', 'CC BY 4.0', 'https://example.test/fleurs', 1, 1, 0, 'grapheme-count', 'ready');
    db.prepare('INSERT INTO source_rows VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run('fleurs-te', 'train:a.wav', 'తెలుగు', 2, 'sha', 'media/fleurs-te/audio/sha.wav', 'audio/wav', 1);
    db.prepare('INSERT INTO source_complexity_members VALUES (?, ?, ?, ?)').run('fleurs-te', 2, 0, 'train:a.wav');
    db.close();
    const store = new PreparedCorpusStore(databasePath);
    assert.equal(store.hasSource('fleurs-te'), true);
    assert.equal(store.rowCount('fleurs-te'), 1);
    assert.deepEqual(store.complexityClasses('fleurs-te'), [{ complexityValue: 2, rowCount: 1 }]);
    assert.equal(store.sourceKeyAt('fleurs-te', 2, 0), 'train:a.wav');
    assert.throws(() => store.sourceKeyAt('fleurs-te', 2, 1), /CORPUS_SOURCE_KEY_MISSING/);
    assert.equal(store.sourceInfo('fleurs-te').provider, 'Google');
    const source = new PreparedCorpusDataSource('fleurs-te', store);
    assert.deepEqual(source.candidateAt(2, 0), { sourceKey: 'train:a.wav', complexityValue: 2 });
    return source.prepare('train:a.wav').then((observation) => assert.deepEqual(observation.media.map((item) => item.kind), ['text', 'audio']));
  } finally {
    try { db.close(); } catch { /* already closed */ }
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
