import { db } from '../db/database';
import { sourceRecordService } from './source-record-service';

interface PendingRow {
  id: string;
  source_id: string;
  source_key: string;
}

class PreparationService {
  private running = false;
  private rerunRequested = false;

  kick(): void {
    if (this.running) {
      this.rerunRequested = true;
      return;
    }

    this.running = true;
    void this.runLoop();
  }

  private nextPending(): PendingRow | undefined {
    return db.prepare(`
      SELECT o.id, o.source_id, o.source_key
      FROM queue_items q
      JOIN observations o ON o.id = q.observation_id
      WHERE o.status = 'pending'
      ORDER BY o.selected_at ASC, q.queue_position ASC
      LIMIT 1
    `).get() as PendingRow | undefined;
  }

  private async runLoop(): Promise<void> {
    try {
      do {
        this.rerunRequested = false;
        let pending = this.nextPending();

        while (pending) {
          await this.prepareOne(pending);
          pending = this.nextPending();
        }
      } while (this.rerunRequested);
    } finally {
      this.running = false;
      if (this.rerunRequested || this.nextPending()) this.kick();
    }
  }

  private async prepareOne(row: PendingRow): Promise<void> {
    const claimed = db.prepare(`
      UPDATE observations
      SET status = 'preparing',
          request_started_at = NULL,
          request_completed_at = NULL,
          request_duration_ms = NULL,
          cache_hit = NULL
      WHERE id = ? AND status = 'pending'
    `).run(row.id);

    if (claimed.changes !== 1) return;

    try {
      const resolved = await sourceRecordService.resolve(row.source_id, row.source_key);
      const preparedAt = Date.now();

      db.prepare(`
        UPDATE observations
        SET status = 'ready',
            text = ?,
            prepared_at = ?,
            request_started_at = ?,
            request_completed_at = ?,
            request_duration_ms = ?,
            cache_hit = ?
        WHERE id = ?
      `).run(
        resolved.text,
        preparedAt,
        resolved.requestStartedAt,
        resolved.requestCompletedAt,
        resolved.requestDurationMs,
        resolved.cacheHit ? 1 : 0,
        row.id,
      );
    } catch (error) {
      console.error('Observation preparation failed; returning it to pending.', error);
      db.prepare(`
        UPDATE observations
        SET status = 'pending',
            request_started_at = NULL,
            request_completed_at = NULL,
            request_duration_ms = NULL,
            cache_hit = NULL
        WHERE id = ?
      `).run(row.id);
      await new Promise<void>((resolve) => setTimeout(resolve, 1_000));
    }
  }
}

export const preparationService = new PreparationService();
