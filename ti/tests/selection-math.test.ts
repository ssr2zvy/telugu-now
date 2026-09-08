import assert from 'node:assert/strict';
import test from 'node:test';
import type { DataSource, SourceComplexityClass } from '../server/src/domain/source';
import { SelectionEngine } from '../server/src/services/selection-engine';
import { SourceRegistry } from '../server/src/services/source-registry';
import type { ProfileSelectionSettings, SelectionSnapshot } from '../shared/contracts';

function randomSequence(values: number[]): () => number {
  let index = 0;
  return () => values[index++] ?? 0;
}

function actualSettings(
  sourceWeights: Record<string, number>,
  target = 0.5,
  spread = 0.25,
): ProfileSelectionSettings {
  return {
    sourceWeights,
    complexityPercentileTarget: target,
    complexityPercentileSpread: spread,
    complexityReferenceVersion: 2,
  };
}

function probabilityForSource(random: number, weights: Record<string, number>): SelectionSnapshot {
  const engine = new SelectionEngine(new SourceRegistry(), randomSequence([random, 0.5, 0.5]));
  return engine.select(actualSettings(weights)).snapshot;
}

function oneRowPerComplexityRegistry(): SourceRegistry {
  const classes: SourceComplexityClass[] = Array.from({ length: 6 }, (_, index) => ({ complexityValue: index + 1, rowCount: 1 }));
  const source: DataSource = {
    id: 'only', enabled: true, rowCount: () => 6, complexityClasses: () => classes,
    candidateAt: (complexityValue) => ({ sourceKey: `row-${complexityValue}`, complexityValue }),
    prepare: async (sourceKey) => ({ text: sourceKey, media: [{ kind: 'text', language: 'te', text: sourceKey }] }),
    info: () => ({ sourceId: 'only', displayName: 'only', provider: 'test', license: 'test', upstreamUrl: null, catalogVersion: 2, acceptedRows: 6, rejectedRows: 0, complexityMetric: 'grapheme-count', status: 'fixture' }),
  };
  return { selectableSources: () => [source] } as unknown as SourceRegistry;
}

function collectSingleSourceRowProbabilities(target: number, spread: number): Map<number, SelectionSnapshot> {
  const registry = oneRowPerComplexityRegistry();
  const found = new Map<number, SelectionSnapshot>();

  // Deterministically sweep the class-selection needle rather than relying on a
  // statistical/random test. Every class has positive mass for the spreads used here.
  for (let step = 0; step < 10_000 && found.size < 6; step += 1) {
    const needle = (step + 0.5) / 10_000;
    const engine = new SelectionEngine(registry, randomSequence([0, needle, 0]));
    const selected = engine.select(actualSettings({ only: 1 }, target, spread));
    found.set(selected.complexityValue, selected.snapshot);
  }

  assert.equal(found.size, 6, 'every complexity interval should be selectable');
  return found;
}

test('global complexity reference v2 is pinned to the intended 72-row dummy distribution', () => {
  const reference = new SelectionEngine(new SourceRegistry(), () => 0).describeReference();
  assert.equal(reference.version, 2);
  assert.equal(reference.totalRows, 72);
  assert.deepEqual(
    reference.classes.map(({ complexityValue, globalCount }) => [complexityValue, globalCount]),
    [
      [1, 1], [2, 3], [3, 1], [4, 4], [5, 1], [6, 3], [7, 3], [8, 6], [9, 5],
      [10, 4], [11, 3], [12, 6], [13, 4], [14, 4], [15, 2], [16, 3], [17, 4],
      [18, 1], [19, 1], [20, 2], [21, 1], [22, 1], [23, 1], [24, 1], [28, 1],
      [31, 1], [33, 1], [36, 1], [40, 3],
    ],
  );

  let cumulative = 0;
  for (const item of reference.classes) {
    assert.equal(item.percentileStart, cumulative / 72);
    cumulative += item.globalCount;
    assert.equal(item.percentileEnd, cumulative / 72);
  }
  assert.equal(cumulative, 72);
});


test('selection rejects a mismatched complexity-reference version', () => {
  const engine = new SelectionEngine(new SourceRegistry(), () => 0);
  assert.throws(() => engine.select({
    sourceWeights: { source1: 1, source2: 1, source3: 1 },
    complexityPercentileTarget: 0.5,
    complexityPercentileSpread: 0.25,
    complexityReferenceVersion: 1,
  }), /Unsupported complexity reference version/);
});

test('source selection thresholds exactly follow N_i * w_i', () => {
  const weights = { source1: 1, source2: 0.5, source3: 0.25 };
  // Masses: 12, 12, 9. Total: 33.
  const first = probabilityForSource(0.1, weights);
  const second = probabilityForSource(0.5, weights);
  const third = probabilityForSource(0.9, weights);

  assert.equal(first.sourceId, 'source1');
  assert.equal(first.sourceProbability, 12 / 33);
  assert.equal(second.sourceId, 'source2');
  assert.equal(second.sourceProbability, 12 / 33);
  assert.equal(third.sourceId, 'source3');
  assert.equal(third.sourceProbability, 9 / 33);
  assert.equal(first.totalSourceMass, 33);
  assert.equal(second.totalSourceMass, 33);
  assert.equal(third.totalSourceMass, 33);
});

test('zero-weight sources are impossible and all-one weights are proportional to row counts', () => {
  for (const needle of [0, 0.2, 0.5, 0.999999999]) {
    const snapshot = probabilityForSource(needle, { source1: 1, source2: 0, source3: 0 });
    assert.equal(snapshot.sourceId, 'source1');
    assert.equal(snapshot.sourceProbability, 1);
  }

  assert.equal(
    probabilityForSource(0.01, { source1: 1, source2: 1, source3: 1 }).sourceProbability,
    12 / 72,
  );
  assert.equal(
    probabilityForSource(0.2, { source1: 1, source2: 1, source3: 1 }).sourceProbability,
    24 / 72,
  );
  assert.equal(
    probabilityForSource(0.8, { source1: 1, source2: 1, source3: 1 }).sourceProbability,
    36 / 72,
  );
});



test('complexity settings never change the already-chosen source probability', () => {
  const weights = { source1: 1, source2: 0.5, source3: 0.25 };
  const low = new SelectionEngine(new SourceRegistry(), randomSequence([0.5, 0.1, 0.1]))
    .select(actualSettings(weights, 0.05, 0.05)).snapshot;
  const high = new SelectionEngine(new SourceRegistry(), randomSequence([0.5, 0.9, 0.9]))
    .select(actualSettings(weights, 0.95, 0.5)).snapshot;
  assert.equal(low.sourceId, 'source2');
  assert.equal(high.sourceId, 'source2');
  assert.equal(low.sourceProbability, 12 / 33);
  assert.equal(high.sourceProbability, 12 / 33);
});

test('an effectively flat complexity curve converges to uniform per-row selection within any chosen source', () => {
  const cases = [
    [{ source1: 1, source2: 0, source3: 0 }, 12],
    [{ source1: 0, source2: 1, source3: 0 }, 24],
    [{ source1: 0, source2: 0, source3: 1 }, 36],
  ] as const;

  for (const [sourceWeights, rowCount] of cases) {
    const engine = new SelectionEngine(new SourceRegistry(), randomSequence([0.7, 0.6, 0.4]));
    const snapshot = engine.select(actualSettings(sourceWeights, 0.5, Number.MAX_VALUE)).snapshot;
    assert.equal(snapshot.sourceProbability, 1);
    assert.ok(Math.abs(snapshot.globalPerRowComplexityMass - 1 / 72) < 1e-15);
    assert.ok(Math.abs(snapshot.rowProbabilityWithinSource - 1 / rowCount) < 1e-14);
  }
});

test('normal complexity masses normalize to one and preserve symmetry around percentile 0.5', () => {
  const snapshots = collectSingleSourceRowProbabilities(0.5, 1);
  const probabilities = [...snapshots.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, snapshot]) => snapshot.rowProbabilityWithinSource);

  assert.ok(Math.abs(probabilities.reduce((sum, value) => sum + value, 0) - 1) < 1e-12);
  assert.ok(Math.abs(probabilities[0]! - probabilities[5]!) < 1e-12);
  assert.ok(Math.abs(probabilities[1]! - probabilities[4]!) < 1e-12);
  assert.ok(Math.abs(probabilities[2]! - probabilities[3]!) < 1e-12);

  for (const snapshot of snapshots.values()) {
    assert.ok(snapshot.globalIntervalMass > 0);
    assert.equal(
      snapshot.globalPerRowComplexityMass * snapshot.globalRowsAtComplexityValue,
      snapshot.globalIntervalMass,
    );
    assert.equal(snapshot.sourceProbability, 1);
    assert.equal(snapshot.overallProbability, snapshot.rowProbabilityWithinSource);
  }
});

test('moving the global percentile target predictably moves row preference', () => {
  const low = collectSingleSourceRowProbabilities(0.1, 1);
  const high = collectSingleSourceRowProbabilities(0.9, 1);

  assert.ok(low.get(1)!.rowProbabilityWithinSource > low.get(6)!.rowProbabilityWithinSource);
  assert.ok(high.get(6)!.rowProbabilityWithinSource > high.get(1)!.rowProbabilityWithinSource);
});

test('truncation at percentile boundaries still yields finite normalized probabilities', () => {
  for (const target of [0, 1]) {
    const snapshots = collectSingleSourceRowProbabilities(target, 1);
    const probabilities = [...snapshots.values()].map((snapshot) => snapshot.rowProbabilityWithinSource);
    assert.ok(probabilities.every((value) => Number.isFinite(value) && value > 0));
    assert.ok(Math.abs(probabilities.reduce((sum, value) => sum + value, 0) - 1) < 1e-12);
  }
});

test('very broad valid spreads remain numerically stable and converge to uniform percentile mass', () => {
  for (const spread of [1e10, 1e100, Number.MAX_VALUE]) {
    const snapshots = collectSingleSourceRowProbabilities(0.5, spread);
    for (const snapshot of snapshots.values()) {
      assert.ok(Number.isFinite(snapshot.rowProbabilityWithinSource));
      assert.ok(Math.abs(snapshot.rowProbabilityWithinSource - 1 / 6) < 1e-12);
      assert.ok(Number.isFinite(snapshot.derivedStandardDeviation));
      assert.ok(snapshot.derivedStandardDeviation > 0);
    }
  }
});

test('the smallest positive representable spread does not collapse sigma to zero or throw', () => {
  const engine = new SelectionEngine(oneRowPerComplexityRegistry(), randomSequence([0, 0.5, 0]));
  const selected = engine.select(actualSettings({ only: 1 }, 0.51, Number.MIN_VALUE));
  assert.ok(selected.snapshot.derivedStandardDeviation > 0);
  assert.ok(Number.isFinite(selected.snapshot.rowProbabilityWithinSource));
  assert.ok(selected.snapshot.rowProbabilityWithinSource > 0);
});
