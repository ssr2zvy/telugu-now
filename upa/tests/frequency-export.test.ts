import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import {
  generateFrequencyExport,
  getAvailableFrequencyOccurrences,
  InvalidFrequencyExportRequestError,
} from '../server/src/services/frequency-export-service';
import { clean_word, token_spans } from '../server/src/services/telugu-tokenizer';

function fixture(): { directory: string; databasePath: string } {
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
  return { directory, databasePath };
}

function zipEntries(archive: Uint8Array): Map<string, string> {
  const entries = new Map<string, string>();
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  let offset = 0;
  while (view.getUint32(offset, true) === 0x04034b50) {
    const size = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const name = new TextDecoder().decode(archive.subarray(nameStart, nameStart + nameLength));
    entries.set(name, new TextDecoder().decode(archive.subarray(dataStart, dataStart + size)));
    offset = dataStart + size;
  }
  return entries;
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

test('frequency ZIP preserves deterministic sample mappings and complete totals', () => {
  const { directory, databasePath } = fixture();
  try {
    assert.equal(getAvailableFrequencyOccurrences(databasePath), 6);
    const entries = zipEntries(generateFrequencyExport(
      { occurrenceLimit: 4, frequencyLimit: null },
      databasePath,
      new Date('2026-09-20T00:00:00.000Z'),
    ));
    assert.deepEqual([...entries.keys()], [
      'frequencies.csv', 'occurrences.csv', 'transcripts.csv', 'sources.csv', 'metadata.json',
    ]);
    assert.match(entries.get('frequencies.csv')!, /"1","తెలుగు","2"\r\n"2","చివరి","1"\r\n"3","మాట","1"/u);
    const occurrenceLines = entries.get('occurrences.csv')!.trim().split('\r\n');
    assert.equal(occurrenceLines.length, 5);
    assert.match(occurrenceLines[1]!, /"1","source-a","record-1","0","2","8","తెలుగు","తెలుగు"/u);
    assert.match(occurrenceLines[3]!, /"3","source-a","record-1","4","29","32","మాట","మాట"/u);
    const metadata = JSON.parse(entries.get('metadata.json')!) as any;
    assert.equal(metadata.counts.availableAcceptedOccurrences, 6);
    assert.equal(metadata.counts.actualProcessedOccurrences, 4);
    assert.equal(metadata.counts.contributingTranscripts, 2);
    assert.equal(metadata.counts.fullSampleVocabularySize, 3);
    assert.equal(metadata.frequencyListComplete, true);
    assert.equal(metadata.validation.completeFrequencyTotal, 4);
    assert.equal(metadata.validation.occurrenceMappingRows, 4);
    assert.equal(metadata.exportedAt, '2026-09-20T00:00:00.000Z');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('top-X is the exact complete-ranking prefix and oversized samples report actual totals', () => {
  const { directory, databasePath } = fixture();
  try {
    const complete = zipEntries(generateFrequencyExport(
      { occurrenceLimit: 999, frequencyLimit: null }, databasePath,
    ));
    const top = zipEntries(generateFrequencyExport(
      { occurrenceLimit: 999, frequencyLimit: 2 }, databasePath,
    ));
    const completeRows = complete.get('frequencies.csv')!.trim().split('\r\n');
    const topRows = top.get('frequencies.csv')!.trim().split('\r\n');
    assert.deepEqual(topRows, completeRows.slice(0, 3));
    const metadata = JSON.parse(top.get('metadata.json')!) as any;
    assert.equal(metadata.counts.actualProcessedOccurrences, 6);
    assert.equal(metadata.counts.exportedFrequencyRows, 2);
    assert.equal(metadata.frequencyListComplete, false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('frequency export rejects non-positive and non-integer limits', () => {
  assert.throws(
    () => generateFrequencyExport({ occurrenceLimit: 0, frequencyLimit: 1 }, 'unused'),
    InvalidFrequencyExportRequestError,
  );
  assert.throws(
    () => generateFrequencyExport({ occurrenceLimit: 1, frequencyLimit: 1.5 }, 'unused'),
    InvalidFrequencyExportRequestError,
  );
});
