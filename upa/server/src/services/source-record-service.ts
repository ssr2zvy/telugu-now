import type { MediaItem } from '../../../shared/contracts';
import { db } from '../db/database';
import { sourceRegistry } from './source-registry';
import { LegacyIteration1MockDataSource } from '../sources/mock/mock-data-source';

export interface ResolvedSourceRecord {
  sourceId: string;
  sourceKey: string;
  text: string;
  media: MediaItem[];
  cacheHit: boolean;
  requestStartedAt: number | null;
  requestCompletedAt: number | null;
  requestDurationMs: number | null;
}

interface CachedRow {
  text: string;
  media_json: string;
}

interface FreshResolution {
  text: string;
  media: MediaItem[];
  requestStartedAt: number;
  requestCompletedAt: number;
  requestDurationMs: number;
}

class SourceRecordService {
  private readonly legacyIteration1Resolver = new LegacyIteration1MockDataSource();
  private readonly inFlight = new Map<string, Promise<FreshResolution>>();

  private cacheKey(profileCode: string, sourceId: string, sourceKey: string): string {
    return JSON.stringify([profileCode, sourceId, sourceKey]);
  }

  private cached(profileCode: string, sourceId: string, sourceKey: string): CachedRow | undefined {
    return db.prepare(`
      SELECT text, media_json
      FROM source_records
      WHERE profile_code = ? AND source_id = ? AND source_key = ?
    `).get(profileCode, sourceId, sourceKey) as CachedRow | undefined;
  }

  async resolve(profileCode: string, sourceId: string, sourceKey: string): Promise<ResolvedSourceRecord> {
    if (!db.prepare('SELECT 1 FROM profiles WHERE code = ?').get(profileCode)) throw new Error('Unknown cache profile.');
    const existing = this.cached(profileCode, sourceId, sourceKey);
    if (existing) {
      const parsed = JSON.parse(
        existing.media_json,
      ) as MediaItem[];
      const media = parsed.length > 0
        ? parsed
        : [
            {
              kind: 'text' as const,
              language: 'te' as const,
              text: existing.text,
            },
          ];
      return {
        sourceId,
        sourceKey,
        text: existing.text,
        media,
        cacheHit: true,
        requestStartedAt: null,
        requestCompletedAt: null,
        requestDurationMs: null,
      };
    }

    const key = this.cacheKey(profileCode, sourceId, sourceKey);
    let promise = this.inFlight.get(key);
    if (!promise) {
      promise = this.fetchAndCache(profileCode, sourceId, sourceKey);
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
      media: fresh.media,
      cacheHit: false,
      requestStartedAt: fresh.requestStartedAt,
      requestCompletedAt: fresh.requestCompletedAt,
      requestDurationMs: fresh.requestDurationMs,
    };
  }

  private async fetchAndCache(profileCode: string, sourceId: string, sourceKey: string): Promise<FreshResolution> {
    const requestStartedAt = Date.now();
    const source = sourceId === this.legacyIteration1Resolver.id
      ? this.legacyIteration1Resolver
      : sourceRegistry.get(sourceId);
    const prepared = await source.prepare(sourceKey);
    const requestCompletedAt = Date.now();

    db.prepare(`
      INSERT INTO source_records (profile_code, source_id, source_key, text, media_json, prepared_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(profile_code, source_id, source_key) DO UPDATE SET
        text = excluded.text, media_json = excluded.media_json, prepared_at = excluded.prepared_at
    `).run(profileCode, sourceId, sourceKey, prepared.text, JSON.stringify(prepared.media), requestCompletedAt);

    return {
      text: prepared.text,
      media: prepared.media,
      requestStartedAt,
      requestCompletedAt,
      requestDurationMs: requestCompletedAt - requestStartedAt,
    };
  }
}

export const sourceRecordService = new SourceRecordService();
