import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomInt } from 'node:crypto';
import test from 'node:test';
import Database from 'better-sqlite3';
import {
  generateFrequencyExport,
  getAvailableFrequencyOccurrences,
  InvalidFrequencyExportRequestError,
} from '../server/src/services/frequency-export-service';
import {
  ensureFrequencyIndex,
  openFrequencyIndex,
  refreshFrequencyIndex,
} from '../server/src/services/frequency-index';
import { config } from '../server/src/config/config';
import { clean_word, token_spans } from '../server/src/services/telugu-tokenizer';

function fixture(): { directory: string; databasePath: string; frequencyPath: string } {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'frequency-export-'));
  const databasePath = path.join(directory, 'corpus.sqlite');
  const database = new Database(databasePath);
  database.exec(`
    CREATE TABLE sources (
      source_id TEXT PRIMARY KEY, display_name TEXT NOT NULL, provider TEXT NOT NULL,
      license TEXT NOT NULL, upstream_url TEXT, catalog_version INTEGER NOT NULL,
      status TEXT NOT NULL
    );
    CREATE TABLE source_rows (
      source_id TEXT NOT NULL, source_key TEXT NOT NULL, text TEXT NOT NULL,
      audio_object_key TEXT NOT NULL, source_metadata_json TEXT NOT NULL,
      PRIMARY KEY (source_id, source_key)
    );
    INSERT INTO sources VALUES
      ('source-b', 'Source B', 'Provider B', 'License B', NULL, 2, 'ready'),
      ('source-a', 'Source A', 'Provider A', 'License A', 'https://example.test/a', 1, 'ready');
    INSERT INTO source_rows VALUES
      ('source-b', 'record-1', 'పదం మరో', 'media/b.flac', '{"id":"b-1"}'),
      ('source-a', 'record-2', 'చివరి', 'media/a2.wav', '{}'),
      ('source-a', 'record-1', '😀 తెలుగు తెలుగు 12 abcతెలుగు మాట', 'media/a1.wav', '{"sentenceId":"a-1"}');
  `);
  database.close();
  const frequencyPath = `${databasePath}.frequency.sqlite`;
  refreshFrequencyIndex({ corpusDatabasePath: databasePath, corpusFrequencyPath: frequencyPath });
  return { directory, databasePath, frequencyPath };
}

function csvRows(csv: Uint8Array): string[] {
  return new TextDecoder().decode(csv).replace(/^\uFEFF/u, '').trim().split('\r\n');
}


test('Wikipedia-compatible tokenizer keeps Telugu surface forms and original code-point offsets', () => {
  const spans = token_spans('😀 తెలుగు 12 abcతెలుగు మాట');
  assert.deepEqual(spans.map(span => [span.token, span.start, span.end]), [
    ['తెలుగు', 2, 8],
    ['12', 9, 11],
    ['abcతెలుగు', 12, 21],
    ['మాట', 22, 25],
  ]);
  assert.equal(clean_word(spans[0]!.token), 'తెలుగు');
  assert.equal(clean_word(spans[1]!.token), null);
  assert.equal(clean_word(spans[2]!.token), null);
  assert.equal(clean_word(spans[3]!.token), 'మాట');
});

test('frequency snapshot persists accepted occurrences, locations and whole-corpus counts', () => {
  const { directory, databasePath, frequencyPath } = fixture();
  try {
    const index = openFrequencyIndex({ corpusDatabasePath: databasePath, corpusFrequencyPath: frequencyPath });
    assert.ok(index);
    assert.deepEqual(index.prepare(`
      SELECT normalized_word, occurrence_count FROM frequencies
      ORDER BY occurrence_count DESC, normalized_word ASC
    `).all(), [
      { normalized_word: 'తెలుగు', occurrence_count: 2 },
      { normalized_word: 'చివరి', occurrence_count: 1 },
      { normalized_word: 'పదం', occurrence_count: 1 },
      { normalized_word: 'మరో', occurrence_count: 1 },
      { normalized_word: 'మాట', occurrence_count: 1 },
    ]);
    assert.deepEqual(index.prepare(`
      SELECT source_id, source_key, token_ordinal, start_offset, end_offset
      FROM occurrences WHERE normalized_word = 'మాట'
    `).get(), {
      source_id: 'source-a', source_key: 'record-1', token_ordinal: 4,
      start_offset: 29, end_offset: 32,
    });

    index.close();
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('frequency snapshot rejects a replaced canonical database even with preserved size and modification time', () => {
  const { directory, databasePath, frequencyPath } = fixture();
  try {
    const bytes = fs.readFileSync(databasePath);
    const modified = fs.statSync(databasePath).mtime;
    fs.unlinkSync(databasePath);
    fs.writeFileSync(databasePath, bytes);
    fs.utimesSync(databasePath, modified, modified);
    assert.equal(openFrequencyIndex({ corpusDatabasePath: databasePath, corpusFrequencyPath: frequencyPath }), null);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('frequency startup reuses a compatible snapshot and removes interrupted builds', () => {
  const { directory, databasePath, frequencyPath } = fixture();
  try {
    const index = openFrequencyIndex({ corpusDatabasePath: databasePath, corpusFrequencyPath: frequencyPath });
    assert.ok(index);
    const generation = index.prepare('SELECT generation FROM metadata').pluck().get();
    index.close();
    const stale = `${frequencyPath}.00000000-0000-4000-8000-000000000000.pending`;
    fs.writeFileSync(stale, 'stale');

    ensureFrequencyIndex({ corpusDatabasePath: databasePath, corpusFrequencyPath: frequencyPath }, true);

    assert.equal(fs.existsSync(stale), false);
    const reused = openFrequencyIndex({ corpusDatabasePath: databasePath, corpusFrequencyPath: frequencyPath });
    assert.ok(reused);
    assert.equal(reused.prepare('SELECT generation FROM metadata').pluck().get(), generation);
    reused.close();
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('frequency startup replaces a corrupt snapshot when rebuilding is enabled', () => {
  const { directory, databasePath, frequencyPath } = fixture();
  try {
    fs.writeFileSync(frequencyPath, 'not sqlite');
    assert.throws(
      () => ensureFrequencyIndex({ corpusDatabasePath: databasePath, corpusFrequencyPath: frequencyPath }),
    );

    ensureFrequencyIndex({ corpusDatabasePath: databasePath, corpusFrequencyPath: frequencyPath }, true);

    const rebuilt = openFrequencyIndex({ corpusDatabasePath: databasePath, corpusFrequencyPath: frequencyPath });
    assert.ok(rebuilt);
    assert.equal(rebuilt.prepare('SELECT total_occurrences FROM metadata').pluck().get(), 6);
    rebuilt.close();
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('frequency CSV preserves deterministic sample mappings and complete totals', () => {
  const { directory, databasePath, frequencyPath } = fixture();
  try {
    assert.equal(getAvailableFrequencyOccurrences({ corpusDatabasePath: databasePath, corpusFrequencyPath: frequencyPath }), 6);
    const rows = csvRows(generateFrequencyExport(
      { occurrenceLimit: 4 },
      databasePath,
      () => 0,
      frequencyPath,
    ));
    assert.deepEqual(rows[0], '"word","frequency"');
    assert.equal(rows.length, 1 + 4);
    assert.match(rows.join('\n'), /"పదం","1"/u);
    const total = rows.slice(1).reduce((sum, row) => sum + Number(row.split(',')[1]!.replaceAll('"', '')), 0);
    assert.equal(total, 4);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('oversized samples include every occurrence and every sampled frequency row', () => {
  const { directory, databasePath, frequencyPath } = fixture();
  try {
    const rows = csvRows(generateFrequencyExport(
      { occurrenceLimit: 999 }, databasePath, randomInt, frequencyPath,
    ));
    assert.equal(rows.length, 1 + 5);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('occurrence limits select a random sample without replacement', () => {
  const { directory, databasePath, frequencyPath } = fixture();
  try {
    const low = csvRows(generateFrequencyExport(
      { occurrenceLimit: 2 }, databasePath, () => 0, frequencyPath,
    )).slice(1);
    const high = csvRows(generateFrequencyExport(
      { occurrenceLimit: 2 }, databasePath, maximum => maximum - 1, frequencyPath,
    )).slice(1);
    assert.notDeepEqual(low, high);
    for (const rows of [low, high]) {
      const total = rows.reduce((sum, row) => sum + Number(row.split(',')[1]!.replaceAll('"', '')), 0);
      assert.equal(total, 2);
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('frequency export rejects invalid and memory-unsafe limits', () => {
  assert.throws(
    () => generateFrequencyExport({ occurrenceLimit: 0 }, 'unused'),
    InvalidFrequencyExportRequestError,
  );
  assert.throws(
    () => generateFrequencyExport({ occurrenceLimit: 1.5 }, 'unused'),
    InvalidFrequencyExportRequestError,
  );
  assert.throws(
    () => generateFrequencyExport({ occurrenceLimit: config.maxFrequencyExportOccurrences + 1 }, 'unused'),
    InvalidFrequencyExportRequestError,
  );
});

test('settings expose one occurrence sampling control', () => {
  const root = path.resolve(import.meta.dirname, '..');
  const navigation = fs.readFileSync(path.join(root, 'frontend/src/settings/navigation.ts'), 'utf8');
  const view = fs.readFileSync(path.join(root, 'frontend/src/settings/SettingsView.tsx'), 'utf8');
  const page = fs.readFileSync(path.join(root, 'frontend/src/settings/pages/FrequencyExportPage.tsx'), 'utf8');
  assert.match(navigation, /'frequencyExport'/u);
  assert.match(view, /<FrequencyExportPage language=\{language\}/u);
  assert.match(page, /Math\.min\(available \?\? 0, maximum \?\? 0\)/u);
  assert.doesNotMatch(page, /frequencyLimit/u);
  assert.match(page, /downloadFrequencyExport/u);
});
