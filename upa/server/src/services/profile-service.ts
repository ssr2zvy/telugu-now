import { db } from '../db/database';
import { config } from '../config/config';
import type {
  AcquisitionTriggerKind,
  DisplayObservation,
  MediaItem,
  ObservationAudio,
  ObservationKind,
  ObservationStatus,
  ProfileSelectionSettings,
  ProfileStateResponse,
  QueueSummary,
  QueueViewResponse,
  QueueViewSlot,
  QuestionKeyboard,
  QuestionMode,
  QuestionPool,
  QuestionPhase,
  SelectionSnapshot,
  TimingSummary,
  UpdateSelectionSettingsRequest,
} from '../../../shared/contracts';
import { appendConsumptionReplacement, clearQueue, ensureLaunchQueue, getQueueCounts } from './queue-service';
import { preparationService } from './preparation-service';
import { getProfileSelectionSettings, updateProfileSelectionSettings } from './selection-settings-service';
import { getProfileAudioSettings } from './audio-settings-service';
import { getDisplayRepeat, recordFirstDisplay } from './repeat-service';
import { recordCurrentObservationView } from './eon-service';
import { logger } from './logger';

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
  media_json: string | null;
  repeat_snapshot_json: string | null;
  presentation_state_json: string;
  observation_kind: ObservationKind;
  question_requested_pool: QuestionPool | null;
  question_mode: QuestionMode | null;
  question_keyboard: QuestionKeyboard | null;
  response_text: string | null;
  response_audio_mime_type: string | null;
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

export function getQueueView(code: string): QueueViewResponse {
  assertValidProfileCode(code);
  const rows = db.prepare(`
    SELECT q.queue_position, o.id AS observation_id, o.source_id, o.source_key,
           COALESCE(o.text, sr.text) AS text, o.status, o.selected_at, o.prepared_at,
           o.request_started_at, o.request_completed_at, o.request_duration_ms, o.cache_hit,
           o.preparation_attempts, o.preparation_retry_at, o.preparation_error,
           a.acquisition_number, a.trigger_kind, a.observation_kind, a.question_mode,
           sr.media_json
    FROM queue_items q
    JOIN observations o ON o.id = q.observation_id
    JOIN observation_acquisitions a ON a.observation_id = o.id
    LEFT JOIN source_records sr
      ON sr.profile_code = q.profile_code AND sr.source_id = o.source_id AND sr.source_key = o.source_key
    WHERE q.profile_code = ?
    ORDER BY q.queue_position
  `).all(code) as Array<{
    queue_position: number; observation_id: string; source_id: string; source_key: string;
    text: string | null; status: ObservationStatus; selected_at: number; prepared_at: number | null;
    request_started_at: number | null; request_completed_at: number | null; request_duration_ms: number | null;
    cache_hit: number | null; preparation_attempts: number; preparation_retry_at: number | null;
    preparation_error: string | null; acquisition_number: number; trigger_kind: AcquisitionTriggerKind;
    observation_kind: ObservationKind; question_mode: QuestionMode | null; media_json: string | null;
  }>;
  const slots: QueueViewSlot[] = Array.from({ length: 10 }, (_, index) => {
    const row = rows[index];
    if (!row) return {
      slot: index + 1, phase: 'empty', queuePosition: null, observationId: null, sourceId: null,
      sourceKey: null, text: null, selectedAt: null, preparedAt: null, requestStartedAt: null,
      requestCompletedAt: null, requestDurationMs: null, cacheHit: null, preparationAttempts: 0,
      preparationRetryAt: null, preparationError: null, acquisitionNumber: null, triggerKind: null,
      observationKind: null, questionMode: null, hasAudio: false, fontRenderPhase: 'not-scheduled',
    };
    const phase = row.status === 'ready' ? 'ready'
      : row.status === 'preparing' ? 'preparing'
        : row.preparation_error && row.preparation_retry_at ? 'retry-waiting'
          : row.preparation_error ? 'failed' : 'pending';
    let hasAudio = false;
    try {
      hasAudio = (JSON.parse(row.media_json ?? '[]') as MediaItem[]).some(item => item.kind === 'audio');
    } catch { /* malformed media is reported as unavailable */ }
    return {
      slot: index + 1, phase, queuePosition: row.queue_position, observationId: row.observation_id,
      sourceId: row.source_id, sourceKey: row.source_key, text: row.text, selectedAt: row.selected_at,
      preparedAt: row.prepared_at, requestStartedAt: row.request_started_at,
      requestCompletedAt: row.request_completed_at, requestDurationMs: row.request_duration_ms,
      cacheHit: row.cache_hit === null ? null : row.cache_hit === 1,
      preparationAttempts: row.preparation_attempts, preparationRetryAt: row.preparation_retry_at,
      preparationError: row.preparation_error, acquisitionNumber: row.acquisition_number,
      triggerKind: row.trigger_kind, observationKind: row.observation_kind,
      questionMode: row.question_mode, hasAudio, fontRenderPhase: 'not-scheduled',
    };
  });
  return { generatedAt: Date.now(), capacity: 10, slots };
}

export function ensureProfileRow(code: string): void {
  assertValidProfileCode(code);
  const now = Date.now();
  db.prepare(`
    INSERT INTO profiles (code, current_position, created_at, updated_at, repeat_tracking_complete)
    VALUES (?, NULL, ?, ?, 1)
    ON CONFLICT(code) DO NOTHING
  `).run(code, now, now);
  // Selection defaults are lazily persisted for both new and upgraded profiles.
  getProfileSelectionSettings(code);
  getProfileAudioSettings(code);
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

function adjacentHistoryPosition(code: string, current: number | null, direction: 'back' | 'next'): number | null {
  if (current === null) return null;
  return (db.prepare(`
    SELECT ${direction === 'back' ? 'MAX' : 'MIN'}(history_position) AS position FROM history_entries
    WHERE profile_code = ? AND history_position ${direction === 'back' ? '<' : '>'} ?
  `).get(code, current) as { position: number | null }).position;
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

function audioObjectUrl(objectKey: string): string {
  return `/api/audio/${objectKey.split('/').map(encodeURIComponent).join('/')}?v=2`;
}

function questionPhase(raw: string): QuestionPhase {
  try {
    const phase = (JSON.parse(raw) as { questionPhase?: unknown }).questionPhase;
    if (phase === 'comparison' || phase === 'observation') return phase;
    if (phase === 'answer') return 'comparison';
    return 'question';
  } catch { return 'question'; }
}

function questionAudioUrl(profileCode: string, observationId: string): string {
  return `/api/profiles/${encodeURIComponent(profileCode)}/questions/${encodeURIComponent(observationId)}/audio`;
}

export function parseObservationAudio(raw: string | null): ObservationAudio | null {
  if (!raw) return null;
  try {
    const items = JSON.parse(raw) as MediaItem[];
    const audio = items.find((item): item is Extract<MediaItem, { kind: 'audio' }> => item.kind === 'audio');
    if (!audio) return null;
    return {
      url: audioObjectUrl(audio.objectKey),
      mimeType: audio.mimeType,
      durationSeconds: audio.durationSeconds,
    };
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
           o.cache_hit, sr.media_json, o.repeat_snapshot_json,
           h.presentation_state_json, a.observation_kind, a.question_requested_pool, a.question_mode, a.question_keyboard,
           qr.response_text, qr.response_audio_mime_type
    FROM history_entries h
    JOIN observations o ON o.id = h.observation_id
    JOIN observation_acquisitions a ON a.observation_id = o.id
    LEFT JOIN observation_acquisitions ta ON ta.observation_id = a.trigger_observation_id
    LEFT JOIN source_records sr ON sr.profile_code = h.profile_code AND sr.source_id = o.source_id AND sr.source_key = o.source_key
    LEFT JOIN question_responses qr ON qr.profile_code = h.profile_code AND qr.observation_id = o.id
    WHERE h.profile_code = ? AND h.history_position = ?
  `).get(code, currentPosition) as ObservationRow | undefined;

  if (!row) return null;
  return {
    id: row.id,
    sourceId: row.source_id,
    sourceKey: row.source_key,
    text: row.text,
    audio: parseObservationAudio(row.media_json),
    kind: row.observation_kind,
    question: row.observation_kind === 'question' && row.question_mode ? {
      mode: row.question_mode,
      requestedPool: row.question_requested_pool,
      keyboard: row.question_keyboard,
      phase: questionPhase(row.presentation_state_json),
      responseText: row.response_text ?? '',
      responseAudio: row.response_audio_mime_type ? {
        url: questionAudioUrl(code, row.id),
        mimeType: row.response_audio_mime_type,
        durationSeconds: 0,
      } : null,
    } : null,
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
      repeat: getDisplayRepeat(code, row.id, row.repeat_snapshot_json),
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

  const error = db.prepare(`
    SELECT o.preparation_error AS code, o.preparation_attempts AS attempts, o.preparation_retry_at AS retryAt
    FROM queue_items q JOIN observations o ON o.id = q.observation_id
    WHERE q.profile_code = ? AND o.preparation_error IS NOT NULL AND o.status != 'ready'
    ORDER BY q.queue_position LIMIT 1
  `).get(code) as NonNullable<QueueSummary['preparationError']> | undefined;
  summary.preparationError = error ?? null;
  return summary;
}

function upcomingAudio(code: string, position: number | null): ObservationAudio[] {
  const rows = db.prepare(`
    SELECT sr.media_json
    FROM (
      SELECT h.observation_id, 0 AS kind, h.history_position AS position
      FROM history_entries h WHERE h.profile_code = ? AND h.history_position > ?
      UNION ALL
      SELECT q.observation_id, 1 AS kind, q.queue_position AS position
      FROM queue_items q JOIN observations o ON o.id = q.observation_id
      WHERE q.profile_code = ? AND o.status = 'ready'
    ) upcoming
    JOIN observations o ON o.id = upcoming.observation_id
    LEFT JOIN source_records sr ON sr.profile_code = ? AND sr.source_id = o.source_id AND sr.source_key = o.source_key
    ORDER BY upcoming.kind, upcoming.position
    LIMIT 3
  `).all(code, position ?? -1, code, code) as Array<{ media_json: string | null }>;
  return rows.flatMap(row => {
    const audio = parseObservationAudio(row.media_json);
    return audio ? [audio] : [];
  });
}

function upcomingPresentation(code: string, position: number | null): Array<{ id: string; text: string }> {
  return db.prepare(`
    SELECT o.id, o.text
    FROM (
      SELECT h.observation_id, 0 AS kind, h.history_position AS position
      FROM history_entries h WHERE h.profile_code = ? AND h.history_position > ?
      UNION ALL
      SELECT q.observation_id, 1 AS kind, q.queue_position AS position
      FROM queue_items q JOIN observations queued ON queued.id = q.observation_id
      WHERE q.profile_code = ? AND queued.status = 'ready'
    ) upcoming
    JOIN observations o ON o.id = upcoming.observation_id
    WHERE o.text IS NOT NULL
    ORDER BY upcoming.kind, upcoming.position
    LIMIT 1
  `).all(code, position ?? -1, code) as Array<{ id: string; text: string }>;
}

function previousPresentation(code: string, position: number | null): { id: string; text: string } | null {
  const previousPosition = adjacentHistoryPosition(code, position, 'back');
  if (previousPosition === null) return null;
  const row = db.prepare(`
    SELECT o.id, o.text
    FROM history_entries h
    JOIN observations o ON o.id = h.observation_id
    WHERE h.profile_code = ? AND h.history_position = ? AND o.text IS NOT NULL
  `).get(code, previousPosition) as { id: string; text: string } | undefined;
  return row ?? null;
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
  db.transaction(() => {
    const now = Date.now();
    // If the previous browser vanished without a final visibility event, cap the old
    // visible interval at its last heartbeat rather than counting the whole absence.
    closeStaleVisibleInterval(code, now);
    preparationService.checkQueue(code, true);
    ensureLaunchQueue(code);
    setTailVisibility(code, visible, now);
    recordCurrentObservationView(db, code, 'load', now);
  }).immediate();
  preparationService.kick();
  return getProfileState(code, visible);
}

export function getProfileState(code: string, visible: boolean): ProfileStateResponse {
  assertValidProfileCode(code);
  ensureProfileRow(code);
  const now = Date.now();
  preparationService.checkQueue(code);
  preparationService.kick();
  setTailVisibility(code, visible, now);

  const profile = profileRow(code);
  const length = historyLength(code);
  const tailPosition = historyTailPosition(code);
  const nextQueue = nextQueueItem(code);
  const inHistoricalForwardPath = profile.current_position !== null
    && tailPosition !== null
    && profile.current_position < tailPosition;
  const displayedObservation = currentObservation(code, profile.current_position);

  return {
    profileCode: code,
    currentPosition: profile.current_position,
    historyLength: length,
    currentObservation: displayedObservation,
    upcomingAudio: upcomingAudio(code, profile.current_position),
    upcomingPresentation: upcomingPresentation(code, profile.current_position),
    previousPresentation: previousPresentation(code, profile.current_position),
    canBack: Boolean(displayedObservation?.question && displayedObservation.question.phase !== 'question')
      || adjacentHistoryPosition(code, profile.current_position, 'back') !== null,
    canNext: Boolean(displayedObservation?.question && displayedObservation.question.phase !== 'observation')
      || inHistoricalForwardPath || nextQueue?.status === 'ready',
    nextStatus: inHistoricalForwardPath ? 'ready' : (nextQueue?.status ?? null),
    queue: queueSummary(code),
    timing: timingSummary(code, now),
    selectionSettings: getProfileSelectionSettings(code),
    audioSettings: getProfileAudioSettings(code),
  };
}

export function setProfileVisibility(code: string, visible: boolean): void {
  assertValidProfileCode(code);
  ensureProfileRow(code);
  if (visible) {
    preparationService.checkQueue(code, true);
    preparationService.kick();
  }
  db.transaction(() => {
    const now = Date.now();
    setTailVisibility(code, visible, now);
    if (visible) recordCurrentObservationView(db, code, 'resume', now);
  }).immediate();
}

// Discards every queued (not-yet-displayed) observation and refills the queue from
// scratch. The currently displayed observation, if any, is untouched.
export function resetQueue(code: string, visible: boolean): ProfileStateResponse {
  assertValidProfileCode(code);
  ensureProfileRow(code);
  clearQueue(code);
  ensureLaunchQueue(code);
  preparationService.kick();
  return getProfileState(code, visible);
}

export function updateSelectionSettingsAndResetQueue(
  code: string,
  request: UpdateSelectionSettingsRequest,
): ProfileSelectionSettings {
  assertValidProfileCode(code);
  ensureProfileRow(code);
  const settings = updateProfileSelectionSettings(code, request);
  clearQueue(code);
  ensureLaunchQueue(code);
  preparationService.kick();
  return settings;
}

export function navigateBack(code: string, visible: boolean): ProfileStateResponse {
  assertValidProfileCode(code);
  ensureProfileRow(code);
  db.transaction(() => {
    const profile = profileRow(code);
    if (profile.current_position !== null) {
      const current = db.prepare(`
        SELECT h.presentation_state_json, a.observation_kind
        FROM history_entries h JOIN observation_acquisitions a ON a.observation_id = h.observation_id
        WHERE h.profile_code = ? AND h.history_position = ?
      `).get(code, profile.current_position) as { presentation_state_json: string; observation_kind: ObservationKind } | undefined;
      const phase = current?.observation_kind === 'question' ? questionPhase(current.presentation_state_json) : null;
      if (phase === 'comparison' || phase === 'observation') {
        db.prepare(`UPDATE history_entries SET presentation_state_json = ? WHERE profile_code = ? AND history_position = ?`)
          .run(JSON.stringify({ questionPhase: phase === 'observation' ? 'comparison' : 'question' }), code, profile.current_position);
        return;
      }
    }
    const previousPosition = adjacentHistoryPosition(code, profile.current_position, 'back');
    if (previousPosition === null) {
      throw new NavigationUnavailableError('Back is unavailable.');
    }

    const now = Date.now();
    const tailPosition = historyTailPosition(code);
    if (profile.current_position === tailPosition) pauseTailVisible(code, now);

    db.prepare(`
      UPDATE profiles
      SET current_position = ?,
          last_client_seen_at = ?,
          updated_at = ?
      WHERE code = ?
    `).run(previousPosition, now, now, code);
    recordCurrentObservationView(db, code, 'back', now);
  }).immediate();

  return getProfileState(code, visible);
}

export function navigateNext(code: string, visible: boolean): ProfileStateResponse {
  assertValidProfileCode(code);
  ensureProfileRow(code);
  preparationService.checkQueue(code);
  db.transaction(() => {
    const now = Date.now();
    const profile = profileRow(code);
    const tailPosition = historyTailPosition(code);

    if (profile.current_position !== null) {
      const current = db.prepare(`
        SELECT h.presentation_state_json, a.observation_kind
        FROM history_entries h JOIN observation_acquisitions a ON a.observation_id = h.observation_id
        WHERE h.profile_code = ? AND h.history_position = ?
      `).get(code, profile.current_position) as { presentation_state_json: string; observation_kind: ObservationKind } | undefined;
      const phase = current?.observation_kind === 'question' ? questionPhase(current.presentation_state_json) : null;
      if (phase === 'question' || phase === 'comparison') {
        db.prepare(`UPDATE history_entries SET presentation_state_json = ? WHERE profile_code = ? AND history_position = ?`)
          .run(JSON.stringify({ questionPhase: phase === 'question' ? 'comparison' : 'observation' }), code, profile.current_position);
        return;
      }
    }

    // History mode: walk right through already-seen entries and do not consume queue.
    if (
      profile.current_position !== null
      && tailPosition !== null
      && profile.current_position < tailPosition
    ) {
      const nextPosition = adjacentHistoryPosition(code, profile.current_position, 'next')!;
      db.prepare(`
        UPDATE profiles
        SET current_position = ?, last_client_seen_at = ?, updated_at = ?
        WHERE code = ?
      `).run(nextPosition, now, now, code);

      if (nextPosition === tailPosition) resumeTailVisible(code, visible, now);
      recordCurrentObservationView(db, code, 'forward', now);
      return;
    }

    const queued = nextQueueItem(code);
    if (!queued || queued.status !== 'ready') {
      logger.info(queued ? 'queue_next_observation_preparing' : 'queue_unexpectedly_empty', {
        ...(queued ? { observationId: queued.observation_id, status: queued.status } : {}),
        ...getQueueCounts(code),
      });
      throw new NavigationUnavailableError('Next observation is not ready.');
    }

    const newHistoryPosition = (tailPosition ?? -1) + 1;
    if (tailPosition !== null) finalizeTail(code, now);

    db.prepare(`
      INSERT INTO history_entries (
        profile_code, history_position, observation_id,
        absolute_started_at, visible_started_at
      ) VALUES (?, ?, ?, ?, ?)
    `).run(code, newHistoryPosition, queued.observation_id, now, visible ? now : null);
    recordFirstDisplay(code, queued.observation_id, now);

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
    recordCurrentObservationView(db, code, 'next', now);

    // First-time display consumes one future slot. Reserve its replacement in this
    // same transaction so consumption cannot commit without one-for-one replacement.
    appendConsumptionReplacement(code, queued.observation_id, newHistoryPosition, now);
    logger.info('queue_consumed_and_replacement_scheduled', {
      observationId: queued.observation_id,
      historyPosition: newHistoryPosition,
      durationMs: Date.now() - now,
      ...getQueueCounts(code),
    });
  }).immediate();
  preparationService.kick();
  return getProfileState(code, visible);
}
