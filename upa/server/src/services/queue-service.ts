import { randomUUID } from 'node:crypto';
import { db } from '../db/database';
import type { AcquisitionTriggerKind, ObservationKind, PreparationGroupKind, QuestionKeyboard, QuestionMode, QuestionPool } from '../../../shared/contracts';
import { selectionEngine } from './selection-engine';
import { getProfileSelectionSettings } from './selection-settings-service';
import { logger } from './logger';

interface CountRow { count: number }
interface MaxRow { max_position: number | null }
interface MaxAcquisitionRow { max_number: number | null }
interface QueueCounts { depth: number; pending: number; ready: number; failed: number }

interface SelectionContext {
  triggerKind: AcquisitionTriggerKind;
  triggeredByObservationId: string | null;
  triggeredByHistoryPosition: number | null;
  triggeredAt: number;
  legacyGroupId: string;
  legacyGroupKind: PreparationGroupKind;
  legacyGroupSize: number;
  legacyGroupPosition: number;
}

export interface ObservationPlan {
  kind: ObservationKind;
  requestedPool: QuestionPool | null;
  questionMode: QuestionMode | null;
  keyboard: QuestionKeyboard | null;
}

export function chooseObservationPlan(
  random: () => number = Math.random,
  probabilities = { question: 0.3, seen: 0.75, audioGiven: 0.6 },
): ObservationPlan {
  if (random() >= probabilities.question) return { kind: 'normal', requestedPool: null, questionMode: null, keyboard: null };
  const questionMode: QuestionMode = random() < probabilities.audioGiven ? 'audio-given' : 'text-given';
  const keyboards: QuestionKeyboard[] = ['windows-inscript', 'mac-standard', 'chromebook-dictation'];
  return {
    kind: 'question',
    requestedPool: random() < probabilities.seen ? 'seen' : 'unseen',
    questionMode,
    keyboard: questionMode === 'audio-given' ? keyboards[Math.min(2, Math.floor(random() * 3))]! : null,
  };
}

function seenRecordingKeys(profileCode: string): Set<string> {
  const rows = db.prepare(`SELECT source_id, source_key FROM recording_displays WHERE profile_code = ? AND occurrence_count > 0`)
    .all(profileCode) as Array<{ source_id: string; source_key: string }>;
  return new Set(rows.map(row => `${row.source_id}\u0000${row.source_key}`));
}

function queueCount(profileCode: string): number {
  const row = db.prepare(
    'SELECT COUNT(*) AS count FROM queue_items WHERE profile_code = ?',
  ).get(profileCode) as CountRow;
  return row.count;
}

export function getQueueCounts(profileCode: string): QueueCounts {
  const rows = db.prepare(`
    SELECT o.status, o.preparation_error, o.preparation_retry_at
    FROM queue_items q JOIN observations o ON o.id = q.observation_id
    WHERE q.profile_code = ?
  `).all(profileCode) as Array<{ status: string; preparation_error: string | null; preparation_retry_at: number | null }>;
  return {
    depth: rows.length,
    pending: rows.filter(row => row.status === 'pending').length,
    ready: rows.filter(row => row.status === 'ready').length,
    failed: rows.filter(row => row.preparation_error && row.preparation_retry_at === null).length,
  };
}

function nextQueuePosition(profileCode: string): number {
  const row = db.prepare(
    'SELECT MAX(queue_position) AS max_position FROM queue_items WHERE profile_code = ?',
  ).get(profileCode) as MaxRow;
  return (row.max_position ?? -1) + 1;
}

function nextAcquisitionNumber(profileCode: string): number {
  const row = db.prepare(`
    SELECT MAX(acquisition_number) AS max_number
    FROM observation_acquisitions
    WHERE profile_code = ?
  `).get(profileCode) as MaxAcquisitionRow;
  return (row.max_number ?? 0) + 1;
}

function waitingPreparationCount(): number {
  const row = db.prepare(`
    SELECT COUNT(*) AS count
    FROM queue_items q
    JOIN observations o ON o.id = q.observation_id
    WHERE o.status = 'pending'
  `).get() as CountRow;
  return row.count;
}

function preparationInFlight(): boolean {
  const row = db.prepare(`
    SELECT COUNT(*) AS count
    FROM queue_items q
    JOIN observations o ON o.id = q.observation_id
    WHERE o.status = 'preparing'
  `).get() as CountRow;
  return row.count > 0;
}

const insertObservation = db.prepare(`
  INSERT INTO observations (
    id, source_id, source_key, status, selected_at,
    group_id, group_kind, group_size, group_position
  ) VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?)
`);

const insertQueue = db.prepare(`
  INSERT INTO queue_items (profile_code, queue_position, observation_id)
  VALUES (?, ?, ?)
`);

const insertAcquisition = db.prepare(`
  INSERT INTO observation_acquisitions (
    observation_id, profile_code, acquisition_number, trigger_kind,
    trigger_observation_id, trigger_history_position, triggered_at,
    waiting_ahead_at_trigger, preparation_in_flight_at_trigger,
    selection_snapshot_json, observation_kind, question_requested_pool, question_mode, question_keyboard
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

function appendSelectedObservation(
  profileCode: string,
  context: SelectionContext,
  reserved?: { acquisitionNumber: number; queuePosition: number },
): string {
  const settings = getProfileSelectionSettings(profileCode);
  const plan = chooseObservationPlan(Math.random, {
    question: settings.questionProbability ?? 0.3,
    seen: settings.seenQuestionProbability ?? 0.75,
    audioGiven: settings.audioGivenQuestionProbability ?? 0.6,
  });
  let selected;
  if (plan.kind === 'question') {
    const seen = seenRecordingKeys(profileCode);
    const inRequestedPool = (candidate: { sourceId: string; sourceKey: string }) =>
      seen.has(`${candidate.sourceId}\u0000${candidate.sourceKey}`) === (plan.requestedPool === 'seen');
    const requested = seen.size === 0 ? undefined : selectionEngine.selectMatching(settings, inRequestedPool);
    selected = requested
      ?? (seen.size === 0 ? selectionEngine.select(settings) : selectionEngine.selectMatching(settings, candidate => !inRequestedPool(candidate)))
      ?? selectionEngine.select(settings);
    if (!requested) logger.warn('question_pool_fallback', {
      requestedPool: plan.requestedPool,
      failureCategory: seen.size === 0 ? 'no-seen-recordings' : 'requested-pool-unavailable',
    });
  } else {
    selected = selectionEngine.select(settings);
  }
  const observationId = randomUUID();
  const acquisitionNumber = reserved?.acquisitionNumber ?? nextAcquisitionNumber(profileCode);
  const queuePosition = reserved?.queuePosition ?? nextQueuePosition(profileCode);
  const waitingAhead = waitingPreparationCount();
  const inFlight = preparationInFlight();

  insertObservation.run(
    observationId,
    selected.sourceId,
    selected.sourceKey,
    context.triggeredAt,
    context.legacyGroupId,
    context.legacyGroupKind,
    context.legacyGroupSize,
    context.legacyGroupPosition,
  );

  insertAcquisition.run(
    observationId,
    profileCode,
    acquisitionNumber,
    context.triggerKind,
    context.triggeredByObservationId,
    context.triggeredByHistoryPosition,
    context.triggeredAt,
    waitingAhead,
    inFlight ? 1 : 0,
    JSON.stringify(selected.snapshot),
    plan.kind,
    plan.requestedPool,
    plan.questionMode,
    plan.keyboard,
  );

  insertQueue.run(profileCode, queuePosition, observationId);
  logger.info('observation_selected_and_queued', {
    observationId,
    sourceId: selected.sourceId,
    acquisitionNumber,
    triggerKind: context.triggerKind,
    observationKind: plan.kind,
    ...getQueueCounts(profileCode),
  });
  return observationId;
}

export function ensureLaunchQueue(profileCode: string): boolean {
  const count = queueCount(profileCode);
  if (count >= 10) return false;

  const missing = 10 - count;
  const groupId = randomUUID();
  const triggeredAt = Date.now();

  logger.info('queue_initial_fill_started', { missing, ...getQueueCounts(profileCode) });
  try {
    db.transaction(() => {
      for (let index = 0; index < missing; index += 1) {
        appendSelectedObservation(profileCode, {
          triggerKind: 'initial-fill',
          triggeredByObservationId: null,
          triggeredByHistoryPosition: null,
          triggeredAt,
          legacyGroupId: groupId,
          legacyGroupKind: 'launch-fill',
          legacyGroupSize: missing,
          legacyGroupPosition: index + 1,
        });
      }
    })();
  } catch (error) {
    logger.error('queue_transaction_failed', {
      operation: 'initial-fill',
      failureCategory: error instanceof Error ? error.name : 'unknown',
      durationMs: Date.now() - triggeredAt,
    });
    throw error;
  }

  logger.info('queue_initial_fill_completed', { added: missing, durationMs: Date.now() - triggeredAt, ...getQueueCounts(profileCode) });
  return true;
}

// This function is intentionally transaction-free. The caller invokes it inside the
// same SQLite transaction that moves the consumed observation into persistent history,
// making consumption and one-for-one replacement one atomic logical operation.
export function appendConsumptionReplacement(
  profileCode: string,
  triggeredByObservationId: string,
  triggeredByHistoryPosition: number,
  triggeredAt: number,
): string {
  return appendSelectedObservation(profileCode, {
    triggerKind: 'observation-consumed',
    triggeredByObservationId,
    triggeredByHistoryPosition,
    triggeredAt,
    legacyGroupId: randomUUID(),
    legacyGroupKind: 'rolling-replenishment',
    legacyGroupSize: 1,
    legacyGroupPosition: 1,
  });
}

export function getQueueCount(profileCode: string): number {
  return queueCount(profileCode);
}

const selectQueuedObservationIds = db.prepare(`
  SELECT observation_id FROM queue_items WHERE profile_code = ?
`);
const deleteQueueItemsForProfile = db.prepare(`
  DELETE FROM queue_items WHERE profile_code = ?
`);
const deleteObservationById = db.prepare(`
  DELETE FROM observations WHERE id = ?
`);

// Removes every not-yet-displayed queued observation (and its acquisition record via
// cascade), leaving history and the currently displayed observation untouched.
export function clearQueue(profileCode: string): void {
  const queued = selectQueuedObservationIds.all(profileCode) as Array<{ observation_id: string }>;
  const startedAt = Date.now();
  try {
    db.transaction(() => {
      deleteQueueItemsForProfile.run(profileCode);
      for (const row of queued) deleteObservationById.run(row.observation_id);
    })();
  } catch (error) {
    logger.error('queue_transaction_failed', {
      operation: 'reset',
      failureCategory: error instanceof Error ? error.name : 'unknown',
      durationMs: Date.now() - startedAt,
    });
    throw error;
  }
  logger.info('queue_reset', { removed: queued.length, durationMs: Date.now() - startedAt, ...getQueueCounts(profileCode) });
}

export function replaceRejectedQueuedObservation(observationId: string): void {
  const startedAt = Date.now();
  db.transaction(() => {
    const row = db.prepare(`
      SELECT q.profile_code, q.queue_position AS queuePosition,
        a.acquisition_number AS acquisitionNumber, a.trigger_kind AS triggerKind,
        a.trigger_observation_id AS triggeredByObservationId, a.trigger_history_position AS triggeredByHistoryPosition,
        a.triggered_at AS triggeredAt, o.group_id AS legacyGroupId, o.group_kind AS legacyGroupKind,
        o.group_size AS legacyGroupSize, o.group_position AS legacyGroupPosition
      FROM queue_items q JOIN observations o ON o.id = q.observation_id
      JOIN observation_acquisitions a ON a.observation_id = o.id
      WHERE o.id = ?
    `).get(observationId) as (SelectionContext & { profile_code: string; queuePosition: number; acquisitionNumber: number }) | undefined;
    if (!row) {
      if (db.prepare('SELECT 1 FROM queue_items WHERE observation_id = ?').get(observationId)) {
        logger.error('queue_item_missing_acquisition_metadata', { observationId });
        throw new Error('Queued observation has no acquisition.');
      }
      return;
    }
    deleteObservationById.run(observationId);
    // A rejected reservation never became a display/acquisition. Its successor
    // gets a fresh ID/snapshot but retains the slot, trigger and acquisition number.
    const replacementId = appendSelectedObservation(row.profile_code, row, row);
    logger.warn('rejected_observation_replaced', {
      observationId,
      replacementObservationId: replacementId,
      durationMs: Date.now() - startedAt,
      ...getQueueCounts(row.profile_code),
    });
  })();
}
