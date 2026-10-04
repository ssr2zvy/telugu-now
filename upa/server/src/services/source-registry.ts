import type { DataSource } from '../domain/source';
import { PreparedCorpusDataSource } from '../sources/prepared-corpus/prepared-corpus-data-source';
import { preparedCorpusStore } from '../sources/prepared-corpus/prepared-corpus-store';
import { DummyDataSource } from '../sources/dummy/dummy-data-source';
import { source1Rows } from '../sources/dummy/data/source1';
import { source2Rows } from '../sources/dummy/data/source2';
import { source3Rows } from '../sources/dummy/data/source3';

const REQUIRED_PREPARED_SOURCE_IDS = [
  'fleurs-te',
  'shrutilipi-te',
  'indicvoices-te',
] as const;

const DUMMY_SOURCE_ROWS = [
  ['source1', source1Rows],
  ['source2', source2Rows],
  ['source3', source3Rows],
] as const;

export class SourceRegistry {
  private readonly sources = new Map<string, DataSource>();
  private revision = 0;

  get generation(): string {
    return `${this.revision}:${[...this.sources.values()].map(source => source.generation ?? '').join(':')}`;
  }

  constructor(options: { includePreparedSources?: boolean } = {}) {
    // The committed dummy fixtures are always available (they ship with the
    // source code) and give every profile a guaranteed-selectable baseline even
    // before any real corpus has been prepared, so they are registered
    // unconditionally ahead of the optional prepared sources below.
    for (const [sourceId, rows] of DUMMY_SOURCE_ROWS) {
      this.register(new DummyDataSource(sourceId, rows));
    }

    if (options.includePreparedSources === false) return;

    for (const sourceId of REQUIRED_PREPARED_SOURCE_IDS) {
      if (preparedCorpusStore.hasSource(sourceId)) {
        this.register(new PreparedCorpusDataSource(sourceId));
      }
    }
  }

  register(source: DataSource): void {
    if (this.sources.has(source.id)) throw new Error(`Duplicate data source id: ${source.id}`);
    this.sources.set(source.id, source);
    this.revision += 1;
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
    if (missing.length > 0) {
      throw new Error(`CORPUS_NOT_PREPARED:${missing.join(',')}`);
    }
  }

  sourceInfo() {
    return this.selectableSources().map((source) => source.info());
  }

}

export const sourceRegistry = new SourceRegistry();
