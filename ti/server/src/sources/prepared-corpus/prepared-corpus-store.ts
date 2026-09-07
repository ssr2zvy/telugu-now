import fs from 'node:fs';
import Database from 'better-sqlite3';
import { config } from '../../config/config';
import type { DataSourceInfo } from '../../../../shared/contracts';

interface CanonicalRow {
  source_id: string;
  source_key: string;
  text: string;
  grapheme_count: number;
  audio_sha256: string;
  audio_object_key: string;
  audio_mime_type: string;
  duration_seconds: number;
}

export class PreparedCorpusStore {
  private readonly db: Database.Database | null;

  constructor(databasePath = config.corpusDatabasePath) {
    this.db = fs.existsSync(databasePath)
      ? new Database(databasePath, {
          readonly: true,
          fileMustExist: true,
        })
      : null;
  }

  hasSource(sourceId: string): boolean {
    if (!this.db) return false;
    return Boolean(
      this.db.prepare(
        `SELECT 1 FROM sources WHERE source_id = ? AND status = ? LIMIT 1`,
      ).get(sourceId, 'ready'),
    );
  }

  sourceInfo(sourceId: string): DataSourceInfo {
    if (!this.db) throw new Error(`CORPUS_SOURCE_MISSING:${sourceId}`);
    const row = this.db.prepare(`
      SELECT source_id, display_name, provider, license, upstream_url,
             catalog_version, accepted_rows, rejected_rows,
             complexity_metric, status
      FROM sources WHERE source_id = ?
    `).get(sourceId) as Record<string, unknown> | undefined;
    if (!row) throw new Error(`CORPUS_SOURCE_MISSING:${sourceId}`);

    const status = String(row.status ?? 'invalid');
    return {
      sourceId: String(row.source_id),
      displayName: String(row.display_name ?? row.source_id),
      provider: String(row.provider ?? 'unknown'),
      license: String(row.license ?? 'unknown'),
      upstreamUrl: typeof row.upstream_url === 'string' ? row.upstream_url : null,
      catalogVersion: Number(row.catalog_version ?? 1),
      acceptedRows: Number(row.accepted_rows ?? 0),
      rejectedRows: Number(row.rejected_rows ?? 0),
      complexityMetric: String(row.complexity_metric ?? 'grapheme-count') === 'word-count' ? 'word-count' : 'grapheme-count',
      status: status === 'ready' ? 'ready' : status === 'fixture' ? 'fixture' : 'invalid',
    };
  }

  rowCount(sourceId: string): number {
    if (!this.db) return 0;
    const row = this.db.prepare(
      'SELECT accepted_rows FROM sources WHERE source_id = ?',
    ).get(sourceId) as { accepted_rows?: number } | undefined;
    return Number(row?.accepted_rows ?? 0);
  }

  complexityClasses(sourceId: string): Array<{ complexityValue: number; rowCount: number }> {
    if (!this.db) return [];
    return this.db.prepare(`
      SELECT grapheme_count AS complexityValue, COUNT(*) AS rowCount
      FROM source_complexity_members
      WHERE source_id = ?
      GROUP BY grapheme_count
      ORDER BY grapheme_count ASC
    `).all(sourceId) as Array<{ complexityValue: number; rowCount: number }>;
  }

  sourceKeyAt(sourceId: string, graphemeCount: number, classIndex: number): string {
    if (!this.db) throw new Error(`CORPUS_SOURCE_MISSING:${sourceId}`);
    const row = this.db.prepare(`
      SELECT source_key
      FROM source_complexity_members
      WHERE source_id = ? AND grapheme_count = ?
      ORDER BY class_index ASC
      LIMIT 1 OFFSET ?
    `).get(sourceId, graphemeCount, classIndex) as { source_key?: string } | undefined;
    if (!row?.source_key) throw new Error(`CORPUS_SOURCE_KEY_MISSING:${sourceId}/${graphemeCount}/${classIndex}`);
    return row.source_key;
  }

  row(sourceId: string, sourceKey: string): CanonicalRow {
    if (!this.db) throw new Error(`CORPUS_SOURCE_MISSING:${sourceId}`);
    const row = this.db.prepare(`
      SELECT source_id, source_key, text, grapheme_count, audio_sha256,
             audio_object_key, audio_mime_type, duration_seconds
      FROM source_rows WHERE source_id = ? AND source_key = ?
    `).get(sourceId, sourceKey) as CanonicalRow | undefined;
    if (!row) throw new Error(`CORPUS_ROW_MISSING:${sourceId}/${sourceKey}`);
    return row;
  }
}

export const preparedCorpusStore = new PreparedCorpusStore();
