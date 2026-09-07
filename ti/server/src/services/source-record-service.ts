import { db } from '../db/database';
import { sourceRegistry } from './source-registry';
import { LegacyIteration1MockDataSource } from '../sources/mock/mock-data-source';

export interface ResolvedSourceRecord {
  sourceId: string;
  sourceKey: string;
  text: string;
  cacheHit: boolean;
  requestStartedAt: number | null;
  requestCompletedAt: number | null;
  requestDurationMs: number | null;
}

interface CachedRow {
  text: string;
}

interface FreshResolution {
  text: string;
  requestStartedAt: number;
  requestCompletedAt: number;
  requestDurationMs: number;
}

class SourceRecordService {
  private readonly legacyIteration1Resolver = new LegacyIteration1MockDataSource();
  private readonly inFlight = new Map<string, Promise<FreshResolution>>();

  private cacheKey(sourceId: string, sourceKey: string): string {
    return `${sourceId}\u0000${sourceKey}`;
  }

  private cached(sourceId: string, sourceKey: string): CachedRow | undefined {
    return db.prepare(`
      SELECT text
      FROM source_records
      WHERE source_id = ? AND source_key = ?
    `).get(sourceId, sourceKey) as CachedRow | undefined;
  }

  async resolve(sourceId: string, sourceKey: string): Promise<ResolvedSourceRecord> {
    const existing = this.cached(sourceId, sourceKey);
    if (existing) {
      return {
        sourceId,
        sourceKey,
        text: existing.text,
        cacheHit: true,
        requestStartedAt: null,
        requestCompletedAt: null,
        requestDurationMs: null,
      };
    }

    const key = this.cacheKey(sourceId, sourceKey);
    let promise = this.inFlight.get(key);
    if (!promise) {
      promise = this.fetchAndCache(sourceId, sourceKey);
      this.inFlight.set(key, promise);
      const cleanup = () => {
        if (this.inFlight.get(key) === promise) this.inFlight.delete(key);
      };
      void promise.then(cleanup, cleanup);
    }

    const fresh = await promise;
    return {
      sourceId,
      sourceKey,
      text: fresh.text,
      cacheHit: false,
      requestStartedAt: fresh.requestStartedAt,
      requestCompletedAt: fresh.requestCompletedAt,
      requestDurationMs: fresh.requestDurationMs,
    };
  }

  private async fetchAndCache(sourceId: string, sourceKey: string): Promise<FreshResolution> {
    const requestStartedAt = Date.now();
    const source = sourceId === this.legacyIteration1Resolver.id
      ? this.legacyIteration1Resolver
      : sourceRegistry.get(sourceId);
    const prepared = await source.prepare({ sourceKey });
    const requestCompletedAt = Date.now();

    db.prepare(`
      INSERT INTO source_records (source_id, source_key, text, prepared_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(source_id, source_key) DO UPDATE SET
        text = excluded.text,
        prepared_at = excluded.prepared_at
    `).run(sourceId, sourceKey, prepared.text, requestCompletedAt);

    return {
      text: prepared.text,
      requestStartedAt,
      requestCompletedAt,
      requestDurationMs: requestCompletedAt - requestStartedAt,
    };
  }
}

export const sourceRecordService = new SourceRecordService();
