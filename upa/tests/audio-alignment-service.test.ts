import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { Hono } from 'hono';
import { audioAlignmentRoutes, type AudioAlignmentEngine } from '../server/src/services/audio-alignment-service';

function fixtureDatabase(): Database.Database {
  const database = new Database(':memory:');
  database.exec(`
    CREATE TABLE profiles (code TEXT PRIMARY KEY);
    CREATE TABLE observations (
      id TEXT PRIMARY KEY, source_id TEXT NOT NULL, source_key TEXT NOT NULL,
      status TEXT NOT NULL, text TEXT
    );
    CREATE TABLE observation_acquisitions (observation_id TEXT PRIMARY KEY, profile_code TEXT NOT NULL);
    CREATE TABLE source_records (
      profile_code TEXT NOT NULL, source_id TEXT NOT NULL, source_key TEXT NOT NULL,
      text TEXT NOT NULL, media_json TEXT NOT NULL,
      PRIMARY KEY (profile_code, source_id, source_key)
    );
    INSERT INTO profiles VALUES ('001');
    INSERT INTO observations VALUES ('observation-1', 'fixture', 'sentence-1', 'ready', 'ఈ కోసం కోసం');
    INSERT INTO observation_acquisitions VALUES ('observation-1', '001');
  `);
  database.prepare('INSERT INTO source_records VALUES (?, ?, ?, ?, ?)').run(
    '001', 'fixture', 'sentence-1', 'ఈ కోసం కోసం', JSON.stringify([
      { kind: 'text', language: 'te', text: 'ఈ కోసం కోసం' },
      { kind: 'audio', objectKey: 'media/fixture/sentence.wav', mimeType: 'audio/wav', durationSeconds: 4, sha256: 'audio-sha' },
    ]),
  );
  return database;
}

function targetWords(text: string) {
  return [...new Intl.Segmenter('te', { granularity: 'word' }).segment(text)].filter(segment => segment.isWordLike);
}

function engine(calls: { sentence: number; word: number }): AudioAlignmentEngine {
  return {
    alignSentence: async ({ words }) => {
      calls.sentence++;
      return { words: words.map((word, index) => ({
        ...word, startSeconds: index * .5, endSeconds: index * .5 + .5, status: 'estimated' as const,
      })) };
    },
    alignWord: async ({ writtenUnits }) => {
      calls.word++;
      return {
        status: 'estimated',
        writtenUnits: writtenUnits.map((unit, index) => ({
          ...unit, startSeconds: index * .2, endSeconds: index * .2 + .2, status: 'estimated' as const,
        })),
        phonemes: [],
      };
    },
  };
}

test('alignment routes cache by recording and target exact repeated word and grapheme occurrences', async () => {
  const database = fixtureDatabase();
  const calls = { sentence: 0, word: 0 };
  const app = new Hono().route('/api/profiles', audioAlignmentRoutes(database, {
    profileCodes: new Set(['001']), engine: engine(calls),
    withAudioFile: async (_key, run) => run('/fixture/sentence.wav'),
  }));
  try {
    const words = targetWords('ఈ కోసం కోసం');
    const selectedWord = words[2]!;
    const request = () => app.request('/api/profiles/001/alignments/word', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ observationId: 'observation-1', wordStart: selectedWord.index, wordEnd: selectedWord.index + selectedWord.segment.length }),
    });
    const first = await request();
    assert.equal(first.status, 200);
    assert.deepEqual(await first.json(), {
      index: 2, text: 'కోసం', transcriptStart: selectedWord.index, transcriptEnd: selectedWord.index + selectedWord.segment.length,
      status: 'estimated',
      audio: { url: '/api/audio/media/fixture/sentence.wav?v=2#t=1.000000,1.500000', mimeType: 'audio/wav', durationSeconds: .5 },
    });
    assert.equal((await request()).status, 200);
    assert.equal(calls.sentence, 1);

    const units = [...new Intl.Segmenter('te', { granularity: 'grapheme' }).segment('కోసం')];
    const selectedUnit = units[1]!;
    const letterRequest = () => app.request('/api/profiles/001/alignments/letter', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        observationId: 'observation-1', wordStart: selectedWord.index, wordEnd: selectedWord.index + selectedWord.segment.length,
        graphemeStart: selectedUnit.index, graphemeEnd: selectedUnit.index + selectedUnit.segment.length,
      }),
    });
    const letter = await letterRequest();
    assert.equal(letter.status, 200);
    assert.deepEqual(await letter.json(), {
      text: 'సం', word: 'కోసం', graphemeIndex: 1, status: 'estimated',
      audio: { url: '/api/audio/media/fixture/sentence.wav?v=2#t=1.200000,1.400000', mimeType: 'audio/wav', durationSeconds: .2 },
      sourceId: 'fixture', sourceKey: `sentence-1:${selectedWord.index}-${selectedWord.index + selectedWord.segment.length}:${selectedUnit.index}-${selectedUnit.index + selectedUnit.segment.length}`,
    });
    assert.equal((await letterRequest()).status, 200);
    assert.deepEqual(calls, { sentence: 1, word: 1 });
    assert.equal((database.prepare('SELECT COUNT(*) AS count FROM sentence_audio_alignments').get() as { count: number }).count, 1);
    assert.equal((database.prepare('SELECT COUNT(*) AS count FROM word_audio_alignments').get() as { count: number }).count, 1);
  } finally {
    database.close();
  }
});

test('alignment requests reject ranges that do not identify exact transcript units', async () => {
  const database = fixtureDatabase();
  const calls = { sentence: 0, word: 0 };
  const app = new Hono().route('/api/profiles', audioAlignmentRoutes(database, {
    profileCodes: new Set(['001']), engine: engine(calls),
    withAudioFile: async (_key, run) => run('/fixture/sentence.wav'),
  }));
  try {
    const response = await app.request('/api/profiles/001/alignments/word', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ observationId: 'observation-1', wordStart: 1, wordEnd: 3 }),
    });
    assert.equal(response.status, 400);
    assert.deepEqual(calls, { sentence: 0, word: 0 });
  } finally {
    database.close();
  }
});
