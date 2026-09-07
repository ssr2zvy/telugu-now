import { config } from '../../config/config';
import type {
  DataSource,
  PreparedSourceObservation,
  SourceCandidate,
  SourceCatalogRow,
  SourceComplexityClass,
} from '../../domain/source';

export interface DummyRow {
  sourceKey: string;
  text: string;
}

const graphemeSegmenter = new Intl.Segmenter('te', { granularity: 'grapheme' });

function randomIntInclusive(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function wordCount(text: string): number {
  const normalized = text.trim().replace(/\s+/g, ' ');
  return normalized.length === 0 ? 0 : normalized.split(' ').length;
}

function graphemeCount(text: string): number {
  return [...graphemeSegmenter.segment(text.normalize('NFC'))].length;
}

export class DummyDataSource implements DataSource {
  readonly enabled = true;
  private readonly byKey = new Map<string, DummyRow>();
  private readonly byComplexity = new Map<number, DummyRow[]>();
  private readonly selectionCatalog: SourceCatalogRow[];

  constructor(
    readonly id: string,
    rows: readonly DummyRow[],
  ) {
    if (rows.length === 0) throw new Error(`Dummy source ${id} must not be empty.`);

    this.selectionCatalog = rows.map((row) => {
      if (this.byKey.has(row.sourceKey)) {
        throw new Error(`Duplicate row key in ${id}: ${row.sourceKey}`);
      }
      const count = wordCount(row.text);
      if (count <= 0) throw new Error(`Empty dummy row in ${id}: ${row.sourceKey}`);
      const complexityValue = graphemeCount(row.text);
      this.byKey.set(row.sourceKey, row);
      const complexityRows = this.byComplexity.get(complexityValue) ?? [];
      complexityRows.push(row);
      this.byComplexity.set(complexityValue, complexityRows);
      return { sourceKey: row.sourceKey, wordCount: count, complexityValue };
    });
  }

  catalog(): readonly SourceCatalogRow[] {
    return this.selectionCatalog;
  }

  rowCount(): number {
    return this.byKey.size;
  }

  complexityClasses(): readonly SourceComplexityClass[] {
    return [...this.byComplexity.entries()]
      .map(([complexityValue, rows]) => ({ complexityValue, rowCount: rows.length }))
      .sort((left, right) => left.complexityValue - right.complexityValue);
  }

  candidateAt(complexityValue: number, classIndex: number): SourceCandidate {
    const rows = this.byComplexity.get(complexityValue) ?? [];
    const row = rows[classIndex];
    if (!row) {
      throw new Error(`Invalid complexity member ${this.id}/${complexityValue}/${classIndex}.`);
    }
    return { sourceKey: row.sourceKey, complexityValue };
  }

  info() {
    return {
      sourceId: this.id,
      displayName: this.id,
      provider: 'Telugu Now',
      license: 'Development fixture',
      upstreamUrl: null,
      catalogVersion: 2,
      acceptedRows: this.rowCount(),
      rejectedRows: 0,
      complexityMetric: 'grapheme-count' as const,
      status: 'fixture' as const,
    };
  }

  async prepare(candidate: SourceCandidate): Promise<PreparedSourceObservation> {
    const row = this.byKey.get(candidate.sourceKey);
    if (!row) throw new Error(`Unknown ${this.id} row: ${candidate.sourceKey}`);

    const delayMs = randomIntInclusive(config.mockDelayMinMs, config.mockDelayMaxMs);
    await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
    return {
      text: row.text,
      media: [
        { kind: 'text', language: 'te', text: row.text },
      ],
    };
  }
}
