import type { DisplayRepeatDiagnostic } from '../../../shared/contracts';
import { db } from '../db/database';

// Called only inside the transaction admitting a recording to history for the first
// time. Aggregate rows intentionally outlive observations/history pruning.
export function recordFirstDisplay(profile: string, observationId: string, now: number): void {
  const observation = db.prepare('SELECT source_id, source_key, text FROM observations WHERE id = ?')
    .get(observationId) as { source_id: string; source_key: string; text: string };
  const complete = (db.prepare('SELECT repeat_tracking_complete FROM profiles WHERE code = ?')
    .get(profile) as { repeat_tracking_complete: number }).repeat_tracking_complete === 1;
  const prior = db.prepare(`
    SELECT COALESCE(SUM(occurrence_count), 0) AS occurrence_count, MAX(last_seen_at) AS last_seen_at FROM recording_displays
    WHERE profile_code = ? AND source_id = ? AND source_key = ?
  `).get(profile, observation.source_id, observation.source_key) as { occurrence_count: number; last_seen_at: number | null };
  const counterparts = db.prepare(`
    SELECT COALESCE(SUM(occurrence_count), 0) AS count, MAX(last_seen_at) AS last_seen_at
    FROM recording_displays WHERE profile_code = ? AND text = ?
      AND NOT (source_id = ? AND source_key = ?)
  `).get(profile, observation.text, observation.source_id, observation.source_key) as { count: number; last_seen_at: number | null };
  const count = prior.occurrence_count + 1;
  const repeat: DisplayRepeatDiagnostic = {
    firstDisplayedAt: now,
    recording: {
      isRepeat: prior.occurrence_count > 0 ? true : complete ? false : null,
      occurrenceCount: complete ? count : null,
      knownOccurrenceCount: count,
      previousSeenAt: prior.last_seen_at,
    },
    sameTextOtherRecordings: {
      seenBefore: counterparts.count > 0 ? true : complete ? false : null,
      previousDisplayCount: complete ? counterparts.count : null,
      knownPreviousDisplayCount: counterparts.count,
      previousSeenAt: counterparts.last_seen_at,
    },
  };
  db.prepare(`
    INSERT INTO recording_displays VALUES (?, ?, ?, ?, 1, ?)
    ON CONFLICT(profile_code, source_id, source_key, text) DO UPDATE SET
      occurrence_count = occurrence_count + 1, last_seen_at = excluded.last_seen_at
  `).run(profile, observation.source_id, observation.source_key, observation.text, now);
  db.prepare('UPDATE observations SET repeat_snapshot_json = ? WHERE id = ?').run(JSON.stringify(repeat), observationId);
}
