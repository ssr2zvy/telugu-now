import { config } from '../../config/config';
import type {
  DataSource,
  PreparedSourceObservation,
  SourceCandidate,
  SourceCatalogRow,
} from '../../domain/source';

export interface DummyRow {
  sourceKey: string;
  text: string;
}

function randomIntInclusive(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function wordCount(text: string): number {
  const normalized = text.trim().replace(/\s+/g, ' ');
  return normalized.length === 0 ? 0 : normalized.split(' ').length;
}

export class DummyDataSource implements DataSource {
  readonly enabled = true;
  private readonly byKey = new Map<string, DummyRow>();
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
      this.byKey.set(row.sourceKey, row);
      return { sourceKey: row.sourceKey, wordCount: count };
    });
  }

  catalog(): readonly SourceCatalogRow[] {
    return this.selectionCatalog;
  }

  async prepare(candidate: SourceCandidate): Promise<PreparedSourceObservation> {
    const row = this.byKey.get(candidate.sourceKey);
    if (!row) throw new Error(`Unknown ${this.id} row: ${candidate.sourceKey}`);

    const delayMs = randomIntInclusive(config.mockDelayMinMs, config.mockDelayMaxMs);
    await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
    return { text: row.text };
  }
}
