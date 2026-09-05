import { randomUUID } from 'node:crypto';
import { db } from '../db/database';
import type { PreparationGroupKind } from '../../../shared/contracts';
import { sourceSelector } from './source-registry';

interface CountRow { count: number }
interface MaxRow { max_position: number | null }

function queueCount(profileCode: string): number {
  const row = db.prepare('SELECT COUNT(*) AS count FROM queue_items WHERE profile_code = ?').get(profileCode) as CountRow;
  return row.count;
}

function nextQueuePosition(profileCode: string): number {
  const row = db.prepare(
    'SELECT MAX(queue_position) AS max_position FROM queue_items WHERE profile_code = ?',
  ).get(profileCode) as MaxRow;
  return (row.max_position ?? -1) + 1;
}

export function addPreparationGroup(
  profileCode: string,
  size: number,
  kind: PreparationGroupKind,
): void {
  if (size <= 0) return;

  const groupId = randomUUID();
  const selectedAt = Date.now();
  let queuePosition = nextQueuePosition(profileCode);

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

  const transaction = db.transaction(() => {
    for (let index = 0; index < size; index += 1) {
      const source = sourceSelector.select();
      const candidate = source.selectCandidate();
      const observationId = randomUUID();

      insertObservation.run(
        observationId,
        source.id,
        candidate.sourceKey,
        selectedAt + index,
        groupId,
        kind,
        size,
        index + 1,
      );
      insertQueue.run(profileCode, queuePosition, observationId);
      queuePosition += 1;
    }
  });

  transaction();
}

export function ensureLaunchQueue(profileCode: string): boolean {
  const count = queueCount(profileCode);
  if (count >= 10) return false;

  const missing = 10 - count;
  addPreparationGroup(profileCode, missing, 'launch-fill');
  db.prepare(`
    UPDATE profiles
    SET consumed_since_replenishment = 0,
        updated_at = ?
    WHERE code = ?
  `).run(Date.now(), profileCode);
  return true;
}

export function addRollingReplenishment(profileCode: string): void {
  addPreparationGroup(profileCode, 5, 'rolling-replenishment');
}

export function getQueueCount(profileCode: string): number {
  return queueCount(profileCode);
}
