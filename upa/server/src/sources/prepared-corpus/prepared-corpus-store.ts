import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { config } from '../../config/config';
import type { DataSourceInfo } from '../../../../shared/contracts';
import { openAvailability, type AvailabilityOptions } from '../../services/corpus-availability';

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
  private availability: Database.Database | null = null;
  generation = '';

  constructor(databasePath = config.corpusDatabasePath, private readonly options: AvailabilityOptions = {
    ...config,
    corpusDatabasePath: databasePath,
    corpusAvailabilityPath: databasePath === config.corpusDatabasePath
      ? config.corpusAvailabilityPath : path.join(path.dirname(databasePath), 'availability.sqlite'),
    corpusObjectsPath: databasePath === config.corpusDatabasePath
      ? config.corpusObjectsPath : path.join(path.dirname(databasePath), 'objects'),
  }) {
    this.db = fs.existsSync(databasePath)
      ? new Database(databasePath, {
          readonly: true,
          fileMustExist: true,
        })
      : null;
    if (this.db) this.reloadAvailability();
  }

  reloadAvailability(): void {
    const next = openAvailability(this.options);
    if (!next) return;
    const metadata = next.prepare('SELECT generation FROM metadata').get() as { generation: string };
    if (metadata.generation === this.generation) {
      next.close();
      return;
    }
    const previous = this.availability;
    this.availability = next;
    this.generation = metadata.generation;
    previous?.close();
  }

  close(): void {
    this.availability?.close();
    this.db?.close();
  }

  hasSource(sourceId: string): boolean {
    if (!this.db) return false;
    return Boolean(
      this.db.prepare(
        `
        SELECT 1
        FROM sources
        WHERE source_id = ?
          AND status = 'ready'
          AND complexity_metric = 'grapheme-count'
          AND accepted_rows > 0
        LIMIT 1
      `,
      ).get(sourceId),
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
      acceptedRows: this.rowCount(sourceId),
      rejectedRows: Number(row.rejected_rows ?? 0),
      complexityMetric: String(row.complexity_metric ?? 'grapheme-count') === 'word-count' ? 'word-count' : 'grapheme-count',
      status: status === 'ready' ? 'ready' : status === 'fixture' ? 'fixture' : 'invalid',
    };
  }

  rowCount(sourceId: string): number {
    if (!this.availability) return 0;
    const row = this.availability.prepare(
      'SELECT row_count FROM source_counts WHERE source_id = ?',
    ).get(sourceId) as { row_count: number } | undefined;
    return row?.row_count ?? 0;
  }

  complexityClasses(sourceId: string): Array<{ complexityValue: number; rowCount: number }> {
    if (!this.availability) return [];
    return this.availability.prepare(`
      SELECT grapheme_count AS complexityValue, row_count AS rowCount
      FROM complexity_counts
      WHERE source_id = ?
      ORDER BY grapheme_count ASC
    `).all(sourceId) as Array<{ complexityValue: number; rowCount: number }>;
  }

  sourceKeyAt(
    sourceId: string,
    graphemeCount: number,
    classIndex: number,
  ): string {
    if (!this.availability) throw new Error(`CORPUS_AVAILABILITY_MISSING:${sourceId}`);
    const row = this.availability.prepare(`
      SELECT source_key FROM source_complexity_members
      WHERE source_id = ? AND grapheme_count = ? AND class_index = ?
    `).get(sourceId, graphemeCount, classIndex) as { source_key?: string } | undefined;
    if (!row?.source_key) throw new Error('CORPUS_SOURCE_KEY_MISSING:' + `${sourceId}/${graphemeCount}/${classIndex}`);
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
