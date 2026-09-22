import { coreEvent } from '../parsing/audit';
import { openBatch, grammarSelect, recordSelection, attempt } from '../grammar/service';
import { selectionMode, initializeMode, questionChoice, recordAttempt, graph, coreProgress, applyFinishedBatch, attempt as selectionAttempt } from '../parsing/state';
import { draftCoreBatch, getParsingCatalog, selectionContext, type CoreSelection } from '../parsing/catalog';
import { uniformAudioRow } from '../parsing/random';
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
  const mode = selectionMode(profileCode);
  if (mode === 'core') throw new Error('Core observations must belong to a frozen batch');
  const questionType = questionChoice(profileCode);
  const settings = getProfileSelectionSettings(profileCode);
  const plan = chooseObservationPlan(Math.random, {
    question: 1,
    seen: settings.seenQuestionProbability ?? 0.75,
    audioGiven: settings.audioGivenQuestionProbability ?? 0.6,
  });
  plan.questionMode = questionType.mode;
  plan.keyboard = questionType.mode === 'audio-given' ? (plan.keyboard ?? 'windows-inscript') : null;
  let selected;
  if (mode === 'random') {
    selected = uniformAudioRow();
    plan.requestedPool = null;
  } else if (plan.kind === 'question') {
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
    JSON.stringify({ ...selected.snapshot, mode, questionType }),
    plan.kind,
    plan.requestedPool,
    plan.questionMode,
    plan.keyboard,
  );

  insertQueue.run(profileCode, queuePosition, observationId);
  recordAttempt(observationId, profileCode, mode);
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

function appendGrammarObservation(profileCode: string, context: SelectionContext,
  reserved?: {acquisitionNumber: number; queuePosition: number}, replacement?: {batch:string;slot:number;target:string}): string {
  const batch=replacement?.batch ?? openBatch(profileCode)?.id;
  if(!batch)throw new Error('Grammar batch missing');
  const slot=replacement?.slot ?? (db.prepare('SELECT COUNT(*) AS n FROM grammar_attempts WHERE batch_id=?').get(batch) as {n:number}).n;
  const selected=grammarSelect(profileCode,batch,replacement?.target);
  const mode=selected.questionType.mode;
  const keyboards=['windows-inscript','mac-standard','chromebook-dictation'];
  const id=randomUUID(),number=reserved?.acquisitionNumber??nextAcquisitionNumber(profileCode);
  insertObservation.run(id,selected.sourceId,selected.sourceKey,context.triggeredAt,batch,'launch-fill',10,slot+1);
  insertAcquisition.run(id,profileCode,number,context.triggerKind,context.triggeredByObservationId,context.triggeredByHistoryPosition,context.triggeredAt,waitingPreparationCount(),preparationInFlight()?1:0,JSON.stringify(selected.snapshot),'question',null,mode,mode==='audio-given'?keyboards[Math.floor(Math.random()*3)]:null);
  insertQueue.run(profileCode,reserved?.queuePosition??nextQueuePosition(profileCode),id);
  recordSelection(id,batch,slot,selected);return id;
}

export function ensureLaunchQueue(profileCode: string): boolean {
  initializeMode(profileCode);
  // Undisplayed weighted reservations from the earlier app become questions;
  // their original source and complexity selections remain unchanged.
  const old = db.prepare(`SELECT q.observation_id FROM queue_items q LEFT JOIN selection_attempts a ON a.observation_id=q.observation_id WHERE q.profile_code=? AND a.observation_id IS NULL`).all(profileCode) as Array<{observation_id:string}>;
  for (const row of old) {
    const question = questionChoice(profileCode);
    db.prepare("UPDATE observation_acquisitions SET observation_kind='question',question_mode=?,question_keyboard=? WHERE observation_id=?")
      .run(question.mode, question.mode==='audio-given'?'windows-inscript':null,row.observation_id);
    recordAttempt(row.observation_id,profileCode,selectionMode(profileCode));
  }
  if (selectionMode(profileCode) === 'core') {
    if (db.prepare('SELECT 1 FROM core_batches WHERE profile_code=? AND applied=0').get(profileCode) || queueCount(profileCode)>0) return false;
    let blockedError: string | null = null;
    const added = db.transaction(() => {
      const draft = draftCoreBatch(profileCode);
      if (draft.endReason === 'completed') return false;
      if (!draft.choices.length) {
        blockedError = `Core ${draft.core} is blocked: no unused audio observation for an unmastered target. Progress is preserved.`;
        const last = db.prepare('SELECT type,core,inventory_id FROM core_diagnostic_events WHERE profile_code=? ORDER BY seq DESC LIMIT 1').get(profileCode) as {type:string;core:number;inventory_id:string}|undefined;
        if (last?.type !== 'walk-blocked' || last.core !== draft.core || last.inventory_id !== draft.inventoryId)
          coreEvent(profileCode, 'walk-blocked', {inventoryId:draft.inventoryId,core:draft.core}, {reason:draft.endReason,decision:draft.stopDecision});
        return false;
      }
      const batch = randomUUID();
      const previous = db.prepare('SELECT id,core,end_reason FROM core_batches WHERE profile_code=? ORDER BY rowid DESC LIMIT 1').get(profileCode) as {id:string;core:number;end_reason:string}|undefined;
      db.prepare('INSERT INTO core_batches(id,profile_code,inventory_id,core,size,snapshot_json,end_reason) VALUES(?,?,?,?,?,?,?)')
        .run(batch,profileCode,draft.inventoryId,draft.core,draft.choices.length,JSON.stringify(coreProgress(profileCode)),draft.endReason);
      coreEvent(profileCode, 'walk-started', {inventoryId:draft.inventoryId,core:draft.core,batchId:batch},
        {reason:!previous?'initial-seed':previous.core!==draft.core?'core-advanced':previous.end_reason,
         previousBatchId:previous?.id??null,previousCore:previous?.core??null,randomRestart:Boolean(previous),size:draft.choices.length}, `start:${batch}`);
      draft.choices.forEach((choice,slot)=>appendCoreObservation(profileCode,batch,slot,draft.choices.length,choice));
      coreEvent(profileCode, 'walk-closed', {inventoryId:draft.inventoryId,core:draft.core,batchId:batch},
        {reason:draft.endReason,stage:'draft',size:draft.choices.length,lastTargetId:draft.choices.at(-1)?.target.id,decision:draft.stopDecision}, `close:${batch}`);
      return true;
    }).immediate();
    if (blockedError) throw new Error(blockedError);
    return added;
  }
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
  if(selectionMode(profileCode)==='core') return '';
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

export function replaceRejectedQueuedObservation(observationId: string, rejectionReason = 'rejected-reservation'): void {
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
      if (db.prepare('SELECT 1 FROM parked_queues WHERE observation_id=?').get(observationId)) {
        db.prepare("UPDATE observations SET status='pending',preparation_attempts=0,preparation_error=NULL,preparation_retry_at=NULL WHERE id=?").run(observationId);
        return;
      }
      if (db.prepare('SELECT 1 FROM queue_items WHERE observation_id = ?').get(observationId)) {
        logger.error('queue_item_missing_acquisition_metadata', { observationId });
        throw new Error('Queued observation has no acquisition.');
      }
      return;
    }
    const coreAttempt=selectionAttempt(observationId,row.profile_code);
    if(coreAttempt?.mode==='core'){ replaceCoreObservation(row.profile_code,observationId,row,rejectionReason);return; }
    const grammarAttempt=attempt(observationId,row.profile_code);
    if(grammarAttempt){
      db.prepare('DELETE FROM grammar_attempts WHERE observation_id=?').run(observationId);
      deleteObservationById.run(observationId);
      appendGrammarObservation(row.profile_code,row,row,{batch:grammarAttempt.batch_id,slot:grammarAttempt.slot,target:grammarAttempt.target_id});
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


function appendCoreObservation(profile: string, batch: string, slot: number, size: number, choice: CoreSelection,
  reserved?: {acquisitionNumber:number;queuePosition:number}): string {
  const id=randomUUID(), cat=getParsingCatalog(), questionType=questionChoice(profile);
  const snapshot={mode:'core',inventoryId:cat.identity.inventoryId,targetId:choice.target.id,
    category:choice.target.core-1,categoryLevel:choice.target.core,core:choice.target.core,
    label:choice.target.label,kind:choice.target.kind,chain:choice.target.chain??null,
    chainAlternatives:choice.target.chain_alternatives??null,nesting:'linear',
    sourceId:choice.row.source_id,sourceKey:choice.row.source_key,rowId:choice.row.id,
    textHash:choice.row.text_hash,length:choice.row.length,transition:choice.transition,
    questionType,...cat.evidence(choice.row,choice.target.id)};
  insertObservation.run(id,choice.row.source_id,choice.row.source_key,Date.now(),batch,'launch-fill',size,slot+1);
  insertAcquisition.run(id,profile,reserved?.acquisitionNumber??nextAcquisitionNumber(profile),'initial-fill',null,null,Date.now(),waitingPreparationCount(),preparationInFlight()?1:0,JSON.stringify(snapshot),'question',null,questionType.mode,questionType.mode==='audio-given'?'windows-inscript':null);
  insertQueue.run(profile,reserved?.queuePosition??nextQueuePosition(profile),id);
  recordAttempt(id,profile,'core',{batch,slot,target:choice.target.id,core:choice.target.core,textHash:choice.row.text_hash});
  const prior = db.prepare('SELECT target_id FROM selection_attempts WHERE batch_id=? AND slot=?').get(batch,slot-1) as {target_id:string}|undefined;
  coreEvent(profile,'observation-selected',{inventoryId:cat.identity.inventoryId,core:choice.target.core,batchId:batch,observationId:id,targetId:choice.target.id,slot},
    {snapshot,catalogIdentity:cat.identity,text:choice.row.text,fromTargetId:prior?.target_id??null,transition:choice.transition,decision:choice.decision??null},`selected:${id}`);
  return id;
}

function replaceCoreObservation(profile: string, id: string, reserved: {acquisitionNumber:number;queuePosition:number}, rejectionReason: string): void {
  const a=selectionAttempt(id,profile)!;
  const batch=db.prepare('SELECT size FROM core_batches WHERE id=?').get(a.batch_id) as {size:number};
  const context=selectionContext(profile,a.core!);
  const replacement=getParsingCatalog().shortest(a.target_id!,context.excluded,context.blocked);
  if(replacement){
    deleteObservationById.run(id);
    const newId=appendCoreObservation(profile,a.batch_id!,a.slot!,batch.size,{target:graph().nodes[a.target_id!]!,row:replacement,transition:a.slot===0?'seed':'neighbor'},reserved);
    coreEvent(profile,'observation-replaced',{core:a.core,batchId:a.batch_id,observationId:newId,targetId:a.target_id,slot:a.slot},{oldObservationId:id,newObservationId:newId,reason:rejectionReason,movementChanged:false},`replacement:${id}`);
    return;
  }
  // A failed media reservation is not a wrong answer. Close the walk before
  // this slot, release its undisplayed suffix, and apply only real answers.
  const suffix=db.prepare('SELECT observation_id FROM selection_attempts WHERE batch_id=? AND slot>=? AND displayed_at IS NULL').all(a.batch_id,a.slot) as Array<{observation_id:string}>;
  for(const r of suffix){db.prepare('DELETE FROM queue_items WHERE observation_id=?').run(r.observation_id);db.prepare('DELETE FROM parked_queues WHERE observation_id=?').run(r.observation_id);deleteObservationById.run(r.observation_id);}
  db.prepare("UPDATE core_batches SET size=(SELECT COUNT(*) FROM selection_attempts WHERE batch_id=?),end_reason='unavailable-media-neighbor' WHERE id=?").run(a.batch_id,a.batch_id);
  coreEvent(profile,'walk-truncated',{core:a.core,batchId:a.batch_id,observationId:id,targetId:a.target_id,slot:a.slot},
    {reason:'unavailable-media-neighbor',rejectionReason,discardedObservationIds:suffix.map(r=>r.observation_id),reseedAfterRemainingAnswers:true},`truncate:${id}`);
  applyFinishedBatch(a.batch_id!);
}
