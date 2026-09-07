import { PreparedCorpusDataSource } from '../sources/prepared-corpus/prepared-corpus-data-source';
import { preparedCorpusStore } from '../sources/prepared-corpus/prepared-corpus-store';
import type { DataSource } from '../domain/source';
import { DummyDataSource } from '../sources/dummy/dummy-data-source';
import { source1Rows } from '../sources/dummy/data/source1';
import { source2Rows } from '../sources/dummy/data/source2';
import { source3Rows } from '../sources/dummy/data/source3';

const REQUIRED_PREPARED_SOURCE_IDS = ['fleurs-te', 'shrutilipi-te', 'indicvoices-te'] as const;

export class SourceRegistry {
  private readonly sources = new Map<string, DataSource>();

  constructor() {
    this.register(new DummyDataSource('source1', source1Rows));
    this.register(new DummyDataSource('source2', source2Rows));
    this.register(new DummyDataSource('source3', source3Rows));

    for (const sourceId of REQUIRED_PREPARED_SOURCE_IDS) {
      if (preparedCorpusStore.hasSource(sourceId)) {
        this.register(new PreparedCorpusDataSource(sourceId));
      }
    }
  }

  register(source: DataSource): void {
    if (this.sources.has(source.id)) throw new Error(`Duplicate data source id: ${source.id}`);
    this.sources.set(source.id, source);
  }

  selectableSources(): DataSource[] {
    return [...this.sources.values()].filter((source) => source.enabled);
  }

  selectableSourceIds(): string[] {
    return this.selectableSources().map((source) => source.id);
  }

  get(sourceId: string): DataSource {
    const source = this.sources.get(sourceId);
    if (!source) throw new Error(`Unknown data source: ${sourceId}`);
    return source;
  }

  assertPreparedSourcesPresent(): void {
    const missing = REQUIRED_PREPARED_SOURCE_IDS.filter((sourceId) => !this.sources.has(sourceId));
    if (missing.length > 0) throw new Error(`CORPUS_NOT_PREPARED:${missing.join(',')}`);
  }

  sourceInfo() {
    return this.selectableSources().map((source) => source.info?.() ?? {
      sourceId: source.id,
      displayName: source.id,
      provider: 'unknown',
      license: 'unknown',
      upstreamUrl: null,
      catalogVersion: 1,
      acceptedRows: source.rowCount?.() ?? 0,
      rejectedRows: 0,
      complexityMetric: 'grapheme-count',
      status: 'fixture' as const,
    });
  }
}

export const sourceRegistry = new SourceRegistry();
