import { randomUUID } from 'node:crypto';
import { db } from '../db/database';
import type { AcquisitionTriggerKind, PreparationGroupKind } from '../../../shared/contracts';
import { selectionEngine } from './selection-engine';
import { getProfileSelectionSettings } from './selection-settings-service';

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
    selection_snapshot_json
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

function appendSelectedObservation(profileCode: string, context: SelectionContext): string {
  const settings = getProfileSelectionSettings(profileCode);
  const selected = selectionEngine.select(settings);
  const observationId = randomUUID();
  const acquisitionNumber = nextAcquisitionNumber(profileCode);
  const queuePosition = nextQueuePosition(profileCode);
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
