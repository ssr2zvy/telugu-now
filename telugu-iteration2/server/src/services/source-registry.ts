import type { DataSource } from '../domain/source';
import { DummyDataSource } from '../sources/dummy/dummy-data-source';
import { source1Rows } from '../sources/dummy/data/source1';
import { source2Rows } from '../sources/dummy/data/source2';
import { source3Rows } from '../sources/dummy/data/source3';

export class SourceRegistry {
  private readonly sources = new Map<string, DataSource>();

  constructor() {
    this.register(new DummyDataSource('source1', source1Rows));
    this.register(new DummyDataSource('source2', source2Rows));
    this.register(new DummyDataSource('source3', source3Rows));
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
}

export const sourceRegistry = new SourceRegistry();
