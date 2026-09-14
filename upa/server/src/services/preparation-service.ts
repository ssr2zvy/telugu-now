import { db } from '../db/database';
import type { MediaItem } from '../../../shared/contracts';
import { sourceRecordService } from './source-record-service';
import { AudioValidationError } from './audio-validation-service';
import { audioValidationStore } from './audio-validation-store';
import { preparedCorpusStore } from '../sources/prepared-corpus/prepared-corpus-store';
import { replaceRejectedQueuedObservation } from './queue-service';
import { SelectionUnavailableError } from './selection-engine';

export class BlacklistedTextError extends Error {
  readonly permanent = true;
  constructor() { super('blacklisted-text'); }
}

interface PendingRow {
  profile_code: string;
  id: string;
  source_id: string;
  source_key: string;
  preparation_attempts: number;
}

const MAX_ATTEMPTS = 3;

class PreparationService {
  private running = false;
  private timer: ReturnType<typeof setTimeout> | undefined;

  checkQueue(profileCode?: string, revalidateAudio = false): void {
    const rows = db.prepare(`
      SELECT o.id, o.source_id, o.audio_validated_at, sr.media_json
      FROM queue_items q JOIN observations o ON o.id = q.observation_id
      LEFT JOIN source_records sr ON sr.profile_code = q.profile_code
        AND sr.source_id = o.source_id AND sr.source_key = o.source_key
      WHERE o.status = 'ready' AND (? IS NULL OR q.profile_code = ?)
    `).all(profileCode ?? null, profileCode ?? null) as Array<{
      id: string; source_id: string; audio_validated_at: number | null; media_json: string | null;
    }>;
    for (const row of rows) {
      let media: MediaItem[];
      try {
        const parsed: unknown = JSON.parse(row.media_json ?? '[]');
        media = Array.isArray(parsed) ? parsed as MediaItem[] : [];
      }
      catch { media = []; }
      const audio = media.filter(item => item.kind === 'audio');
      const expectsAudio = preparedCorpusStore.hasSource(row.source_id)
        || ['fleurs-te', 'shrutilipi-te', 'indicvoices-te'].includes(row.source_id);
      if (((revalidateAudio || row.audio_validated_at === null) && (audio.length > 0 || expectsAudio))
        || audio.some(item => audioValidationStore.invalidReason(item.objectKey))) {
        db.prepare("UPDATE observations SET status = 'pending', audio_validated_at = NULL, preparation_attempts = 0, preparation_retry_at = NULL, preparation_error = NULL WHERE id = ?").run(row.id);
      }
    }
  }

  kick(): void {
    if (this.running) return;
    if (this.timer) { clearTimeout(this.timer); this.timer = undefined; }
    this.checkQueue();
    this.running = true;
    void this.runLoop();
  }

  private nextPending(): PendingRow | undefined {
    return db.prepare(`
      SELECT q.profile_code, o.id, o.source_id, o.source_key, o.preparation_attempts
      FROM queue_items q JOIN observations o ON o.id = q.observation_id
      WHERE o.status = 'pending' AND o.preparation_attempts < ?
        AND (o.preparation_error IS NULL OR o.preparation_retry_at IS NOT NULL)
        AND (o.preparation_retry_at IS NULL OR o.preparation_retry_at <= ?)
      ORDER BY o.selected_at ASC, q.queue_position ASC LIMIT 1
    `).get(MAX_ATTEMPTS, Date.now()) as PendingRow | undefined;
  }

  private async runLoop(): Promise<void> {
    try {
      let pending = this.nextPending();
      while (pending) {
        await this.prepareOne(pending);
        pending = this.nextPending();
      }
    } catch (error) {
      console.error('Preparation worker stopped after an internal error.', error instanceof Error ? error.name : 'Error');
    } finally {
      this.running = false;
      const next = db.prepare(`
        SELECT MIN(o.preparation_retry_at) AS retry_at FROM queue_items q
        JOIN observations o ON o.id = q.observation_id
        WHERE o.status = 'pending' AND o.preparation_attempts < ? AND o.preparation_retry_at IS NOT NULL
      `).get(MAX_ATTEMPTS) as { retry_at: number | null };
      if (next.retry_at !== null) {
        this.timer = setTimeout(() => { this.timer = undefined; this.kick(); }, Math.max(100, next.retry_at - Date.now()));
        this.timer.unref();
      }
    }
  }

  private async prepareOne(row: PendingRow): Promise<void> {
    const claimed = db.prepare(`
      UPDATE observations SET status = 'preparing', preparation_attempts = preparation_attempts + 1,
        request_started_at = NULL, request_completed_at = NULL, request_duration_ms = NULL, cache_hit = NULL
      WHERE id = ? AND status = 'pending'
    `).run(row.id);
    if (claimed.changes !== 1) return;
    try {
      const resolved = await sourceRecordService.resolve(row.profile_code, row.source_id, row.source_key);
      if (db.prepare('SELECT 1 FROM profile_blacklisted_sentences WHERE profile_code = ? AND text = ?')
        .get(row.profile_code, resolved.text)) {
        throw new BlacklistedTextError();
      }
      const preparedAt = Date.now();
      db.prepare(`
        UPDATE observations SET status = 'ready', text = ?, prepared_at = ?, audio_validated_at = ?,
          request_started_at = ?, request_completed_at = ?, request_duration_ms = ?, cache_hit = ?,
          preparation_error = NULL, preparation_retry_at = NULL
        WHERE id = ? AND status = 'preparing'
      `).run(resolved.text, preparedAt, preparedAt, resolved.requestStartedAt, resolved.requestCompletedAt,
        resolved.requestDurationMs, resolved.cacheHit ? 1 : 0, row.id);
    } catch (error) {
      let code = error instanceof AudioValidationError ? error.code
        : error instanceof BlacklistedTextError ? error.message : 'source-preparation-unavailable';
      let exhausted = row.preparation_attempts + 1 >= MAX_ATTEMPTS;
      if ((error instanceof AudioValidationError || error instanceof BlacklistedTextError) && error.permanent) {
        try {
          replaceRejectedQueuedObservation(row.id);
          return;
        } catch (replacementError) {
          code = replacementError instanceof SelectionUnavailableError ? 'no-selectable-replacement' : 'queue-replacement-unavailable';
          if (replacementError instanceof SelectionUnavailableError) exhausted = true;
          else console.error('Rejected audio replacement failed.', replacementError instanceof Error ? replacementError.name : 'Error');
        }
      }
      db.prepare(`
        UPDATE observations SET status = 'pending', preparation_error = ?, preparation_retry_at = ?,
          preparation_attempts = ?, audio_validated_at = NULL
        WHERE id = ?
      `).run(code, exhausted ? null : Date.now() + (row.preparation_attempts === 0 ? 1_000 : 5_000),
        row.preparation_attempts + 1, row.id);
      console.error(`Observation preparation failed (${code}); ${exhausted ? 'preparation stopped' : 'retry scheduled'}.`);
    }
  }
}

export const preparationService = new PreparationService();
