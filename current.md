## `ti/tests/selection-oracle.test.ts`
### REPLACE
**Location:** Replace the entire test beginning with:
```ts
test('injected random needles cross row-complexity probability boundaries at the oracle boundaries', () => {

and ending with that test’s closing });.

Replace with:

test('injected random needles cross row-complexity probability boundaries at the oracle boundaries', () => {
  const fixture = {
    only: [
      {
        sourceKey: 'one',
        text: 'ఒకటి',
      },
      {
        sourceKey: 'two',
        text: 'రెండు పదాలు',
      },
      {
        sourceKey: 'three',
        text: 'మూడు చిన్న పదాలు',
      },
    ],
  };
  const rows = fixture.only.map(
    (row) => ({
      sourceKey: row.sourceKey,
      complexityValue:
        independentGraphemeCount(
          row.text,
        ),
    }),
  );
  const complexityClasses:
    SourceComplexityClass[] =
      rows.map((row) => ({
        complexityValue:
          row.complexityValue,
        rowCount: 1,
      }));
  const source: DataSource = {
    id: 'only',
    enabled: true,
    rowCount: () =>
      rows.length,
    complexityClasses: () =>
      complexityClasses,
    candidateAt: (
      complexityValue,
      classIndex,
    ) => {
      const matching =
        rows.filter(
          (row) =>
            row.complexityValue ===
            complexityValue,
        );
      const row =
        matching[classIndex];
      if (!row) {
        throw new Error(
          `Missing test row ${complexityValue}/${classIndex}.`,
        );
      }
      return row;
    },
    prepare: async (
      sourceKey,
    ) => {
      const row =
        fixture.only.find(
          (item) =>
            item.sourceKey ===
            sourceKey,
        );
      if (!row) {
        throw new Error(
          `Missing test source row ${sourceKey}.`,
        );
      }
      return {
        text: row.text,
        media: [
          {
            kind: 'text',
            language: 'te',
            text: row.text,
          },
        ],
      };
    },
    info: () => ({
      sourceId: 'only',
      displayName: 'Only',
      provider: 'Test',
      license: 'Test fixture',
      upstreamUrl: null,
      catalogVersion: 2,
      acceptedRows: rows.length,
      rejectedRows: 0,
      complexityMetric:
        'grapheme-count',
      status: 'fixture',
    }),
  };
  const registry = {
    selectableSources: () => [
      source,
    ],
  } as unknown as SourceRegistry;
  const settings:
    ProfileSelectionSettings = {
      sourceWeights: {
        only: 1,
      },
      complexityPercentileTarget:
        0.5,
      complexityPercentileSpread:
        0.4,
      complexityReferenceVersion:
        2,
    };
  const oracle =
    buildOracle(
      settings,
      fixture,
    );
  const ordered = [
    'one',
    'two',
    'three',
  ].map(
    (key) =>
      oracle.get(
        `only\u0000${key}`,
      )!,
  );
  const firstBoundary =
    ordered[0]!
      .rowProbabilityWithinSource;
  const secondBoundary =
    firstBoundary +
    ordered[1]!
      .rowProbabilityWithinSource;
  const choose = (
    classNeedle: number,
  ): string => {
    const randoms = [
      0,
      classNeedle,
      0,
    ];
    return new SelectionEngine(
      registry,
      () =>
        randoms.shift() ?? 0,
    )
      .select(settings)
      .sourceKey;
  };
  assert.equal(
    choose(
      Math.max(
        0,
        firstBoundary - 1e-5,
      ),
    ),
    'one',
  );
  assert.equal(
    choose(
      Math.min(
        1 - Number.EPSILON,
        firstBoundary + 1e-5,
      ),
    ),
    'two',
  );
  assert.equal(
    choose(
      Math.max(
        0,
        secondBoundary - 1e-5,
      ),
    ),
    'two',
  );
  assert.equal(
    choose(
      Math.min(
        1 - Number.EPSILON,
        secondBoundary + 1e-5,
      ),
    ),
    'three',
  );
});

ti/tests/export-epub.test.ts

INSERT

Location: Inside selection(sourceKey: string): SelectionSnapshot, immediately after:

    sourceKey,

Insert:

    complexityMetric:
      'grapheme-count',

REPLACE

Location: Inside the same selection() fixture, replace:

    complexityReferenceVersion:
      1,

With:

    complexityReferenceVersion:
      2,

REPLACE

Location: Inside sampleExport(), under settings, replace:

      complexityReferenceVersion:
        1,

With:

      complexityReferenceVersion:
        2,

ti/tests/repository-contract.test.ts

REPLACE

Location: Inside the test:

'Settings export uses a transient format chooser and keeps format out of selection'

replace the entire current exportPage declaration.

Current affected declaration begins with:

    const exportPage =
      read(

Replace with:

    const exportPage =
      read(
        'frontend/src/settings/pages/ExportPage.tsx',
      );

The following files remain only in the existing requiredFiles array and must not be passed as additional arguments to read():

frontend/src/settings/pages/DataSourcesPage.tsx
server/src/sources/prepared-corpus/prepared-corpus-store.ts
server/src/sources/prepared-corpus/prepared-corpus-data-source.ts

data-transform/scripts/prepare-corpus/common.py

REPLACE

Location: Replace the entire current validate_text() function.

Replace with:

def validate_text(text: Any) -> str:
    if not isinstance(text, str):
        raise RowRejected(
            "EMPTY_TEXT",
            "Canonical text is missing or is not a string.",
        )
    value = text.strip()
    if not value:
        raise RowRejected(
            "EMPTY_TEXT",
            "Canonical text is empty.",
        )
    if grapheme_count(value) <= 0:
        raise RowRejected(
            "EMPTY_COMPLEXITY",
            "Grapheme count is zero.",
        )
    return value

This keeps null or otherwise malformed individual text values in the row-rejection path rather than allowing an AttributeError to abort the entire corpus transformation.