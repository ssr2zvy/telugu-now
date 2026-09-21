import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { Hono } from 'hono';
import { graphemeWordRoutes, selectGraphemeWord } from '../server/src/services/grapheme-word-service';
import type { CorpusGraphemeWord } from '../server/src/sources/prepared-corpus/prepared-corpus-store';

function candidate(word: string, complexity: number, sourceKey = word): CorpusGraphemeWord {
  return {
    word, complexity, wordGraphemeCount: [...new Intl.Segmenter('te', { granularity: 'grapheme' }).segment(word)].length,
    sourceId: 'fixture', sourceKey,
    audioObjectKey: `media/${sourceKey}.wav`, audioMimeType: 'audio/wav', durationSeconds: 1.25,
  };
}

function database(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE profiles (code TEXT PRIMARY KEY);
    INSERT INTO profiles VALUES ('001');
    CREATE TABLE profile_blacklisted_sentences (
      profile_code TEXT NOT NULL, text TEXT NOT NULL, created_at INTEGER NOT NULL,
      PRIMARY KEY (profile_code, text)
    );
  `);
  return db;
}

test('grapheme word selection always uses the closest eligible word', () => {
  const candidates = [candidate('కకకకకకకకకక', 10, 'best-recording'), candidate('కకకకకకకకకక', 30, 'duplicate-recording'),
    candidate('కకకకకకకకక', 9), candidate('క', 1)];
  assert.equal(selectGraphemeWord(candidates, new Set())?.complexity, 10);
  assert.equal(selectGraphemeWord(candidates, new Set())?.sourceKey, 'best-recording');
  assert.equal(selectGraphemeWord(candidates, new Set(['కకకకకకకకకక']))?.complexity, 9);
  assert.equal(selectGraphemeWord([candidate('క', 1)], new Set(['క']))?.word, 'క');
});

test('grapheme word route returns corpus audio and respects profile blacklist', async () => {
  const db = database();
  const candidates = [candidate('పదములలోనే', 10, 'closest'), candidate('మరొకపదము', 9, 'next')];
  try {
    db.prepare('INSERT INTO profile_blacklisted_sentences VALUES (?, ?, ?)').run('001', 'పదములలోనే', 1);
    const app = new Hono().route('/api/profiles', graphemeWordRoutes(db, {
      profileCodes: new Set(['001']), corpus: { wordsContaining: grapheme => grapheme === 'ము' ? candidates : [] },
    }));
    const response = await app.request('/api/profiles/001/grapheme-word', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grapheme: 'ము' }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      word: 'మరొకపదము', complexity: 9, wordGraphemeCount: 6, sourceId: 'fixture', sourceKey: 'next',
      audio: { url: '/api/audio/media/next.wav?v=2', mimeType: 'audio/wav', durationSeconds: 1.25 },
    });
    assert.equal((await app.request('/api/profiles/001/grapheme-word', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grapheme: 'ముక' }),
    })).status, 400);
  } finally { db.close(); }
});