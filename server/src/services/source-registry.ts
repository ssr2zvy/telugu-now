import type { DataSource } from '../domain/source';
import { MockDataSource } from '../sources/mock/mock-data-source';

export class SourceRegistry {
  private readonly sources = new Map<string, DataSource>();

  constructor() {
    this.register(new MockDataSource());
  }

  register(source: DataSource): void {
    if (this.sources.has(source.id)) {
      throw new Error(`Duplicate data source id: ${source.id}`);
    }
    this.sources.set(source.id, source);
  }

  enabledSources(): DataSource[] {
    return [...this.sources.values()].filter((source) => source.enabled);
  }

  get(sourceId: string): DataSource {
    const source = this.sources.get(sourceId);
    if (!source) throw new Error(`Unknown data source: ${sourceId}`);
    return source;
  }
}

export class SourceSelector {
  constructor(private readonly registry: SourceRegistry) {}

  select(): DataSource {
    const sources = this.registry.enabledSources();
    if (sources.length === 0) throw new Error('No enabled data sources.');

    const totalWeight = sources.reduce((sum, source) => sum + Math.max(0, source.selectionWeight), 0);
    if (totalWeight <= 0) return sources[0]!;

    let needle = Math.random() * totalWeight;
    for (const source of sources) {
      needle -= Math.max(0, source.selectionWeight);
      if (needle <= 0) return source;
    }
    return sources[sources.length - 1]!;
  }
}

export const sourceRegistry = new SourceRegistry();
export const sourceSelector = new SourceSelector(sourceRegistry);
