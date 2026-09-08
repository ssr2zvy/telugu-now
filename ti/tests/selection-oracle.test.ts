import assert from 'node:assert/strict';
import test from 'node:test';
import type { DataSource, SourceComplexityClass } from '../server/src/domain/source';
import { SelectionEngine } from '../server/src/services/selection-engine';
import { SourceRegistry } from '../server/src/services/source-registry';
import { source1Rows } from '../server/src/sources/dummy/data/source1';
import { source2Rows } from '../server/src/sources/dummy/data/source2';
import { source3Rows } from '../server/src/sources/dummy/data/source3';
import type { ProfileSelectionSettings, SelectionSnapshot } from '../shared/contracts';

const CENTRAL_98_Z = 2.326347874;

interface RawRow {
  sourceKey: string;
  text: string;
}

interface OracleRow {
  sourceId: string;
  sourceKey: string;
  complexityValue: number;
  sourceRowCount: number;
  sourceWeight: number;
  sourceMass: number;
  totalSourceMass: number;
  sourceProbability: number;
  globalPercentileStart: number;
  globalPercentileEnd: number;
  globalIntervalMass: number;
  globalRowsAtComplexityValue: number;
  globalPerRowComplexityMass: number;
  selectedSourceRowsAtComplexityValue: number;
  selectedSourceNormalizationDenominator: number;
  rowProbabilityWithinSource: number;
  overallProbability: number;
}

const rawFixtures: Record<string, readonly RawRow[]> = {
  source1: source1Rows,
  source2: source2Rows,
  source3: source3Rows,
};

function independentGraphemeCount(text: string): number {
  return [...new Intl.Segmenter('te', { granularity: 'grapheme' }).segment(text.normalize('NFC'))].length;
}

// Independent numerical oracle: production uses a complementary-error-function CDF
// approximation. This test instead integrates the Gaussian density with Simpson's rule,
// so a defect in the production CDF implementation is not mirrored by the test oracle.
function simpsonIntegral(
  fn: (x: number) => number,
  lower: number,
  upper: number,
  slices = 4096,
): number {
  if (!(upper > lower)) return 0;
  const evenSlices = slices % 2 === 0 ? slices : slices + 1;
  const step = (upper - lower) / evenSlices;
  let total = fn(lower) + fn(upper);
  for (let index = 1; index < evenSlices; index += 1) {
    total += fn(lower + index * step) * (index % 2 === 0 ? 2 : 4);
  }
  return total * step / 3;
}

function buildOracle(
  settings: ProfileSelectionSettings,
  fixtures: Record<string, readonly RawRow[]> = rawFixtures,
): Map<string, OracleRow> {
  const sourceIds = Object.keys(fixtures);
  const rows = sourceIds.flatMap((sourceId) => fixtures[sourceId]!.map((row) => ({
    sourceId,
    sourceKey: row.sourceKey,
    complexityValue: independentGraphemeCount(row.text),
  })));

  const globalCountByComplexity = new Map<number, number>();
  for (const row of rows) {
    globalCountByComplexity.set(
      row.complexityValue,
      (globalCountByComplexity.get(row.complexityValue) ?? 0) + 1,
    );
  }

  const totalRows = rows.length;
  let cumulative = 0;
  const intervals = new Map<number, {
    start: number;
    end: number;
    globalCount: number;
    intervalMass: number;
    perRowMass: number;
  }>();

  const sigma = settings.complexityPercentileSpread / CENTRAL_98_Z;
  const gaussian = (percentile: number): number => {
    const z = (percentile - settings.complexityPercentileTarget) / sigma;
    return Math.exp(-0.5 * z * z);
  };
  const domainMass = simpsonIntegral(gaussian, 0, 1);
  assert.ok(domainMass > 0 && Number.isFinite(domainMass));

  for (const [complexityValue, globalCount] of [...globalCountByComplexity.entries()].sort((a, b) => a[0] - b[0])) {
    const start = cumulative / totalRows;
    cumulative += globalCount;
    const end = cumulative / totalRows;
    const intervalMass = simpsonIntegral(gaussian, start, end) / domainMass;
    intervals.set(complexityValue, {
      start,
      end,
      globalCount,
      intervalMass,
      perRowMass: intervalMass / globalCount,
    });
  }

  const sourceRowCounts = new Map<string, number>();
  const sourceMasses = new Map<string, number>();
  let totalSourceMass = 0;
  for (const sourceId of sourceIds) {
    const sourceRowCount = fixtures[sourceId]!.length;
    const sourceWeight = settings.sourceWeights[sourceId];
    assert.notEqual(sourceWeight, undefined);
    const sourceMass = sourceRowCount * sourceWeight!;
    sourceRowCounts.set(sourceId, sourceRowCount);
    sourceMasses.set(sourceId, sourceMass);
    totalSourceMass += sourceMass;
  }

  const sourceCountsByComplexity = new Map<string, Map<number, number>>();
  const sourceDenominators = new Map<string, number>();
  for (const sourceId of sourceIds) {
    const counts = new Map<number, number>();
    for (const row of rows.filter((candidate) => candidate.sourceId === sourceId)) {
      counts.set(row.complexityValue, (counts.get(row.complexityValue) ?? 0) + 1);
    }
    sourceCountsByComplexity.set(sourceId, counts);
    let denominator = 0;
    for (const [complexityValue, count] of counts) {
      denominator += count * intervals.get(complexityValue)!.perRowMass;
    }
    sourceDenominators.set(sourceId, denominator);
  }

  const oracle = new Map<string, OracleRow>();
  for (const row of rows) {
    const interval = intervals.get(row.complexityValue)!;
    const sourceRowCount = sourceRowCounts.get(row.sourceId)!;
    const sourceWeight = settings.sourceWeights[row.sourceId]!;
    const sourceMass = sourceMasses.get(row.sourceId)!;
    const sourceProbability = sourceMass / totalSourceMass;
    const denominator = sourceDenominators.get(row.sourceId)!;
    const rowProbabilityWithinSource = interval.perRowMass / denominator;
    oracle.set(`${row.sourceId}\u0000${row.sourceKey}`, {
      ...row,
      sourceRowCount,
      sourceWeight,
      sourceMass,
      totalSourceMass,
      sourceProbability,
      globalPercentileStart: interval.start,
      globalPercentileEnd: interval.end,
      globalIntervalMass: interval.intervalMass,
      globalRowsAtComplexityValue: interval.globalCount,
      globalPerRowComplexityMass: interval.perRowMass,
      selectedSourceRowsAtComplexityValue: sourceCountsByComplexity.get(row.sourceId)!.get(row.complexityValue)!,
      selectedSourceNormalizationDenominator: denominator,
      rowProbabilityWithinSource,
      overallProbability: sourceProbability * rowProbabilityWithinSource,
    });
  }

  return oracle;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function assertClose(actual: number, expected: number, tolerance = 3e-7): void {
  const scale = Math.max(1, Math.abs(actual), Math.abs(expected));
  assert.ok(
    Math.abs(actual - expected) <= tolerance * scale,
    `expected ${actual} to be within ${tolerance} of ${expected}`,
  );
}

function assertSnapshotMatchesIndependentOracle(
  snapshot: SelectionSnapshot,
  expected: OracleRow,
  settings: ProfileSelectionSettings,
): void {
  assert.equal(snapshot.sourceId, expected.sourceId);
  assert.equal(snapshot.sourceKey, expected.sourceKey);
  assert.equal(snapshot.complexityValue, expected.complexityValue);
  assert.equal(snapshot.complexityMetric, 'grapheme-count');
  assert.equal(snapshot.sourceRowCount, expected.sourceRowCount);
  assert.equal(snapshot.sourceWeight, expected.sourceWeight);
  assert.equal(snapshot.sourceMass, expected.sourceMass);
  assert.equal(snapshot.totalSourceMass, expected.totalSourceMass);
  assertClose(snapshot.sourceProbability, expected.sourceProbability);
  assert.equal(snapshot.complexityReferenceVersion, 2);
  assert.equal(snapshot.complexityPercentileTarget, settings.complexityPercentileTarget);
  assert.equal(snapshot.complexityPercentileSpread, settings.complexityPercentileSpread);
  assertClose(snapshot.globalPercentileStart, expected.globalPercentileStart, 1e-12);
  assertClose(snapshot.globalPercentileEnd, expected.globalPercentileEnd, 1e-12);
  assertClose(snapshot.globalIntervalMass, expected.globalIntervalMass);
  assert.equal(snapshot.globalRowsAtComplexityValue, expected.globalRowsAtComplexityValue);
  assertClose(snapshot.globalPerRowComplexityMass, expected.globalPerRowComplexityMass);
  assert.equal(snapshot.selectedSourceRowsAtComplexityValue, expected.selectedSourceRowsAtComplexityValue);
  assertClose(
    snapshot.selectedSourceNormalizationDenominator,
    expected.selectedSourceNormalizationDenominator,
  );
  assertClose(snapshot.rowProbabilityWithinSource, expected.rowProbabilityWithinSource);
  assertClose(snapshot.overallProbability, expected.overallProbability);
}

function sourceProbabilityFromOracle(oracle: Map<string, OracleRow>, sourceId: string): number {
  return [...oracle.values()].find((row) => row.sourceId === sourceId)!.sourceProbability;
}

function assertSamplingCount(
  observed: number,
  draws: number,
  probability: number,
  sigmaLimit = 4.5,
): void {
  const expected = draws * probability;
  const standardDeviation = Math.sqrt(draws * probability * (1 - probability));
  const tolerance = Math.max(2, sigmaLimit * standardDeviation);
  assert.ok(
    Math.abs(observed - expected) <= tolerance,
    `observed ${observed}; expected ${expected.toFixed(3)} ± ${tolerance.toFixed(3)}`,
  );
}

function fixtureLengths(rows: readonly RawRow[]): number[] {
  return rows.map((row) => independentGraphemeCount(row.text));
}

test('dummy fixtures are fixed seeded right-skewed populations rather than a 1-6 ladder', () => {
  assert.deepEqual(fixtureLengths(source1Rows), [4, 4, 2, 1, 7, 5, 2, 7, 13, 8, 8, 3]);
  assert.deepEqual(fixtureLengths(source2Rows), [10, 9, 10, 9, 20, 7, 12, 14, 10, 15, 2, 6, 8, 14, 6, 8, 8, 12, 13, 9, 9, 11, 18, 8]);
  assert.deepEqual(fixtureLengths(source3Rows), [40, 17, 17, 14, 12, 36, 12, 12, 4, 14, 11, 16, 40, 33, 12, 11, 13, 4, 28, 31, 20, 9, 17, 23, 24, 13, 19, 10, 16, 15, 40, 22, 17, 16, 6, 21]);

  const means = [source1Rows, source2Rows, source3Rows].map((rows) => {
    const values = fixtureLengths(rows);
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  });
  assert.ok(means[0]! < means[1]! && means[1]! < means[2]!);
  assert.ok(Math.max(...fixtureLengths(source3Rows)) >= 30);
});

test('100-selection black-box audit agrees with an independently calculated oracle', () => {
  const settings: ProfileSelectionSettings = {
    sourceWeights: { source1: 1, source2: 0.6, source3: 0.3 },
    complexityPercentileTarget: 0.64,
    complexityPercentileSpread: 0.22,
    complexityReferenceVersion: 2,
  };
  const oracle = buildOracle(settings);
  const engine = new SelectionEngine(new SourceRegistry(), mulberry32(0xA11CE100));
  const sourceCounts = new Map<string, number>();
  const quartileCounts = [0, 0, 0, 0];
  const quartileExpected = [0, 0, 0, 0];

  for (const row of oracle.values()) {
    const midpoint = (row.globalPercentileStart + row.globalPercentileEnd) / 2;
    const quartile = Math.min(3, Math.floor(midpoint * 4));
    quartileExpected[quartile]! += row.overallProbability;
  }

  for (let index = 0; index < 100; index += 1) {
    const selected = engine.select(settings);
    const expected = oracle.get(`${selected.sourceId}\u0000${selected.sourceKey}`);
    assert.ok(expected, `oracle missing ${selected.sourceId}/${selected.sourceKey}`);
    assertSnapshotMatchesIndependentOracle(selected.snapshot, expected, settings);

    sourceCounts.set(selected.sourceId, (sourceCounts.get(selected.sourceId) ?? 0) + 1);
    const midpoint = (expected.globalPercentileStart + expected.globalPercentileEnd) / 2;
    quartileCounts[Math.min(3, Math.floor(midpoint * 4))]! += 1;
  }

  for (const sourceId of Object.keys(rawFixtures)) {
    assertSamplingCount(
      sourceCounts.get(sourceId) ?? 0,
      100,
      sourceProbabilityFromOracle(oracle, sourceId),
    );
  }
  for (let quartile = 0; quartile < 4; quartile += 1) {
    if (quartileExpected[quartile]! * 100 >= 5) {
      assertSamplingCount(quartileCounts[quartile]!, 100, quartileExpected[quartile]!);
    }
  }
});

test('seeded 50,000-selection Monte Carlo converges to the independent full source+row distribution', () => {
  const settings: ProfileSelectionSettings = {
    sourceWeights: { source1: 1, source2: 0.55, source3: 0.25 },
    complexityPercentileTarget: 0.58,
    complexityPercentileSpread: 0.28,
    complexityReferenceVersion: 2,
  };
  const oracle = buildOracle(settings);
  const engine = new SelectionEngine(new SourceRegistry(), mulberry32(0x5E1EC710));
  const draws = 50_000;
  const pairCounts = new Map<string, number>();
  const sourceCounts = new Map<string, number>();

  for (let index = 0; index < draws; index += 1) {
    const selected = engine.select(settings);
    const key = `${selected.sourceId}\u0000${selected.sourceKey}`;
    pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
    sourceCounts.set(selected.sourceId, (sourceCounts.get(selected.sourceId) ?? 0) + 1);
  }

  let totalVariation = 0;
  for (const [key, expected] of oracle) {
    const empirical = (pairCounts.get(key) ?? 0) / draws;
    totalVariation += Math.abs(empirical - expected.overallProbability);
  }
  totalVariation *= 0.5;

  assert.ok(totalVariation < 0.02, `full-distribution total variation was ${totalVariation}`);
  for (const sourceId of Object.keys(rawFixtures)) {
    const empirical = (sourceCounts.get(sourceId) ?? 0) / draws;
    const expected = sourceProbabilityFromOracle(oracle, sourceId);
    assert.ok(
      Math.abs(empirical - expected) < 0.007,
      `${sourceId}: empirical ${empirical}, expected ${expected}`,
    );
  }
});

test('injected random needles cross row-complexity probability boundaries at the oracle boundaries', () => {
  const rows: DataSource[] = [
    { sourceKey: 'one', complexityValue: 1 },
    { sourceKey: 'two', complexityValue: 2 },
    { sourceKey: 'three', complexityValue: 3 },
  ];
  const source: DataSource = {
    id: 'only',
    enabled: true,
    catalog: () => rows,
    prepare: async ({ sourceKey }) => ({ text: sourceKey }),
  };
  const registry = { selectableSources: () => [source] } as unknown as SourceRegistry;
  const fixture = {
    only: [
      { sourceKey: 'one', text: 'ఒకటి' },
      { sourceKey: 'two', text: 'రెండు పదాలు' },
      { sourceKey: 'three', text: 'మూడు చిన్న పదాలు' },
    ],
  };
  const settings: ProfileSelectionSettings = {
    sourceWeights: { only: 1 },
    complexityPercentileTarget: 0.5,
    complexityPercentileSpread: 0.4,
    complexityReferenceVersion: 2,
  };
  const oracle = buildOracle(settings, fixture);
  const ordered = ['one', 'two', 'three'].map((key) => oracle.get(`only\u0000${key}`)!);
  const firstBoundary = ordered[0]!.rowProbabilityWithinSource;
  const secondBoundary = firstBoundary + ordered[1]!.rowProbabilityWithinSource;

  const choose = (classNeedle: number): string => {
    const randoms = [0, classNeedle, 0];
    return new SelectionEngine(registry, () => randoms.shift() ?? 0).select(settings).sourceKey;
  };

  assert.equal(choose(Math.max(0, firstBoundary - 1e-5)), 'one');
  assert.equal(choose(Math.min(1 - Number.EPSILON, firstBoundary + 1e-5)), 'two');
  assert.equal(choose(Math.max(0, secondBoundary - 1e-5)), 'two');
  assert.equal(choose(Math.min(1 - Number.EPSILON, secondBoundary + 1e-5)), 'three');
});
