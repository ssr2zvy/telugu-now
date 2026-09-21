import type { DisplayRepeatDiagnostic } from '../../../shared/contracts';
import { db } from '../db/database';

function displaySnapshot(now: number, count: number, previousSeenAt: number | null, otherCount: number, otherSeenAt: number | null): DisplayRepeatDiagnostic {
  return {
    firstDisplayedAt: now,
    recording: {
      isRepeat: count > 1,
      occurrenceCount: count,
      knownOccurrenceCount: count,
      previousSeenAt,
    },
    sameTextOtherRecordings: {
      seenBefore: otherCount > 0,
      previousDisplayCount: otherCount,
      knownPreviousDisplayCount: otherCount,
      previousSeenAt: otherSeenAt,
    },
  };
}

export function getDisplayRepeat(profile: string, observationId: string, raw: string | null): DisplayRepeatDiagnostic {
  if (raw) {
    const saved = JSON.parse(raw) as DisplayRepeatDiagnostic;
    return displaySnapshot(saved.firstDisplayedAt, saved.recording.knownOccurrenceCount, saved.recording.previousSeenAt,
      saved.sameTextOtherRecordings.knownPreviousDisplayCount, saved.sameTextOtherRecordings.previousSeenAt);
  }
  const current = db.prepare(`
    SELECT h.history_position, h.absolute_started_at, o.source_id, o.source_key, o.text
    FROM history_entries h JOIN observations o ON o.id = h.observation_id
    WHERE h.profile_code = ? AND h.observation_id = ?
  `).get(profile, observationId) as { history_position: number; absolute_started_at: number; source_id: string; source_key: string; text: string } | undefined;
  if (!current) throw new Error(`DISPLAY_REPEAT_HISTORY_MISSING:${observationId}`);
  // Old entries have no snapshot. Reconstruct their recorded predecessors only;
  // later history entries must not make an earlier entry look like a repeat.
  const prior = db.prepare(`
    SELECT COUNT(*) AS count, MAX(h.absolute_started_at) AS last_seen_at
    FROM history_entries h JOIN observations o ON o.id = h.observation_id
    WHERE h.profile_code = ? AND h.history_position < ? AND o.source_id = ? AND o.source_key = ?
  `).get(profile, current.history_position, current.source_id, current.source_key) as { count: number; last_seen_at: number | null };
  const other = db.prepare(`
    SELECT COUNT(*) AS count, MAX(h.absolute_started_at) AS last_seen_at
    FROM history_entries h JOIN observations o ON o.id = h.observation_id
    WHERE h.profile_code = ? AND h.history_position < ? AND o.text = ?
      AND NOT (o.source_id = ? AND o.source_key = ?)
  `).get(profile, current.history_position, current.text, current.source_id, current.source_key) as { count: number; last_seen_at: number | null };
  const snapshot = displaySnapshot(current.absolute_started_at, prior.count + 1, prior.last_seen_at, other.count, other.last_seen_at);
  db.prepare('UPDATE observations SET repeat_snapshot_json = ? WHERE id = ? AND repeat_snapshot_json IS NULL')
    .run(JSON.stringify(snapshot), observationId);
  return snapshot;
}

// Called only inside the transaction admitting a recording to history for the first
// time. Aggregate rows intentionally outlive observations/history pruning.
export function recordFirstDisplay(profile: string, observationId: string, now: number): void {
  const observation = db.prepare('SELECT source_id, source_key, text FROM observations WHERE id = ?')
    .get(observationId) as { source_id: string; source_key: string; text: string };
  const prior = db.prepare(`
    SELECT COALESCE(SUM(occurrence_count), 0) AS occurrence_count, MAX(last_seen_at) AS last_seen_at FROM recording_displays
    WHERE profile_code = ? AND source_id = ? AND source_key = ?
  `).get(profile, observation.source_id, observation.source_key) as { occurrence_count: number; last_seen_at: number | null };
  const counterparts = db.prepare(`
    SELECT COALESCE(SUM(occurrence_count), 0) AS count, MAX(last_seen_at) AS last_seen_at
    FROM recording_displays WHERE profile_code = ? AND text = ?
      AND NOT (source_id = ? AND source_key = ?)
  `).get(profile, observation.text, observation.source_id, observation.source_key) as { count: number; last_seen_at: number | null };
  const repeat = displaySnapshot(now, prior.occurrence_count + 1, prior.last_seen_at, counterparts.count, counterparts.last_seen_at);
  db.prepare(`
    INSERT INTO recording_displays VALUES (?, ?, ?, ?, 1, ?)
    ON CONFLICT(profile_code, source_id, source_key, text) DO UPDATE SET
      occurrence_count = occurrence_count + 1, last_seen_at = excluded.last_seen_at
  `).run(profile, observation.source_id, observation.source_key, observation.text, now);
  db.prepare('UPDATE observations SET repeat_snapshot_json = ? WHERE id = ?').run(JSON.stringify(repeat), observationId);
}
