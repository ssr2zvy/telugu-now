import { randomUUID } from 'node:crypto';
import { db } from '../db/database';
import type { AcquisitionTriggerKind, PreparationGroupKind } from '../../../shared/contracts';
import { selectionEngine } from './selection-engine';
import { getProfileSelectionSettings } from './selection-settings-service';
import { blacklistStore } from './blacklist-service';
import { preparedCorpusStore } from '../sources/prepared-corpus/prepared-corpus-store';
import { hasSeenRow, planNextDisplay, poolHasAnySeenRow, type QuestionPlan } from './question-service';

// A blacklisted row can still be drawn by the weighted sampler. Redraw a bounded
// number of times rather than distorting the distribution or looping forever.
const BLACKLIST_REDRAW_ATTEMPTS = 25;
// The sampler cannot be restricted to the seen/unseen pool directly, so redraw a
// bounded number of times and fall back to the last draw rather than looping.
const POOL_REDRAW_ATTEMPTS = 40;
let blacklist: ReturnType<typeof blacklistStore> | null = null;
function profileBlacklist() {
  blacklist ??= blacklistStore(db);
  return blacklist;
}

// The common-word ranking must skip sentences anyone has hidden.
preparedCorpusStore.blacklistedTexts = () => profileBlacklist().allBlacklistedTexts();

const selectCachedText = db.prepare(
  'SELECT text FROM source_records WHERE profile_code = ? AND source_id = ? AND source_key = ?',
);

function selectAllowedRow(profileCode: string, pool: 'seen' | 'unseen' | null = null) {
  const settings = getProfileSelectionSettings(profileCode);
  const store = profileBlacklist();
  const blockedTexts = store.blacklistedTexts(profileCode);
  // A profile with no history has no seen pool at all; fall back to any row.
  const wantedPool = pool === 'seen' && !poolHasAnySeenRow(profileCode) ? null : pool;
  const blocked = (selected: { sourceId: string; sourceKey: string }) => {
    if (blockedTexts.size === 0) return false;
    const cached = selectCachedText.get(profileCode, selected.sourceId, selected.sourceKey) as { text: string } | undefined;
    return store.isBlacklisted(profileCode, selected.sourceId, selected.sourceKey)
      || (cached !== undefined && blockedTexts.has(cached.text));
  };
  const outsidePool = (selected: { sourceId: string; sourceKey: string }) => wantedPool !== null
    && hasSeenRow(profileCode, selected.sourceId, selected.sourceKey) !== (wantedPool === 'seen');
  let selected = selectionEngine.select(settings);
  const attempts = Math.max(BLACKLIST_REDRAW_ATTEMPTS, wantedPool === null ? 0 : POOL_REDRAW_ATTEMPTS);
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (!blocked(selected) && !outsidePool(selected)) return selected;
    selected = selectionEngine.select(settings);
  }
  return selected;
}

interface CountRow { count: number }
interface MaxRow { max_position: number | null }
interface MaxAcquisitionRow { max_number: number | null }

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

function queueCount(profileCode: string): number {
  const row = db.prepare(
    'SELECT COUNT(*) AS count FROM queue_items WHERE profile_code = ?',
  ).get(profileCode) as CountRow;
  return row.count;
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
    group_id, group_kind, group_size, group_position,
    display_kind, question_mode, question_pool, question_keyboard
  ) VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    selection_snapshot_json
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

function appendSelectedObservation(
  profileCode: string,
  context: SelectionContext,
  reserved?: { acquisitionNumber: number; queuePosition: number },
): string {
  const plan: QuestionPlan = planNextDisplay();
  const selected = selectAllowedRow(profileCode, plan.pool);
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
    plan.displayKind,
    plan.mode,
    plan.pool,
    plan.keyboard,
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
  );

  insertQueue.run(profileCode, queuePosition, observationId);
  return observationId;
}

export function ensureLaunchQueue(profileCode: string): boolean {
  const count = queueCount(profileCode);
  if (count >= 10) return false;

  const missing = 10 - count;
  const groupId = randomUUID();
  const triggeredAt = Date.now();

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
  db.transaction(() => {
    deleteQueueItemsForProfile.run(profileCode);
    for (const row of queued) deleteObservationById.run(row.observation_id);
  })();
}

export function replaceRejectedQueuedObservation(observationId: string): void {
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
        throw new Error('Queued observation has no acquisition.');
      }
      return;
    }
    deleteObservationById.run(observationId);
    // A rejected reservation never became a display/acquisition. Its successor
    // gets a fresh ID/snapshot but retains the slot, trigger and acquisition number.
    appendSelectedObservation(row.profile_code, row, row);
  })();
}
