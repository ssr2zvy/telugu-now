import { db } from '../db/database';
import { config } from '../config/config';
import type {
  AcquisitionTriggerKind,
  DisplayObservation,
  ObservationStatus,
  ProfileStateResponse,
  QueueSummary,
  SelectionSnapshot,
  TimingSummary,
} from '../../../shared/contracts';
import { appendConsumptionReplacement, ensureLaunchQueue } from './queue-service';
import { preparationService } from './preparation-service';
import { getProfileSelectionSettings } from './selection-settings-service';

interface ProfileRow {
  code: string;
  current_position: number | null;
  last_client_seen_at: number | null;
}

interface TailRow {
  history_position: number;
  absolute_started_at: number;
  absolute_elapsed_ms: number;
  visible_elapsed_ms: number;
  visible_started_at: number | null;
  finalized_at: number | null;
}

interface ObservationRow {
  id: string;
  source_id: string;
  source_key: string;
  text: string;
  acquisition_number: number;
  trigger_kind: AcquisitionTriggerKind;
  trigger_observation_id: string | null;
  trigger_history_position: number | null;
  trigger_acquisition_number: number | null;
  triggered_at: number;
  waiting_ahead_at_trigger: number;
  preparation_in_flight_at_trigger: number;
  request_started_at: number | null;
  request_completed_at: number | null;
  request_duration_ms: number | null;
  cache_hit: number | null;
  selection_snapshot_json: string;
}

interface CountRow { count: number }
interface StatusCountRow { status: ObservationStatus; count: number }
interface MaxRow { max_position: number | null }
interface NextQueueRow { queue_position: number; observation_id: string; status: ObservationStatus }

export class InvalidProfileCodeError extends Error {}
export class NavigationUnavailableError extends Error {}

export function assertValidProfileCode(code: string): void {
  if (!config.profileCodes.has(code)) throw new InvalidProfileCodeError('Invalid profile code.');
}

export function ensureProfileRow(code: string): void {
  assertValidProfileCode(code);
  const now = Date.now();
  db.prepare(`
    INSERT INTO profiles (code, current_position, created_at, updated_at)
    VALUES (?, NULL, ?, ?)
    ON CONFLICT(code) DO NOTHING
  `).run(code, now, now);
  // Selection defaults are lazily persisted for both new and upgraded profiles.
  getProfileSelectionSettings(code);
}

function profileRow(code: string): ProfileRow {
  const row = db.prepare(`
    SELECT code, current_position, last_client_seen_at
    FROM profiles WHERE code = ?
  `).get(code) as ProfileRow | undefined;
  if (!row) throw new Error(`Profile row missing for ${code}`);
  return row;
}

function historyLength(code: string): number {
  return (db.prepare(
    'SELECT COUNT(*) AS count FROM history_entries WHERE profile_code = ?',
  ).get(code) as CountRow).count;
}

function historyTailPosition(code: string): number | null {
  const row = db.prepare(`
    SELECT MAX(history_position) AS max_position
    FROM history_entries WHERE profile_code = ?
  `).get(code) as MaxRow;
  return row.max_position;
}

function tailRow(code: string): TailRow | undefined {
  return db.prepare(`
    SELECT history_position, absolute_started_at, absolute_elapsed_ms,
           visible_elapsed_ms, visible_started_at, finalized_at
    FROM history_entries
    WHERE profile_code = ?
    ORDER BY history_position DESC
    LIMIT 1
  `).get(code) as TailRow | undefined;
}

function closeStaleVisibleInterval(code: string, now: number): void {
  const profile = profileRow(code);
  const tail = tailRow(code);
  if (!tail || tail.finalized_at !== null || tail.visible_started_at === null) return;

  const cutoff = profile.last_client_seen_at ?? tail.visible_started_at;
  const boundedCutoff = Math.max(tail.visible_started_at, Math.min(cutoff, now));
  const delta = boundedCutoff - tail.visible_started_at;

  db.prepare(`
    UPDATE history_entries
    SET visible_elapsed_ms = visible_elapsed_ms + ?, visible_started_at = NULL
    WHERE profile_code = ? AND history_position = ?
  `).run(delta, code, tail.history_position);
}

function setTailVisibility(code: string, visible: boolean, now: number): void {
  const profile = profileRow(code);
  const tail = tailRow(code);

  db.prepare(`
    UPDATE profiles SET last_client_seen_at = ?, updated_at = ? WHERE code = ?
  `).run(now, now, code);

  if (!tail || tail.finalized_at !== null) return;
  if (profile.current_position !== tail.history_position) return;

  if (visible && tail.visible_started_at === null) {
    db.prepare(`
      UPDATE history_entries SET visible_started_at = ?
      WHERE profile_code = ? AND history_position = ?
    `).run(now, code, tail.history_position);
  }

  if (!visible && tail.visible_started_at !== null) {
    db.prepare(`
      UPDATE history_entries
      SET visible_elapsed_ms = visible_elapsed_ms + ?, visible_started_at = NULL
      WHERE profile_code = ? AND history_position = ?
    `).run(now - tail.visible_started_at, code, tail.history_position);
  }
}

function pauseTailVisible(code: string, now: number): void {
  const tail = tailRow(code);
  if (!tail || tail.finalized_at !== null || tail.visible_started_at === null) return;
  db.prepare(`
    UPDATE history_entries
    SET visible_elapsed_ms = visible_elapsed_ms + ?, visible_started_at = NULL
    WHERE profile_code = ? AND history_position = ?
  `).run(now - tail.visible_started_at, code, tail.history_position);
}

function resumeTailVisible(code: string, visible: boolean, now: number): void {
  if (!visible) return;
  const tail = tailRow(code);
  if (!tail || tail.finalized_at !== null || tail.visible_started_at !== null) return;
  db.prepare(`
    UPDATE history_entries SET visible_started_at = ?
    WHERE profile_code = ? AND history_position = ?
  `).run(now, code, tail.history_position);
}

function finalizeTail(code: string, now: number): void {
  const tail = tailRow(code);
  if (!tail || tail.finalized_at !== null) return;

  let visibleElapsed = tail.visible_elapsed_ms;
  if (tail.visible_started_at !== null) visibleElapsed += now - tail.visible_started_at;

  db.prepare(`
    UPDATE history_entries
    SET absolute_elapsed_ms = ?,
        visible_elapsed_ms = ?,
        visible_started_at = NULL,
        finalized_at = ?
    WHERE profile_code = ? AND history_position = ?
  `).run(now - tail.absolute_started_at, visibleElapsed, now, code, tail.history_position);
}

function nextQueueItem(code: string): NextQueueRow | undefined {
  return db.prepare(`
    SELECT q.queue_position, q.observation_id, o.status
    FROM queue_items q
    JOIN observations o ON o.id = q.observation_id
    WHERE q.profile_code = ?
    ORDER BY q.queue_position ASC
    LIMIT 1
  `).get(code) as NextQueueRow | undefined;
}

function parseSelectionSnapshot(raw: string): SelectionSnapshot | null {
  try {
    const value = JSON.parse(raw) as Partial<SelectionSnapshot> & { wordCount?: number; globalRowsAtWordCount?: number; selectedSourceRowsAtWordCount?: number };
    if (typeof value.sourceId !== 'string' || typeof value.sourceKey !== 'string') return null;
    if (value.complexityMetric === undefined && typeof value.wordCount === 'number') {
      return { ...value, complexityMetric: 'word-count', intrinsicComplexityValue: value.wordCount, globalRowsAtComplexityValue: value.globalRowsAtWordCount ?? 0, selectedSourceRowsAtComplexityValue: value.selectedSourceRowsAtWordCount ?? 0 } as SelectionSnapshot;
    }
    return value as SelectionSnapshot;
  } catch { return null; }
}

function currentObservation(code: string, currentPosition: number | null): DisplayObservation | null {
  if (currentPosition === null) return null;
  const row = db.prepare(`
    SELECT o.id, o.source_id, o.source_key, o.text,
           a.acquisition_number, a.trigger_kind, a.trigger_observation_id,
           a.trigger_history_position, ta.acquisition_number AS trigger_acquisition_number,
           a.triggered_at, a.waiting_ahead_at_trigger,
           a.preparation_in_flight_at_trigger,
           a.selection_snapshot_json,
           o.request_started_at, o.request_completed_at, o.request_duration_ms,
           o.cache_hit
    FROM history_entries h
    JOIN observations o ON o.id = h.observation_id
    JOIN observation_acquisitions a ON a.observation_id = o.id
    LEFT JOIN observation_acquisitions ta ON ta.observation_id = a.trigger_observation_id
    WHERE h.profile_code = ? AND h.history_position = ?
  `).get(code, currentPosition) as ObservationRow | undefined;

  if (!row) return null;
  return {
    id: row.id,
    sourceId: row.source_id,
    sourceKey: row.source_key,
    text: row.text,
    diagnostic: {
      acquisitionNumber: row.acquisition_number,
      triggerKind: row.trigger_kind,
      triggeredByObservationId: row.trigger_observation_id,
      triggeredByAcquisitionNumber: row.trigger_acquisition_number,
      triggeredByHistoryPosition: row.trigger_history_position,
      triggeredAt: row.triggered_at,
      waitingAheadAtTrigger: row.waiting_ahead_at_trigger,
      preparationInFlightAtTrigger: row.preparation_in_flight_at_trigger === 1,
      requestStartedAt: row.request_started_at,
      requestCompletedAt: row.request_completed_at,
      requestDurationMs: row.request_duration_ms,
      cacheHit: row.cache_hit === null ? null : row.cache_hit === 1,
      selection: parseSelectionSnapshot(row.selection_snapshot_json),
    },
  };
}

function queueSummary(code: string): QueueSummary {
  const rows = db.prepare(`
    SELECT o.status, COUNT(*) AS count
    FROM queue_items q
    JOIN observations o ON o.id = q.observation_id
    WHERE q.profile_code = ?
    GROUP BY o.status
  `).all(code) as StatusCountRow[];

  const summary: QueueSummary = {
    unseenCount: 0,
    readyCount: 0,
    preparingCount: 0,
    pendingCount: 0,
  };
  for (const row of rows) {
    summary.unseenCount += row.count;
    if (row.status === 'ready') summary.readyCount = row.count;
    if (row.status === 'preparing') summary.preparingCount = row.count;
    if (row.status === 'pending') summary.pendingCount = row.count;
  }
  return summary;
}

function timingSummary(code: string, now: number): TimingSummary | null {
  const tail = tailRow(code);
  if (!tail) return null;

  const absoluteElapsedMs = tail.finalized_at === null
    ? now - tail.absolute_started_at
    : tail.absolute_elapsed_ms;
  const visibleElapsedMs = tail.visible_elapsed_ms + (
    tail.finalized_at === null && tail.visible_started_at !== null
      ? now - tail.visible_started_at
      : 0
  );

  return {
    tailPosition: tail.history_position,
    absoluteElapsedMs,
    visibleElapsedMs,
    finalized: tail.finalized_at !== null,
  };
}

export function loadProfile(code: string, visible: boolean): ProfileStateResponse {
  assertValidProfileCode(code);
  ensureProfileRow(code);
  const now = Date.now();

  // If the previous browser vanished without a final visibility event, cap the old
  // visible interval at its last heartbeat rather than counting the whole absence.
  closeStaleVisibleInterval(code, now);

  ensureLaunchQueue(code);
  setTailVisibility(code, visible, now);
  preparationService.kick();
  return getProfileState(code, visible);
}

export function getProfileState(code: string, visible: boolean): ProfileStateResponse {
  assertValidProfileCode(code);
  ensureProfileRow(code);
  const now = Date.now();
  setTailVisibility(code, visible, now);

  const profile = profileRow(code);
  const length = historyLength(code);
  const tailPosition = historyTailPosition(code);
  const nextQueue = nextQueueItem(code);
  const inHistoricalForwardPath = profile.current_position !== null
    && tailPosition !== null
    && profile.current_position < tailPosition;

  return {
    profileCode: code,
    currentPosition: profile.current_position,
    historyLength: length,
    currentObservation: currentObservation(code, profile.current_position),
    canBack: profile.current_position !== null && profile.current_position > 0,
    canNext: inHistoricalForwardPath || nextQueue?.status === 'ready',
    nextStatus: inHistoricalForwardPath ? 'ready' : (nextQueue?.status ?? null),
    queue: queueSummary(code),
    timing: timingSummary(code, now),
    selectionSettings: getProfileSelectionSettings(code),
  };
}

export function setProfileVisibility(code: string, visible: boolean): void {
  assertValidProfileCode(code);
  ensureProfileRow(code);
  setTailVisibility(code, visible, Date.now());
}

export function navigateBack(code: string, visible: boolean): ProfileStateResponse {
  assertValidProfileCode(code);
  ensureProfileRow(code);
  const profile = profileRow(code);
  if (profile.current_position === null || profile.current_position <= 0) {
    throw new NavigationUnavailableError('Back is unavailable.');
  }

  const now = Date.now();
  const tailPosition = historyTailPosition(code);
  if (profile.current_position === tailPosition) pauseTailVisible(code, now);

  db.prepare(`
    UPDATE profiles
    SET current_position = current_position - 1,
        last_client_seen_at = ?,
        updated_at = ?
    WHERE code = ?
  `).run(now, now, code);

  return getProfileState(code, visible);
}

export function navigateNext(code: string, visible: boolean): ProfileStateResponse {
  assertValidProfileCode(code);
  ensureProfileRow(code);
  const now = Date.now();
  const profile = profileRow(code);
  const tailPosition = historyTailPosition(code);

  // History mode: walk right through already-seen entries and do not consume queue.
  if (
    profile.current_position !== null
    && tailPosition !== null
    && profile.current_position < tailPosition
  ) {
    const nextPosition = profile.current_position + 1;
    db.prepare(`
      UPDATE profiles
      SET current_position = ?, last_client_seen_at = ?, updated_at = ?
      WHERE code = ?
    `).run(nextPosition, now, now, code);

    if (nextPosition === tailPosition) resumeTailVisible(code, visible, now);
    return getProfileState(code, visible);
  }

  const queued = nextQueueItem(code);
  if (!queued || queued.status !== 'ready') {
    throw new NavigationUnavailableError('Next observation is not ready.');
  }

  const newHistoryPosition = (tailPosition ?? -1) + 1;
  const consumeTransaction = db.transaction(() => {
    if (tailPosition !== null) finalizeTail(code, now);

    db.prepare(`
      INSERT INTO history_entries (
        profile_code, history_position, observation_id,
        absolute_started_at, visible_started_at
      ) VALUES (?, ?, ?, ?, ?)
    `).run(code, newHistoryPosition, queued.observation_id, now, visible ? now : null);

    db.prepare(`
      DELETE FROM queue_items
      WHERE profile_code = ? AND queue_position = ?
    `).run(code, queued.queue_position);

    db.prepare(`
      UPDATE profiles
      SET current_position = ?,
          last_client_seen_at = ?,
          updated_at = ?
      WHERE code = ?
    `).run(newHistoryPosition, now, now, code);

    // First-time display consumes one future slot. Reserve its replacement in this
    // same transaction so consumption cannot commit without one-for-one replacement.
    appendConsumptionReplacement(code, queued.observation_id, newHistoryPosition, now);
  });

  consumeTransaction();
  preparationService.kick();
  return getProfileState(code, visible);
}
