import { db } from '../db/database';

export interface CoreEventContext {
  inventoryId?: string | null; core?: number | null; batchId?: string | null;
  observationId?: string | null; targetId?: string | null; slot?: number | null;
}
export function coreEvent(profile: string, type: string, context: CoreEventContext = {}, details: unknown = {}, key?: string): void {
  if (!context.inventoryId && context.batchId) {
    const batch=db.prepare('SELECT inventory_id FROM core_batches WHERE id=?').get(context.batchId) as {inventory_id:string}|undefined;
    context={...context,inventoryId:batch?.inventory_id??null};
  }
  db.prepare(`INSERT OR IGNORE INTO core_diagnostic_events
    (event_key,profile_code,occurred_at,type,inventory_id,core,batch_id,observation_id,target_id,slot,details_json)
    VALUES(?,?,?, ?,?,?,?,?,?,?,?)`).run(key ?? null, profile, Date.now(), type,
      context.inventoryId ?? null, context.core ?? null, context.batchId ?? null,
      context.observationId ?? null, context.targetId ?? null, context.slot ?? null, JSON.stringify(details));
}

// Called after the original parsing tables exist. Events deliberately do not
// reference observations: discarded reservations must remain auditable.
export function initializeCoreDiagnostics(): void {
  db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS core_diagnostic_install(id INTEGER PRIMARY KEY CHECK(id=1),started_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS core_diagnostic_events(
        seq INTEGER PRIMARY KEY AUTOINCREMENT,event_key TEXT UNIQUE,
        profile_code TEXT NOT NULL REFERENCES profiles(code) ON DELETE CASCADE,
        occurred_at INTEGER NOT NULL,type TEXT NOT NULL,inventory_id TEXT,core INTEGER,
        batch_id TEXT,observation_id TEXT,target_id TEXT,slot INTEGER,details_json TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS core_events_profile_seq ON core_diagnostic_events(profile_code,seq);
      CREATE INDEX IF NOT EXISTS core_events_profile_core ON core_diagnostic_events(profile_code,inventory_id,core,seq);
      CREATE TRIGGER IF NOT EXISTS core_diagnostic_preparation
      AFTER UPDATE OF status,prepared_at,preparation_error,preparation_attempts ON observations
      WHEN (OLD.status IS NOT NEW.status OR OLD.prepared_at IS NOT NEW.prepared_at
        OR OLD.preparation_error IS NOT NEW.preparation_error OR OLD.preparation_attempts IS NOT NEW.preparation_attempts)
      BEGIN
        INSERT INTO core_diagnostic_events(profile_code,occurred_at,type,inventory_id,core,batch_id,observation_id,target_id,slot,details_json)
        SELECT a.profile_code,CAST((julianday('now')-2440587.5)*86400000 AS INTEGER),
          CASE WHEN NEW.status='ready' THEN 'observation-prepared' WHEN NEW.preparation_error IS NOT NULL THEN 'preparation-failed' ELSE 'preparation-state' END,
          b.inventory_id,a.core,a.batch_id,NEW.id,a.target_id,a.slot,
          json_object('fromStatus',OLD.status,'status',NEW.status,'preparedAt',NEW.prepared_at,
            'attempts',NEW.preparation_attempts,'error',NEW.preparation_error,'retryAt',NEW.preparation_retry_at,
            'sourceId',NEW.source_id,'sourceKey',NEW.source_key,'text',NEW.text)
        FROM selection_attempts a JOIN core_batches b ON b.id=a.batch_id WHERE a.observation_id=NEW.id AND a.mode='core';
      END;
      CREATE TRIGGER IF NOT EXISTS core_diagnostic_discard
      BEFORE DELETE ON observations BEGIN
        INSERT INTO core_diagnostic_events(profile_code,occurred_at,type,inventory_id,core,batch_id,observation_id,target_id,slot,details_json)
        SELECT a.profile_code,CAST((julianday('now')-2440587.5)*86400000 AS INTEGER),'observation-discarded',
          b.inventory_id,a.core,a.batch_id,OLD.id,a.target_id,a.slot,
          json_object('sourceId',OLD.source_id,'sourceKey',OLD.source_key,'text',OLD.text,'status',OLD.status,
            'result',a.result,'displayedAt',a.displayed_at,'snapshot',json(q.selection_snapshot_json))
        FROM selection_attempts a JOIN core_batches b ON b.id=a.batch_id
        JOIN observation_acquisitions q ON q.observation_id=a.observation_id
        WHERE a.observation_id=OLD.id AND a.mode='core';
      END;
    `);
    const first = db.prepare('INSERT OR IGNORE INTO core_diagnostic_install VALUES(1,?)').run(Date.now());
    if (!first.changes) return;
    // Preserve existing retained evidence as a baseline, never fabricate a past
    // walk reset or a selection/preparation event we did not observe.
    const rows = db.prepare(`SELECT a.*,b.inventory_id,o.source_id,o.source_key,o.text,o.status,o.prepared_at,
      q.selection_snapshot_json FROM selection_attempts a JOIN core_batches b ON b.id=a.batch_id
      JOIN observations o ON o.id=a.observation_id JOIN observation_acquisitions q ON q.observation_id=a.observation_id
      WHERE a.mode='core'`).iterate();
    for (const value of rows) {
      const r = value as Record<string, any>;
      coreEvent(r.profile_code, 'legacy-observation', { inventoryId:r.inventory_id, core:r.core, batchId:r.batch_id,
        observationId:r.observation_id,targetId:r.target_id,slot:r.slot }, { reconstructed:true,...r }, `legacy:${r.observation_id}`);
    }
  })();
}
