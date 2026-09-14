import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { config } from '../../config/config';
import type { DataSourceInfo } from '../../../../shared/contracts';
import { openAvailability, type AvailabilityOptions } from '../../services/corpus-availability';
import { AudioValidationStore, audioStorageIdentity } from '../../services/audio-validation-store';

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
  private availabilityGeneration = '';
  private exclusionRevision = -1;
  private readonly excluded = new Map<string, Map<number, number[]>>();
  private readonly validation: AudioValidationStore;

  get generation(): string {
    this.refreshExclusions();
    return this.exclusionRevision > 0 ? `${this.availabilityGeneration}:validation-${this.exclusionRevision}` : this.availabilityGeneration;
  }

  constructor(databasePath = config.corpusDatabasePath, private readonly options: AvailabilityOptions = {
    ...config,
    corpusDatabasePath: databasePath,
    corpusAvailabilityPath: databasePath === config.corpusDatabasePath
      ? config.corpusAvailabilityPath : path.join(path.dirname(databasePath), 'availability.sqlite'),
    corpusObjectsPath: databasePath === config.corpusDatabasePath
      ? config.corpusObjectsPath : path.join(path.dirname(databasePath), 'objects'),
  }) {
    this.validation = new AudioValidationStore(
      options.corpusAvailabilityPath === config.corpusAvailabilityPath
        ? config.audioValidationPath : path.join(path.dirname(options.corpusAvailabilityPath), 'audio-validation.sqlite'),
      audioStorageIdentity(options),
    );
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
    if (metadata.generation === this.availabilityGeneration) {
      next.close();
      return;
    }
    const previous = this.availability;
    this.availability = next;
    this.availabilityGeneration = metadata.generation;
    this.exclusionRevision = -1;
    previous?.close();
  }

  close(): void {
    this.availability?.close();
    this.db?.close();
    this.validation.close();
  }

  private refreshExclusions(): void {
    if (!this.db || !this.availability) return;
    const revision = this.validation.revision;
    if (revision === this.exclusionRevision) return;
    this.excluded.clear();
    const keys = this.validation.invalidKeys();
    if (keys.length) {
      const rows = this.db.prepare(`
        SELECT source_id, source_key, grapheme_count FROM source_rows
        WHERE audio_object_key IN (SELECT value FROM json_each(?))
      `).iterate(JSON.stringify(keys)) as Iterable<{ source_id: string; source_key: string; grapheme_count: number }>;
      const member = this.availability.prepare(`
        SELECT class_index FROM source_complexity_members WHERE source_id = ? AND source_key = ?
      `);
      for (const row of rows) {
        const index = member.get(row.source_id, row.source_key) as { class_index: number } | undefined;
        if (!index) continue;
        let classes = this.excluded.get(row.source_id);
        if (!classes) { classes = new Map(); this.excluded.set(row.source_id, classes); }
        const indices = classes.get(row.grapheme_count) ?? [];
        indices.push(index.class_index);
        classes.set(row.grapheme_count, indices);
      }
      for (const classes of this.excluded.values()) for (const indices of classes.values()) indices.sort((a, b) => a - b);
    }
    this.exclusionRevision = revision;
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
    this.refreshExclusions();
    if (!this.availability) return 0;
    const row = this.availability.prepare(
      'SELECT row_count FROM source_counts WHERE source_id = ?',
    ).get(sourceId) as { row_count: number } | undefined;
    const excluded = [...(this.excluded.get(sourceId)?.values() ?? [])].reduce((sum, indices) => sum + indices.length, 0);
    return (row?.row_count ?? 0) - excluded;
  }

  complexityClasses(sourceId: string): Array<{ complexityValue: number; rowCount: number }> {
    this.refreshExclusions();
    if (!this.availability) return [];
    const classes = this.availability.prepare(`
      SELECT grapheme_count AS complexityValue, row_count AS rowCount
      FROM complexity_counts
      WHERE source_id = ?
      ORDER BY grapheme_count ASC
    `).all(sourceId) as Array<{ complexityValue: number; rowCount: number }>;
    return classes.map(item => ({
      ...item,
      rowCount: item.rowCount - (this.excluded.get(sourceId)?.get(item.complexityValue)?.length ?? 0),
    })).filter(item => item.rowCount > 0);
  }

  sourceKeyAt(
    sourceId: string,
    graphemeCount: number,
    classIndex: number,
  ): string {
    this.refreshExclusions();
    if (!this.availability) throw new Error(`CORPUS_AVAILABILITY_MISSING:${sourceId}`);
    let availableIndex = classIndex;
    for (const rejected of this.excluded.get(sourceId)?.get(graphemeCount) ?? []) {
      if (rejected > availableIndex) break;
      availableIndex++;
    }
    const row = this.availability.prepare(`
      SELECT source_key FROM source_complexity_members
      WHERE source_id = ? AND grapheme_count = ? AND class_index = ?
    `).get(sourceId, graphemeCount, availableIndex) as { source_key?: string } | undefined;
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
