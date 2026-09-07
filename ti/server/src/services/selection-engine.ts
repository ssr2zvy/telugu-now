import type { ProfileSelectionSettings, SelectionSnapshot } from '../../../shared/contracts';
import type { DataSource, SourceCatalogRow } from '../domain/source';
import { sourceRegistry, SourceRegistry } from './source-registry';

export const COMPLEXITY_REFERENCE_VERSION = 1;
const SUPPORTED_REFERENCE_VERSIONS = new Set([1]);
const CENTRAL_98_Z = 2.326347874;
const SQRT_TWO = Math.SQRT2;
const INV_SQRT_TWO_PI = 1 / Math.sqrt(2 * Math.PI);

interface ComplexityClass {
  wordCount: number;
  complexityValue?: number;
  globalCount: number;
  percentileStart: number;
  percentileEnd: number;
}

interface ClassMass extends ComplexityClass {
  intervalMass: number;
  perRowMass: number;
}

export interface SelectionResult {
  sourceId: string;
  sourceKey: string;
  wordCount: number;
  complexityValue?: number;
  snapshot: SelectionSnapshot;
}

export interface ComplexityReferenceDescription {
  version: number;
  totalRows: number;
  classes: Array<{
    wordCount: number;
    complexityValue?: number;
    globalCount: number;
    percentileStart: number;
    percentileEnd: number;
  }>;
}

function erfcApprox(x: number): number {
  if (x < 0) return 2 - erfcApprox(-x);
  const t = 1 / (1 + 0.5 * x);
  let polynomial = 0.17087277;
  polynomial = -0.82215223 + t * polynomial;
  polynomial = 1.48851587 + t * polynomial;
  polynomial = -1.13520398 + t * polynomial;
  polynomial = 0.27886807 + t * polynomial;
  polynomial = -0.18628806 + t * polynomial;
  polynomial = 0.09678418 + t * polynomial;
  polynomial = 0.37409196 + t * polynomial;
  polynomial = 1.00002368 + t * polynomial;
  return t * Math.exp(-x * x - 1.26551223 + t * polynomial);
}

function upperTail(z: number): number {
  if (z < 0) return 1 - upperTail(-z);
  return 0.5 * erfcApprox(z / SQRT_TWO);
}

function standardNormalDensity(z: number): number {
  if (!Number.isFinite(z)) return 0;
  return INV_SQRT_TWO_PI * Math.exp(-0.5 * z * z);
}

function standardNormalInterval(lower: number, upper: number): number {
  if (!(upper > lower)) return 0;

  const width = upper - lower;
  if (Number.isFinite(width) && width <= 1e-5) {
    const midpoint = lower + width / 2;
    return Math.max(0, width * standardNormalDensity(midpoint));
  }

  if (lower >= 0) return Math.max(0, upperTail(lower) - upperTail(upper));
  if (upper <= 0) return Math.max(0, upperTail(-upper) - upperTail(-lower));
  return Math.max(0, 1 - upperTail(upper) - upperTail(-lower));
}

function weightedPick<T>(
  items: readonly T[],
  mass: (item: T) => number,
  random: () => number,
): T {
  const positive = items
    .map((item) => ({ item, mass: mass(item) }))
    .filter((entry) => Number.isFinite(entry.mass) && entry.mass > 0);
  const total = positive.reduce((sum, entry) => sum + entry.mass, 0);
  if (!(total > 0)) throw new Error('Selection distribution has zero total mass.');

  let needle = Math.min(Math.max(random(), 0), 1 - Number.EPSILON) * total;
  for (const entry of positive) {
    if (needle < entry.mass) return entry.item;
    needle -= entry.mass;
  }
  return positive[positive.length - 1]!.item;
}

function sourceCatalogRows(source: DataSource): SourceCatalogRow[] {
  if (source.catalog) {
    return source.catalog().map((row) => ({
      sourceKey: row.sourceKey,
      wordCount: row.wordCount,
      complexityValue: row.complexityValue ?? row.wordCount,
    }));
  }

  if (source.complexityClasses && typeof source.candidateAt === 'function') {
    const rows: SourceCatalogRow[] = [];
    for (const klass of source.complexityClasses()) {
      for (let index = 0; index < klass.rowCount; index += 1) {
        const candidate = source.candidateAt(klass.complexityValue, index);
        rows.push({
          sourceKey: candidate.sourceKey,
          wordCount: klass.complexityValue,
          complexityValue: klass.complexityValue,
        });
      }
    }
    return rows;
  }

  return [];
}

function sourceWordCountMap(source: DataSource): Map<number, SourceCatalogRow[]> {
  const map = new Map<number, SourceCatalogRow[]>();
  for (const row of sourceCatalogRows(source)) {
    const key = row.wordCount;
    const rows = map.get(key) ?? [];
    rows.push(row);
    map.set(key, rows);
  }
  return map;
}

export class SelectionEngine {
  private readonly classes: ComplexityClass[];
  private readonly totalRows: number;

  constructor(
    private readonly registry: SourceRegistry = sourceRegistry,
    private readonly random: () => number = () => Math.random(),
  ) {
    const counts = new Map<number, number>();
    for (const source of registry.selectableSources()) {
      for (const row of sourceCatalogRows(source)) {
        const key = row.wordCount;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }

    this.totalRows = [...counts.values()].reduce((sum, count) => sum + count, 0);
    if (this.totalRows <= 0) throw new Error('Global complexity reference is empty.');

    let cumulative = 0;
    this.classes = [...counts.entries()]
      .sort(([left], [right]) => left - right)
      .map(([wordCount, globalCount]) => {
        const percentileStart = cumulative / this.totalRows;
        cumulative += globalCount;
        return {
          wordCount,
          complexityValue: wordCount,
          globalCount,
          percentileStart,
          percentileEnd: cumulative / this.totalRows,
        };
      });
  }

  describeReference(): ComplexityReferenceDescription {
    return {
      version: COMPLEXITY_REFERENCE_VERSION,
      totalRows: this.totalRows,
      classes: this.classes.map((item) => ({ ...item })),
    };
  }

  private classMasses(target: number, spread: number): ClassMass[] {
    const sigma = Math.max(spread / CENTRAL_98_Z, Number.MIN_VALUE);
    const lowerDomainZ = (0 - target) / sigma;
    const upperDomainZ = (1 - target) / sigma;
    const normalization = standardNormalInterval(lowerDomainZ, upperDomainZ);
    if (!(normalization > 0)) throw new Error('Complexity distribution normalization failed.');

    return this.classes.map((item) => {
      const lowerZ = (item.percentileStart - target) / sigma;
      const upperZ = (item.percentileEnd - target) / sigma;
      const rawIntervalMass = standardNormalInterval(lowerZ, upperZ) / normalization;
      const intervalMass = Math.max(rawIntervalMass, Number.MIN_VALUE);
      const perRowMass = Math.max(intervalMass / item.globalCount, Number.MIN_VALUE);
      return { ...item, intervalMass, perRowMass };
    });
  }

  select(settings: ProfileSelectionSettings): SelectionResult {
    if (!SUPPORTED_REFERENCE_VERSIONS.has(settings.complexityReferenceVersion)) {
      throw new Error(`Unsupported complexity reference version ${settings.complexityReferenceVersion}.`);
    }

    const sources = this.registry.selectableSources();
    const sourceEntries = sources.map((source) => {
      const sourceWeight = settings.sourceWeights[source.id];
      if (sourceWeight === undefined) throw new Error(`Missing source weight for ${source.id}.`);
      const rows = sourceCatalogRows(source);
      const sourceRowCount = rows.length;
      return {
        source,
        sourceWeight,
        sourceRowCount,
        sourceMass: sourceRowCount * sourceWeight,
      };
    });
    const totalSourceMass = sourceEntries.reduce((sum, entry) => sum + entry.sourceMass, 0);
    if (!(totalSourceMass > 0)) throw new Error('Source selection has zero total mass.');

    const selectedSourceEntry = weightedPick(sourceEntries, (entry) => entry.sourceMass, this.random);
    const sourceProbability = selectedSourceEntry.sourceMass / totalSourceMass;

    const classMasses = this.classMasses(
      settings.complexityPercentileTarget,
      settings.complexityPercentileSpread,
    );
    const classByWordCount = new Map(classMasses.map((item) => [item.wordCount, item]));
    const rowsByWordCount = sourceWordCountMap(selectedSourceEntry.source);

    const sourceClasses = [...rowsByWordCount.entries()].map(([wordCount, rows]) => {
      const complexity = classByWordCount.get(wordCount);
      if (!complexity) throw new Error(`Word count ${wordCount} is absent from the global reference.`);
      return {
        wordCount,
        rows,
        complexity,
        sourceClassMass: rows.length * complexity.perRowMass,
      };
    });
    const denominator = sourceClasses.reduce((sum, item) => sum + item.sourceClassMass, 0);
    if (!(denominator > 0)) throw new Error('Selected source has zero complexity mass.');

    const selectedClass = weightedPick(sourceClasses, (item) => item.sourceClassMass, this.random);
    const selectedRow = selectedClass.rows[
      Math.min(
        Math.floor(Math.min(Math.max(this.random(), 0), 1 - Number.EPSILON) * selectedClass.rows.length),
        selectedClass.rows.length - 1,
      )
    ];
    if (!selectedRow) throw new Error('Selected complexity class contains no row.');

    const rowProbabilityWithinSource = selectedClass.complexity.perRowMass / denominator;
    const overallProbability = sourceProbability * rowProbabilityWithinSource;
    const sigma = Math.max(
      settings.complexityPercentileSpread / CENTRAL_98_Z,
      Number.MIN_VALUE,
    );

    const complexityValue = selectedRow.complexityValue ?? selectedRow.wordCount;
    const snapshot: SelectionSnapshot = {
      sourceWeights: { ...settings.sourceWeights },
      sourceId: selectedSourceEntry.source.id,
      sourceRowCount: selectedSourceEntry.sourceRowCount,
      sourceWeight: selectedSourceEntry.sourceWeight,
      sourceMass: selectedSourceEntry.sourceMass,
      totalSourceMass,
      sourceProbability,
      sourceKey: selectedRow.sourceKey,
      wordCount: selectedRow.wordCount,
      complexityMetric: 'grapheme-count',
      complexityValue,
      intrinsicComplexityValue: complexityValue,
      complexityReferenceVersion: settings.complexityReferenceVersion,
      complexityPercentileTarget: settings.complexityPercentileTarget,
      complexityPercentileSpread: settings.complexityPercentileSpread,
      derivedStandardDeviation: sigma,
      globalPercentileStart: selectedClass.complexity.percentileStart,
      globalPercentileEnd: selectedClass.complexity.percentileEnd,
      globalIntervalMass: selectedClass.complexity.intervalMass,
      globalRowsAtWordCount: selectedClass.complexity.globalCount,
      globalRowsAtComplexityValue: selectedClass.complexity.globalCount,
      globalPerRowComplexityMass: selectedClass.complexity.perRowMass,
      selectedSourceRowsAtWordCount: selectedClass.rows.length,
      selectedSourceRowsAtComplexityValue: selectedClass.rows.length,
      selectedSourceNormalizationDenominator: denominator,
      rowProbabilityWithinSource,
      overallProbability,
      globalRowsAtComplexity: selectedClass.complexity.globalCount,
      selectedSourceRowsAtComplexity: selectedClass.rows.length,
    };

    return {
      sourceId: selectedSourceEntry.source.id,
      sourceKey: selectedRow.sourceKey,
      wordCount: selectedRow.wordCount,
      complexityValue,
      snapshot,
    };
  }
}

export const selectionEngine = new SelectionEngine();
