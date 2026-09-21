import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import { PreparedCorpusStore } from '../server/src/sources/prepared-corpus/prepared-corpus-store';
import { PreparedCorpusDataSource } from '../server/src/sources/prepared-corpus/prepared-corpus-data-source';
import { refreshAvailability } from '../server/src/services/corpus-availability';

test('prepared corpus store and data source expose indexed metadata', async () => {
  fs.mkdirSync(path.join(process.cwd(), 'test-results'), { recursive: true });
  const directory = fs.mkdtempSync(path.join(process.cwd(), 'test-results/telugu-prepared-'));
  const databasePath = path.join(directory, 'corpus.sqlite');
  const db = new Database(databasePath);
  db.pragma('foreign_keys = ON');
  try {
    db.exec(`
      CREATE TABLE sources (
        source_id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        provider TEXT NOT NULL,
        license TEXT NOT NULL,
        upstream_url TEXT,
        catalog_version INTEGER NOT NULL,
        accepted_rows INTEGER NOT NULL,
        rejected_rows INTEGER NOT NULL,
        complexity_metric TEXT NOT NULL,
        status TEXT NOT NULL
          CHECK(
            status IN (
              'ready',
              'fixture',
              'invalid'
            )
          )
      );
      CREATE TABLE source_rows (
        source_id TEXT NOT NULL,
        source_key TEXT NOT NULL,
        canonical_split TEXT NOT NULL,
        upstream_split TEXT NOT NULL,
        text TEXT NOT NULL,
        grapheme_count INTEGER NOT NULL
          CHECK(grapheme_count > 0),
        text_sha256 TEXT NOT NULL,
        audio_sha256 TEXT NOT NULL,
        audio_object_key TEXT NOT NULL,
        audio_mime_type TEXT NOT NULL,
        duration_seconds REAL NOT NULL
          CHECK(duration_seconds > 0),
        source_metadata_json TEXT NOT NULL,
        PRIMARY KEY(
          source_id,
          source_key
        ),
        FOREIGN KEY(source_id)
          REFERENCES sources(source_id)
      );
      CREATE TABLE source_complexity_members (
        source_id TEXT NOT NULL,
        grapheme_count INTEGER NOT NULL,
        class_index INTEGER NOT NULL,
        source_key TEXT NOT NULL,
        PRIMARY KEY(
          source_id,
          grapheme_count,
          class_index
        ),
        UNIQUE(
          source_id,
          source_key
        ),
        FOREIGN KEY(
          source_id,
          source_key
        )
          REFERENCES source_rows(
            source_id,
            source_key
          )
      );
      CREATE INDEX idx_source_rows_complexity
        ON source_rows(
          source_id,
          grapheme_count
        );
    `);
    const insertSource = db.prepare(`
      INSERT INTO sources (
        source_id,
        display_name,
        provider,
        license,
        upstream_url,
        catalog_version,
        accepted_rows,
        rejected_rows,
        complexity_metric,
        status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertRow = db.prepare(`
      INSERT INTO source_rows (
        source_id,
        source_key,
        canonical_split,
        upstream_split,
        text,
        grapheme_count,
        text_sha256,
        audio_sha256,
        audio_object_key,
        audio_mime_type,
        duration_seconds,
        source_metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertMember = db.prepare(`
      INSERT INTO source_complexity_members (
        source_id,
        grapheme_count,
        class_index,
        source_key
      ) VALUES (?, ?, ?, ?)
    `);
    const readySources = [
      {
        sourceId: 'fleurs-te',
        displayName: 'FLEURS',
        provider: 'Google',
        upstreamUrl:
          'https://huggingface.co/datasets/google/fleurs',
        sourceKey: 'train:fleurs.wav',
        audioSha: 'fleurs-audio-sha',
        objectKey:
          'media/fleurs-te/audio/fleurs-audio-sha.wav',
        mimeType: 'audio/wav',
      },
      {
        sourceId: 'shrutilipi-te',
        displayName: 'Shrutilipi',
        provider: 'AI4Bharat',
        upstreamUrl:
          'https://huggingface.co/datasets/ai4bharat/Shrutilipi',
        sourceKey: 'train:shrutilipi.flac',
        audioSha: 'shrutilipi-audio-sha',
        objectKey:
          'media/shrutilipi-te/audio/shrutilipi-audio-sha.flac',
        mimeType: 'audio/flac',
      },
      {
        sourceId: 'indicvoices-te',
        displayName: 'IndicVoices',
        provider: 'AI4Bharat',
        upstreamUrl:
          'https://huggingface.co/datasets/ai4bharat/IndicVoices',
        sourceKey: 'train:indicvoices.flac',
        audioSha: 'indicvoices-audio-sha',
        objectKey:
          'media/indicvoices-te/audio/indicvoices-audio-sha.flac',
        mimeType: 'audio/flac',
      },
    ] as const;
    for (const source of readySources) {
      insertSource.run(
        source.sourceId,
        source.displayName,
        source.provider,
        'CC BY 4.0',
        source.upstreamUrl,
        1,
        1,
        source.sourceId === 'fleurs-te'
          ? 2
          : 0,
        'grapheme-count',
        'ready',
      );
      insertRow.run(
        source.sourceId,
        source.sourceKey,
        'train',
        'train',
        'తెలుగు',
        2,
        'text-sha',
        source.audioSha,
        source.objectKey,
        source.mimeType,
        1.25,
        '{}',
      );
      insertMember.run(
        source.sourceId,
        2,
        0,
        source.sourceKey,
      );
    }
    insertSource.run(
      'invalid-status',
      'Invalid status',
      'test',
      'test',
      null,
      1,
      1,
      0,
      'grapheme-count',
      'invalid',
    );
    insertSource.run(
      'wrong-metric',
      'Wrong metric',
      'test',
      'test',
      null,
      1,
      1,
      0,
      'word-count',
      'ready',
    );
    insertSource.run(
      'zero-accepted',
      'Zero accepted',
      'test',
      'test',
      null,
      1,
      0,
      0,
      'grapheme-count',
      'ready',
    );
    db.close();
    const options = {
      corpusDatabasePath: databasePath,
      corpusAvailabilityPath: path.join(directory, 'availability.sqlite'),
      corpusObjectsPath: path.join(directory, 'objects'),
      corpusObjectsPrefix: 'corpus/objects/',
      corpusBackend: 'local',
    };
    for (const source of readySources) {
      const file = path.join(options.corpusObjectsPath, source.objectKey);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, 'audio');
    }
    await refreshAvailability(options);
    const store = new PreparedCorpusStore(databasePath, options);
    assert.equal(
      store.hasSource('fleurs-te'),
      true,
    );
    assert.equal(
      store.hasSource('shrutilipi-te'),
      true,
    );
    assert.equal(
      store.hasSource('indicvoices-te'),
      true,
    );
    assert.equal(
      store.hasSource('invalid-status'),
      false,
    );
    assert.equal(
      store.hasSource('wrong-metric'),
      false,
    );
    assert.equal(
      store.hasSource('zero-accepted'),
      false,
    );
    assert.equal(
      store.hasSource('missing-source'),
      false,
    );
    assert.deepEqual(
      store.sourceInfo('fleurs-te'),
      {
        sourceId: 'fleurs-te',
        displayName: 'FLEURS',
        provider: 'Google',
        license: 'CC BY 4.0',
        upstreamUrl:
          'https://huggingface.co/datasets/google/fleurs',
        catalogVersion: 1,
        acceptedRows: 1,
        rejectedRows: 2,
        complexityMetric:
          'grapheme-count',
        status: 'ready',
      },
    );
    assert.equal(
      store.rowCount('fleurs-te'),
      1,
    );
    assert.deepEqual(
      store.complexityClasses(
        'fleurs-te',
      ),
      [
        {
          complexityValue: 2,
          rowCount: 1,
        },
      ],
    );
    assert.equal(
      store.sourceKeyAt(
        'fleurs-te',
        2,
        0,
      ),
      'train:fleurs.wav',
    );
    assert.throws(
      () =>
        store.sourceKeyAt(
          'fleurs-te',
          2,
          1,
        ),
      /CORPUS_SOURCE_KEY_MISSING/,
    );
    assert.deepEqual(
      store.row(
        'fleurs-te',
        'train:fleurs.wav',
      ),
      {
        source_id: 'fleurs-te',
        source_key: 'train:fleurs.wav',
        text: 'తెలుగు',
        grapheme_count: 2,
        audio_sha256:
          'fleurs-audio-sha',
        audio_object_key:
          'media/fleurs-te/audio/fleurs-audio-sha.wav',
        audio_mime_type:
          'audio/wav',
        duration_seconds: 1.25,
      },
    );
    assert.equal(store.wordsContaining('తె').length, 3);
    assert.ok(store.wordsContaining('తె').every(match => match.word === 'తెలుగు'
      && match.complexity === 2 && match.wordGraphemeCount === 3));
    assert.deepEqual(store.wordsContaining('త'), []);
    assert.throws(
      () =>
        store.sourceInfo(
          'missing-source',
        ),
      /CORPUS_SOURCE_MISSING/,
    );
    assert.throws(
      () =>
        store.row(
          'fleurs-te',
          'missing-row',
        ),
      /CORPUS_ROW_MISSING/,
    );
    const source =
      new PreparedCorpusDataSource(
        'fleurs-te',
        store,
      );
    assert.deepEqual(
      source.candidateAt(2, 0),
      {
        sourceKey:
          'train:fleurs.wav',
        complexityValue: 2,
      },
    );
    await source
      .prepare('train:fleurs.wav')
      .then((observation) => {
        assert.equal(
          observation.text,
          'తెలుగు',
        );
        assert.deepEqual(
          observation.media,
          [
            {
              kind: 'text',
              language: 'te',
              text: 'తెలుగు',
            },
            {
              kind: 'audio',
              objectKey:
                'media/fleurs-te/audio/fleurs-audio-sha.wav',
              mimeType:
                'audio/wav',
              durationSeconds: 1.25,
              sha256:
                'fleurs-audio-sha',
            },
          ],
        );
      });
    store.close();
  } finally {
    try { db.close(); } catch { /* already closed */ }
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
