import Database from 'better-sqlite3';
import { db } from '../db/database';
import { config } from '../config/config';
import { graph } from './state';
import { getParsingCatalog } from './catalog';
import type { ParsingDiagnostics, TargetDiagnostic, DiagnosticEvent } from '../../../shared/parsing-diagnostics';

type Counts = { target_id:string; corpusRows:number; corpusTexts:number; audioReferenceRows:number };
let cachedCounts: { filename:string; identity:string; counts:Map<string,Counts> } | undefined;
function corpusCounts() {
  const c=getParsingCatalog();
  if (cachedCounts?.filename===c.filename && cachedCounts.identity===c.identity.inventoryId) return cachedCounts.counts;
  // One aggregate per completed snapshot, never reparsing words or rescanning on
  // every status poll. members already deduplicates (target, source row).
  const rows=c.db.prepare(`SELECT m.target_id,COUNT(*) AS corpusRows,
    COUNT(DISTINCT r.text_hash) AS corpusTexts,
    SUM(CASE WHEN r.audio_key<>'' THEN 1 ELSE 0 END) AS audioReferenceRows
    FROM members m JOIN rows r ON r.id=m.row_id GROUP BY m.target_id`).all() as Counts[];
  const counts=new Map(rows.map(r=>[r.target_id,r]));
  cachedCounts={filename:c.filename,identity:c.identity.inventoryId,counts}; return counts;
}
export const percent=(done:number,total:number):number|null => total ? 100*done/total : null;
export function parsingDiagnostics(profile:string,connection:Database.Database=db):ParsingDiagnostics {
  const store=connection;
  let counts:Map<string,Counts>|null=null,catalogError:string|null=null;
  try { counts=corpusCounts(); } catch(e) { catalogError=e instanceof Error?e.message:'Parsing snapshot unavailable'; }
  const current=store.prepare('SELECT inventory_id FROM parsing_system WHERE id=1').get() as {inventory_id:string|null};
  const saved=store.prepare('SELECT core,inventory_id FROM core_progress WHERE profile_code=?').get(profile) as {core:number;inventory_id:string}|undefined;
  const inventory=saved?.inventory_id??current.inventory_id;
  const progressError=saved && saved.inventory_id!==current.inventory_id ? 'Saved progress belongs to a different inventory. Export it before an explicit migration.' : null;
  const streaks=store.prepare('SELECT target_id,streak FROM core_streaks WHERE profile_code=? AND inventory_id=?').all(profile,inventory) as Array<{target_id:string;streak:number}>;
  const byId=new Map(streaks.map(r=>[r.target_id,r.streak]));
  const appearances=store.prepare(`SELECT target_id,
    COUNT(DISTINCT CASE WHEN type IN('observation-selected','legacy-observation') THEN observation_id END) AS selected,
    COUNT(DISTINCT CASE WHEN type='observation-displayed' OR (type='legacy-observation' AND json_extract(details_json,'displayed_at') IS NOT NULL) THEN observation_id END) AS displayed,
    COUNT(DISTINCT CASE WHEN type='answer-recorded' OR (type='legacy-observation' AND json_extract(details_json,'result') IS NOT NULL) THEN observation_id END) AS answered
    FROM core_diagnostic_events e WHERE profile_code=? AND (inventory_id=? OR
      (inventory_id IS NULL AND batch_id IN(SELECT id FROM core_batches WHERE profile_code=? AND inventory_id=?)))
    GROUP BY target_id`).all(profile,inventory,profile,inventory) as Array<{target_id:string;selected:number;displayed:number;answered:number}>;
  const seen=new Map(appearances.map(r=>[r.target_id,r]));
  const pending=store.prepare(`SELECT a.target_id,COUNT(*) AS n FROM selection_attempts a JOIN core_batches b ON b.id=a.batch_id
    WHERE a.profile_code=? AND b.inventory_id=? AND b.applied=0 AND a.result IS NOT NULL GROUP BY a.target_id`).all(profile,inventory) as Array<{target_id:string;n:number}>;
  const pendingById=new Map(pending.map(r=>[r.target_id,r.n]));
  const targets:TargetDiagnostic[]=Object.values(graph().nodes).map(n=>{
    const c=counts?.get(n.id),a=seen.get(n.id),streak=byId.get(n.id)??0;
    return {id:n.id,core:n.core,kind:n.kind,label:n.label,forms:n.forms??[],chain:n.chain??[],chainAlternatives:n.chain_alternatives??[],
      streak,mastered:streak===3,corpusRows:counts?(c?.corpusRows??0):null,corpusTexts:counts?(c?.corpusTexts??0):null,
      audioReferenceRows:counts?(c?.audioReferenceRows??0):null,selected:a?.selected??0,displayed:a?.displayed??0,
      answered:a?.answered??0,pendingAnswers:pendingById.get(n.id)??0};
  });
  const core=saved?.core??1;
  return {version:1,generatedAt:Date.now(),auditStartedAt:(store.prepare('SELECT started_at FROM core_diagnostic_install WHERE id=1').get() as {started_at:number}).started_at,
    currentCore:core,inventoryId:inventory,catalogError,progressError,targets,
    historyNotice:'Exact event history starts when this add-on was installed. Retained earlier observations are labeled legacy-observation; already deleted observations and earlier reset reasons cannot be reconstructed.',
    levels:[1,2,3].map(c=>{
      const all=targets.filter(t=>t.core===c),done=all.filter(t=>t.mastered).length;
      const group=(kind:'vocabulary'|'chain')=>{const rows=all.filter(t=>t.kind===kind),mastered=rows.filter(t=>t.mastered).length;return {total:rows.length,mastered,percent:percent(mastered,rows.length)};};
      return {core:c,total:all.length,mastered:done,percent:percent(done,all.length),vocabulary:group('vocabulary'),modifiers:group('chain'),
        withExamples:counts?all.filter(t=>t.corpusRows!>0).length:null,withoutExamples:counts?all.filter(t=>t.corpusRows===0).length:null,
        pendingAnswers:all.reduce((a,t)=>a+t.pendingAnswers,0),status:c<core?'completed':c===core?'current':'upcoming'};
    })};
}
export function diagnosticEvents(profile:string,core:number,before:number,limit=50):DiagnosticEvent[] {
  return (db.prepare(`SELECT seq,occurred_at,type,core,batch_id,observation_id,target_id,slot,details_json
    FROM core_diagnostic_events WHERE profile_code=? AND (core=? OR core IS NULL) AND seq<? ORDER BY seq DESC LIMIT ?`)
    .all(profile,core,before,limit) as Array<Omit<DiagnosticEvent,'details'> & {details_json:string}>).map(({details_json,...e})=>({...e,details:JSON.parse(details_json)}));
}

// Dedicated read transaction: a consistent user-state snapshot while writes
// continue on the normal WAL connection. Iterators and backpressure bound memory.
// This is data JSON, not app backup/restore; no tokens or audio blobs are exported.
export function diagnosticExport(profile:string) {
  const reader=new Database(config.databasePath,{readonly:true,fileMustExist:true});
  reader.exec('BEGIN');
  let diagnostics:ParsingDiagnostics;
  try {diagnostics=parsingDiagnostics(profile,reader);} catch(e) {reader.exec('ROLLBACK');reader.close();throw e;}
  const highWater=(reader.prepare('SELECT COALESCE(MAX(seq),0) AS n FROM core_diagnostic_events WHERE profile_code=?').get(profile) as {n:number}).n;
  const sections:Array<[string,string]>=[
    ['progress','SELECT * FROM core_progress WHERE profile_code=?'],
    ['streaks','SELECT * FROM core_streaks WHERE profile_code=? ORDER BY inventory_id,core,target_id'],
    ['batches','SELECT * FROM core_batches WHERE profile_code=? ORDER BY rowid'],
    ['observations',`SELECT a.*,o.source_id,o.source_key,o.text,o.status,o.selected_at,o.prepared_at,o.preparation_error,
      q.selection_snapshot_json,q.question_mode FROM selection_attempts a JOIN observations o ON o.id=a.observation_id
      JOIN observation_acquisitions q ON q.observation_id=a.observation_id WHERE a.profile_code=? AND a.mode='core' ORDER BY o.selected_at,o.id`],
    ['usedSentences','SELECT * FROM core_used WHERE profile_code=? ORDER BY core,displayed_at,text_hash'],
    ['activeQueue','SELECT * FROM queue_items WHERE profile_code=? ORDER BY queue_position'],
    ['parkedQueues','SELECT * FROM parked_queues WHERE profile_code=? ORDER BY mode,queue_position'],
    ['events','SELECT * FROM core_diagnostic_events WHERE profile_code=? ORDER BY seq'],
  ];
  let closed=false;
  const close=()=>{if(!closed){closed=true;try{reader.exec('ROLLBACK');}finally{reader.close();}}};
  async function* chunks():AsyncGenerator<string> {
    try {
      yield '{"format":"telugu-core-diagnostics","version":1,"eventHighWater":'+highWater+',"summary":'+JSON.stringify(diagnostics);
      yield ',"inventory":'+JSON.stringify(graph());
      for(const [name,sql] of sections) {
        yield ','+JSON.stringify(name)+':[';let first=true;
        for(const value of reader.prepare(sql).iterate(profile)) {
          const row={...(value as Record<string,unknown>)};
          for(const key of Object.keys(row)) if(key.endsWith('_json') && typeof row[key]==='string') {
            try {row[key.slice(0,-5)]=JSON.parse(row[key] as string);delete row[key];} catch { /* Keep original if legacy JSON is malformed. */ }
          }
          yield (first?'':',')+JSON.stringify(row);first=false;
        }
        yield ']';
      }
      yield '}';
    } finally {close();}
  }
  return {chunks:chunks(),close};
}
