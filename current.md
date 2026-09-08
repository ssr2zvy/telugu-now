## `ti/control.sh`
### REPLACE
**Location:** Inside `run_data_samples()`, replace only the Shrutilipi invocation.
```bash
  python "$DATA_TRANSFORM_DIR/scripts/extract-sample-data/Shrutilipi.py" \
    --input-root "$RAW_DATA_DIR/Shrutilipi" \
    --output-root "$SAMPLE_DATA_DIR/Shrutilipi" \
    || return $?

REPLACE

Location: Inside run_data_samples(), replace only the IndicVoices invocation.

  python "$DATA_TRANSFORM_DIR/scripts/extract-sample-data/IndicVoices.py" \
    --input-root "$RAW_DATA_DIR/IndicVoices" \
    --output-root "$SAMPLE_DATA_DIR/IndicVoices" \
    || return $?

The existing prepared_corpus_ready() check in run_dev_foreground() is already correct and must remain unchanged.

ti/server/src/services/source-record-service.ts

REPLACE

Location: Inside resolve(), replace the entire current if (existing) { ... } cache-hit branch.

    if (existing) {
      const parsed = JSON.parse(
        existing.media_json,
      ) as MediaItem[];
      const media = parsed.length > 0
        ? parsed
        : [
            {
              kind: 'text' as const,
              language: 'te' as const,
              text: existing.text,
            },
          ];
      return {
        sourceId,
        sourceKey,
        text: existing.text,
        media,
        cacheHit: true,
        requestStartedAt: null,
        requestCompletedAt: null,
        requestDurationMs: null,
      };
    }

This preserves compatibility with Iteration 1 ready rows that were migrated into source_records with media_json = '[]'.

ti/tests/selection-oracle.test.ts

REPLACE

Location: Inside assertSnapshotMatchesIndependentOracle(), replace the assertion that currently reads snapshot.complexityValue.

  assert.equal(
    snapshot.intrinsicComplexityValue,
    expected.complexityValue,
  );

Do not add complexityValue to SelectionSnapshot; complexityValue belongs to SelectionResult, while persisted snapshots use intrinsicComplexityValue.

ti/tests/core-implementation.test.ts

INSERT

Location: Immediately after acquisitionSnapshots().

const ZERO_REAL_SOURCE_WEIGHTS = {
  'fleurs-te': 0,
  'shrutilipi-te': 0,
  'indicvoices-te': 0,
} as const;
const SOURCE1_ONLY_WEIGHTS = {
  source1: 1,
  source2: 0,
  source3: 0,
  ...ZERO_REAL_SOURCE_WEIGHTS,
} as const;
const SOURCE3_ONLY_WEIGHTS = {
  source1: 0,
  source2: 0,
  source3: 1,
  ...ZERO_REAL_SOURCE_WEIGHTS,
} as const;
const DUMMY_ALL_ONES_WEIGHTS = {
  source1: 1,
  source2: 1,
  source3: 1,
  ...ZERO_REAL_SOURCE_WEIGHTS,
} as const;
const DEFAULT_SIX_SOURCE_WEIGHTS = {
  source1: 1,
  source2: 1,
  source3: 1,
  'fleurs-te': 1,
  'shrutilipi-te': 1,
  'indicvoices-te': 1,
} as const;

REPLACE

Location: Replace the suite declaration beginning with test('Iteration 2 selection, settings, repeats, cache and export'.

test(
  'Iteration 3 selection, settings, repeats, cache and export',
  { concurrency: false },
  async (suite) => {

Keep the existing suite body and closing braces.

REPLACE

Location: Replace the entire first source-registry test currently named contains exactly three selectable deterministic catalogs of 12, 24 and 36 rows.

  await suite.test(
    'contains six selectable sources with three dummy and three prepared catalogs',
    () => {
      resetDatabase();
      const sources =
        sourceRegistryModule.sourceRegistry
          .selectableSources();
      assert.deepEqual(
        sources.map((source) => source.id),
        [
          'source1',
          'source2',
          'source3',
          'fleurs-te',
          'shrutilipi-te',
          'indicvoices-te',
        ],
      );
      assert.deepEqual(
        sources.map((source) => source.rowCount()),
        [12, 24, 36, 1, 1, 1],
      );
      for (const source of sources) {
        const complexityRows =
          source.complexityClasses().reduce(
            (sum, item) => {
              assert.ok(item.complexityValue > 0);
              assert.ok(item.rowCount > 0);
              return sum + item.rowCount;
            },
            0,
          );
        assert.equal(
          complexityRows,
          source.rowCount(),
        );
      }
    },
  );

REPLACE

Location: Replace the global-reference test currently named builds one global percentile reference from all 72 rows.

  await suite.test(
    'builds complexity reference version 2 from all six test sources',
    () => {
      resetDatabase();
      const reference =
        selectionModule.selectionEngine
          .describeReference();
      assert.equal(reference.version, 2);
      assert.equal(reference.totalRows, 75);
      assert.equal(
        reference.classes[0]?.percentileStart,
        0,
      );
      assert.equal(
        reference.classes.at(-1)?.percentileEnd,
        1,
      );
      for (
        let index = 1;
        index < reference.classes.length;
        index += 1
      ) {
        assert.equal(
          reference.classes[index - 1]
            ?.percentileEnd,
          reference.classes[index]
            ?.percentileStart,
        );
      }
    },
  );

REPLACE

Location: In the test rejects noncanonical source weights and persists valid profile settings, keep the first three-source request as an intentionally incomplete invalid map. Replace only the valid saved request.

    const saved =
      settingsService
        .updateProfileSelectionSettings(
          '001',
          {
            sourceWeights: {
              source1: 1,
              source2: 0.4,
              source3: 0,
              ...ZERO_REAL_SOURCE_WEIGHTS,
            },
            complexityPercentileTarget: 0.7,
            complexityPercentileSpread: 0.15,
          },
        );

REPLACE

Location: In that same test, replace the saved.sourceWeights assertion.

    assert.deepEqual(
      saved.sourceWeights,
      {
        source1: 1,
        source2: 0.4,
        source3: 0,
        ...ZERO_REAL_SOURCE_WEIGHTS,
      },
    );

REPLACE

Location: Replace the entire test currently named persists exact Iteration 2 defaults for a new profile.

  await suite.test(
    'persists exact Iteration 3 defaults for a new profile',
    () => {
      resetDatabase();
      ensureProfile();
      const settings =
        settingsService
          .getProfileSelectionSettings(
            '001',
          );
      assert.deepEqual(
        settings.sourceWeights,
        DEFAULT_SIX_SOURCE_WEIGHTS,
      );
      assert.equal(
        settings.complexityPercentileTarget,
        0.5,
      );
      assert.equal(
        settings.complexityPercentileSpread,
        0.25,
      );
      assert.equal(
        settings.complexityReferenceVersion,
        2,
      );
    },
  );

REPLACE

Location: Inside rejects every invalid settings family, including non-finite values and incomplete source maps, replace the current valid fixture.

    const valid = {
      sourceWeights: {
        source1: 1,
        source2: 0.5,
        source3: 0,
        ...ZERO_REAL_SOURCE_WEIGHTS,
      },
      complexityPercentileTarget: 0.5,
      complexityPercentileSpread: 0.25,
    };

REPLACE

Location: In the same test, replace the source-weight-specific entries of the invalid array. Leave the complexity target/spread invalid cases unchanged.

      {
        ...valid,
        sourceWeights: {
          source1: 1,
          source2: 0.5,
          source3: 0,
          'fleurs-te': 0,
          'shrutilipi-te': 0,
        },
      },
      {
        ...valid,
        sourceWeights: {
          source1: 1,
          source2: 0.5,
          source3: 0,
          ...ZERO_REAL_SOURCE_WEIGHTS,
          source4: 0,
        },
      },
      {
        ...valid,
        sourceWeights: {
          source1: 1.1,
          source2: 0.5,
          source3: 0,
          ...ZERO_REAL_SOURCE_WEIGHTS,
        },
      },
      {
        ...valid,
        sourceWeights: {
          source1: -0.1,
          source2: 1,
          source3: 0,
          ...ZERO_REAL_SOURCE_WEIGHTS,
        },
      },
      {
        ...valid,
        sourceWeights: {
          source1: Number.NaN,
          source2: 1,
          source3: 0,
          ...ZERO_REAL_SOURCE_WEIGHTS,
        },
      },
      {
        ...valid,
        sourceWeights: {
          source1: 0.8,
          source2: 0.4,
          source3: 0.2,
          ...ZERO_REAL_SOURCE_WEIGHTS,
        },
      },

The first replacement above intentionally omits indicvoices-te so the incomplete-map case is still explicitly tested.

REPLACE

Location: Inside source probability uses row count times profile weight and snapshots exact row probabilities, replace the sourceWeights value passed to engine.select().

      sourceWeights: {
        ...DUMMY_ALL_ONES_WEIGHTS,
      },

Keep the existing expected source masses:

source1 = 12
source2 = 24
source3 = 36
total = 72

because all three prepared-source weights are deliberately zero in this test.

REPLACE

Location: Inside settings changes leave existing queue snapshots unchanged and affect only a new replacement, replace the settings-update sourceWeights.

      sourceWeights: {
        ...SOURCE1_ONLY_WEIGHTS,
      },

REPLACE

Location: In that same test, replace the final after[10]?.sourceWeights assertion.

    assert.deepEqual(
      after[10]?.sourceWeights,
      SOURCE1_ONLY_WEIGHTS,
    );

INSERT

Location: Immediately after the existing test shared SourceRecord cache turns a repeated resolution into a cache hit.

  await suite.test(
    'historical cached rows with empty media synthesize TextMedia',
    async () => {
      resetDatabase();
      db.prepare(`
        INSERT INTO source_records (
          source_id,
          source_key,
          text,
          media_json,
          prepared_at
        ) VALUES (?, ?, ?, ?, ?)
      `).run(
        'source1',
        'historical-text-only',
        'చరిత్ర',
        '[]',
        now,
      );
      const resolved =
        await sourceRecordService.resolve(
          'source1',
          'historical-text-only',
        );
      assert.equal(resolved.cacheHit, true);
      assert.equal(resolved.text, 'చరిత్ర');
      assert.deepEqual(
        resolved.media,
        [
          {
            kind: 'text',
            language: 'te',
            text: 'చరిత్ర',
          },
        ],
      );
    },
  );

REPLACE

Location: Inside export freezes one settings snapshot even if profile settings change during source retrieval, replace the initial settings sourceWeights.

      sourceWeights: {
        ...SOURCE1_ONLY_WEIGHTS,
      },

REPLACE

Location: In that same test, replace the settings update performed while the export is in flight.

        sourceWeights: {
          ...SOURCE3_ONLY_WEIGHTS,
        },

REPLACE

Location: In that same test, replace the exported-settings source-weight assertion.

      assert.deepEqual(
        exported.settings.sourceWeights,
        SOURCE1_ONLY_WEIGHTS,
      );

REPLACE

Location: In that same test, replace the current-profile source-weight assertion.

      assert.deepEqual(
        current.sourceWeights,
        SOURCE3_ONLY_WEIGHTS,
      );

REPLACE

Location: Inside export uses one settings snapshot, generates fresh selections, warms cache and leaves live progression untouched, replace the settings-update sourceWeights.

      sourceWeights: {
        ...SOURCE1_ONLY_WEIGHTS,
      },

REPLACE

Location: Any other valid updateProfileSelectionSettings() request in this file that still supplies exactly { source1, source2, source3 } must be expanded to all six selectable sources. Tests whose purpose is specifically to reject an incomplete source map should remain incomplete.

ti/tests/prepared-corpus.test.ts

INSERT

Location: Immediately after:

  const db = new Database(databasePath);

Insert:

  db.pragma('foreign_keys = ON');

REPLACE

Location: Replace the current one-line db.exec(...) schema declaration with the production prepared-corpus schema.

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

REPLACE

Location: Replace the current single FLEURS fixture inserts with prepared statements and fixtures for all three real sources plus source-readiness edge cases.

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

REPLACE

Location: Replace the current assertions after:

    const store = new PreparedCorpusStore(databasePath);

with:

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
    return source
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

Keep the existing finally cleanup block.

ti/README.md

REPLACE

Location: Immediately below # Implementation Iteration 3, replace the two current introductory paragraphs.

This repository contains Implementation Iteration 3 of the Telugu observation app. Iterations 1 and 2 remain the persistence, history/timing, ten-item queue, one-for-one replenishment, source selection, settings, typography, diagnostics, caching, and export foundation.
Iteration 3 adds the offline corpus-transformation boundary, three prepared real Telugu speech sources, persisted grapheme complexity, formal text/audio media metadata, and six-source selection.

REPLACE

Location: Replace the current short ## Prepared corpus prerequisite section, ending immediately before The root control.sh is the normal development entry point.

## Prepared corpus prerequisite
Corpus acquisition and transformation are offline data-engineering operations under `../data-transform/`. Telugu Now does not parse FLEURS TSV/audio layouts or AI4Bharat Parquet files at application runtime.
The explicit data-controller operations are:
```bash
./control.sh data --option samples
./control.sh data --option prepare
./control.sh data --option all

samples transforms source downloads under:

../data-transform/raw/

into source-shaped development input under:

../data-transform/sample/

prepare transforms the current source-shaped input into the canonical local corpus:

data/corpus/
├── manifest.json
├── corpus.sqlite
├── objects/
└── reports/

all runs samples and then prepare, stopping immediately if either stage fails.

./control.sh dev never performs data transformation. It requires manifest.json and corpus.sqlite to already exist under data/corpus/ and returns CORPUS_NOT_PREPARED otherwise.

The preparation scripts themselves accept explicit input and output paths. The current Codespaces workflow uses sample-sized source data, while the same transformation implementation is intended to process the complete downloaded corpora before production publication to Fly.io Tigris.

### REPLACE
**Location:** Replace the paragraph under `## Build and tests` that begins `The tests preserve`.
```markdown
The tests preserve the accepted Iteration 1 history, timing, queue, and replenishment invariants; the Iteration 2 caching, settings, presentation, diagnostic, HTML, and EPUB behavior; and the Iteration 3 six-source selector, grapheme complexity reference, prepared-corpus store, formal media metadata, attribution surface, source-record compatibility, and production-style corpus indexing.

REPLACE

Location: Replace the entire current ## Selectable sources section through the line immediately before ## Source selection.

## Selectable sources
Iteration 3 has six selectable sources with independently persisted weights:
1. `source1`: 12 development-fixture rows
2. `source2`: 24 development-fixture rows
3. `source3`: 36 development-fixture rows
4. `fleurs-te`: prepared FLEURS Telugu rows
5. `shrutilipi-te`: prepared Shrutilipi Telugu rows
6. `indicvoices-te`: prepared IndicVoices Telugu rows
The three dummy source rows remain literal development fixtures under `server/src/sources/dummy/data/`.
The three prepared real-source row counts come from the prepared corpus metadata and are never hardcoded into the application.
The current Codespaces sample corpus is only a development input. Replacing it with the complete source datasets changes the prepared source counts without changing the runtime source interface or selection algorithm.
Dummy-source cache misses retain the existing development-only configurable mock latency. Prepared real-source rows are read from the indexed canonical corpus and do not perform an upstream Hugging Face request.

REPLACE

Location: Replace the entire current ## Global complexity reference section through the line immediately before ## Repeats and shared source-record cache.

## Global complexity reference
Iteration 3 uses NFC Unicode extended grapheme-cluster count as the intrinsic complexity measurement for every selectable source.
For prepared FLEURS, Shrutilipi, and IndicVoices rows, grapheme count is calculated exactly once during corpus preparation and persisted in `corpus.sqlite`.
The dummy sources calculate the same metric from their committed text fixtures.
The reference is versioned as:
```text
complexity_reference_version = 2

The global reference is constructed from source-level complexity classes and row counts rather than loading every prepared source row into JavaScript memory.

For each grapheme-count value k, tied rows occupy their empirical global percentile interval:

[a_k, b_k]

Each profile configures:

1. global complexity percentile target T in [0,1];
2. global complexity percentile spread R > 0.

The desired complexity curve is a normal distribution centered at T. R is the half-width corresponding to the central 98% reference interval:

sigma = R / 2.326347874

The normal is truncated and renormalized to [0,1]. Probability mass over each tied grapheme-count percentile interval is divided by the global number of rows with that grapheme count to produce per-row global complexity mass.

After a source is selected, those masses are normalized over the complexity classes present in that source.

Source probability, conditional row probability, and overall source-and-row probability remain distinct and are persisted in every new acquisition’s immutable selection snapshot.

### REPLACE
**Location:** Under `## Full-page Settings`, replace the sentence and numbered list that currently say there are four child pages.
```markdown
Settings replaces the observation view while open; it is not a modal. The Settings root links to five child pages:
1. Complexity
2. Source weights
3. Diagnostic
4. Export
5. Data sources

INSERT

Location: In ## Full-page Settings, immediately after the paragraph describing the language control.

The Data sources page exposes the current source catalog and attribution information. For FLEURS, Shrutilipi, and IndicVoices it shows the provider, CC BY 4.0 license, upstream Hugging Face repository, catalog version, accepted and rejected row counts, complexity metric, and deployed source status. The dummy sources are explicitly identified as development fixtures.

REPLACE

Location: In ## Diagnostic, replace the sentence that currently ends with complete persisted Iteration 2 selection snapshot.

Diagnostic has its own full page and renders the current acquisition as a two-column mapping table rather than free-form text. The table contains the accepted trigger/preparation fields and the complete persisted selection snapshot, including complexity metric, grapheme complexity value, reference version, source mass, source probability, conditional row probability, and overall probability.

INSERT

Location: Immediately before ## Persistence and migration.

## Prepared media model
Each canonical prepared row retains:
1. source ID;
2. stable source key;
3. canonical split;
4. original upstream split;
5. canonical Telugu text;
6. persisted grapheme count;
7. text SHA-256;
8. audio SHA-256;
9. audio MIME type;
10. audio duration;
11. content-addressed audio object key;
12. retained source-specific metadata.
FLEURS uses its raw transcription as canonical text and preserves WAV audio.
Shrutilipi uses `text` as canonical text and preserves FLAC audio.
IndicVoices uses `text` as canonical text and preserves FLAC audio. Its verbatim, normalized, unsanitized, speaker, scenario, task, demographic, verification, and other available source metadata remain in source metadata rather than being discarded.
At runtime, canonical rows expose one `TextMedia` item and one `AudioMedia` item. The shared `source_records` cache persists those media descriptors.
Iteration 3 still renders only Unicode text. Audio playback remains deferred to the later Point 11 media interface.
Development resolves canonical object keys against `data/corpus/objects/`. Production will use equivalent object keys for media stored in Tigris; source selection and canonical row identity do not depend on the physical storage backend.

REPLACE

Location: Under ## Persistence and migration, replace the two paragraphs beginning Iteration 2 performs and Already-ready Iteration 1 observations.

Iteration 2 introduced the non-destructive persistence migration for repeated acquisitions, shared source-record caching, profile source weights, complexity settings, and persisted selection snapshots.
Iteration 3 extends `source_records` with `media_json`, introduces selection reference version 2 with grapheme complexity, and preserves compatibility with historical version-1 word-count snapshots.
Already-ready Iteration 1 observations are backfilled into the shared source-record cache with `media_json = '[]'`. When such a historical cached row is read, the runtime synthesizes its canonical `TextMedia` from the cached text.
A compatibility-only disabled Iteration 1 `mock` resolver remains available for old pending rows. It is not one of the six selectable Iteration 3 sources.
The prepared corpus database is separate from mutable profile/application state:
```text
data/app.sqlite
data/corpus/corpus.sqlite

The prepared corpus is generated data and is not application-authored user state.

### REPLACE
**Location:** Replace the environment-default code block at the end of the README.
```text
DATABASE_PATH=./data/app.sqlite
CORPUS_DATABASE_PATH=./data/corpus/corpus.sqlite
CORPUS_OBJECTS_PATH=./data/corpus/objects
SOURCE1_WEIGHT=1
SOURCE2_WEIGHT=1
SOURCE3_WEIGHT=1
FLEURS_TE_WEIGHT=1
SHRUTILIPI_TE_WEIGHT=1
INDICVOICES_TE_WEIGHT=1
COMPLEXITY_PERCENTILE_TARGET=0.5
COMPLEXITY_PERCENTILE_SPREAD=0.25
MOCK_DELAY_MIN_MS=1000
MOCK_DELAY_MAX_MS=15000
MAX_EXPORT_COUNT=500