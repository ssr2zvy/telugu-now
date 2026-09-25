import { chainActivity } from './chain-activity';
import Database from 'better-sqlite3';
import { db } from '../db/database';
import { config } from '../config/config';
import { graph } from './state';
import type { ParsingDiagnostics, TargetDiagnostic, DiagnosticEvent } from '../../../shared/parsing-diagnostics';

import { inventoryId } from './state';
import { savedWordStats, workerError, workerPhase } from './live-worker';
import { liveSelection, getQueueCounts, guider } from '../services/queue-service';
export const percent=(done:number,total:number):number|null=>total?100*done/total:null;
export function parsingDiagnostics(profile:string,store:Database.Database=db):ParsingDiagnostics {
  const wordStats=savedWordStats();
  const saved=store.prepare('SELECT core,inventory_id FROM core_progress WHERE profile_code=?').get(profile) as {core:number;inventory_id:string}|undefined;
  const inventory=inventoryId(),core=saved?.core??1;
  const progressError=saved&&saved.inventory_id!==inventory?'Target inventory changed; progress migration required':null;
  const streaks=new Map((store.prepare('SELECT target_id,streak FROM core_streaks WHERE profile_code=? AND inventory_id=?').all(profile,inventory) as Array<{target_id:string;streak:number}>).map(r=>[r.target_id,r.streak]));
  const searches=new Map((store.prepare(`SELECT s.target_id,COUNT(*) AS searches,SUM(s.checked) AS checked,
    SUM(CASE WHEN outcome='exhausted' THEN 1 ELSE 0 END) AS exhausted
    FROM live_searches s JOIN live_cycles c ON c.id=s.cycle_id WHERE c.profile_code=? GROUP BY s.target_id`).all(profile) as Array<{target_id:string;searches:number;checked:number;exhausted:number}>).map(r=>[r.target_id,r]));
  const appearances=new Map((store.prepare(`SELECT target_id,COUNT(*) AS selected,
    SUM(displayed_at IS NOT NULL) AS displayed,SUM(result IS NOT NULL) AS answered
    FROM selection_attempts a JOIN core_batches b ON b.id=a.batch_id WHERE a.profile_code=? AND b.inventory_id=? GROUP BY target_id`).all(profile,inventory) as Array<{target_id:string;selected:number;displayed:number;answered:number}>).map(r=>[r.target_id,r]));
  const targets:TargetDiagnostic[]=Object.values(graph().nodes).map(n=>{
    const a=appearances.get(n.id),search=searches.get(n.id),matchedWords=wordStats?wordStats.matches[n.id]??0:null;
    return {id:n.id,core:n.core,kind:n.kind,label:n.label,...(n.example?{example:n.example}:{}),forms:n.forms??[],chain:n.chain??[],chainAlternatives:n.chain_alternatives??[],
      streak:streaks.get(n.id)??0,mastered:streaks.get(n.id)===3,matchedWords,
      searches:search?.searches??0,checked:search?.checked??0,exhausted:search?.exhausted??0,
      pattern:wordStats?.patterns?.[n.id]??null,
      corpusRows:null,corpusTexts:null,audioReferenceRows:null,
      selected:a?.selected??0,displayed:a?.displayed??0,answered:a?.answered??0,pendingAnswers:0};
  });
  const summary=store.prepare(`SELECT COUNT(*) AS total,SUM(ended_at IS NULL) AS active,
    COALESCE(SUM(steps),0) AS steps FROM live_cycles WHERE profile_code=?`).get(profile) as {total:number;active:number|null;steps:number};
  const reasons=store.prepare('SELECT end_reason AS reason,COUNT(*) AS count FROM live_cycles WHERE profile_code=? AND ended_at IS NOT NULL GROUP BY end_reason').all(profile) as Array<{reason:string;count:number}>;
  const current=store.prepare(`SELECT h.observation_id AS observationId,json_extract(q.selection_snapshot_json,'$.cycleId') AS cycleId
    FROM profiles p JOIN history_entries h ON h.profile_code=p.code AND h.history_position=p.current_position
    JOIN observation_acquisitions q ON q.observation_id=h.observation_id WHERE p.code=?`).get(profile) as {observationId:string;cycleId:string|null}|undefined;
  const cycle=current?.cycleId?store.prepare('SELECT id,core,end_reason AS endReason FROM live_cycles WHERE id=? AND profile_code=?').get(current.cycleId,profile) as {id:string;core:number;endReason:string|null}|undefined:undefined;
  const currentChain=cycle&&current?{...cycle,currentObservationId:current.observationId,
    steps:(store.prepare(`SELECT a.observation_id AS observationId,a.target_id AS targetId,
      json_extract(q.selection_snapshot_json,'$.word') AS word,a.displayed_at AS displayed,a.answered_at AS answered
      FROM selection_attempts a JOIN observation_acquisitions q ON q.observation_id=a.observation_id
      WHERE a.profile_code=? AND json_extract(q.selection_snapshot_json,'$.cycleId')=? ORDER BY q.acquisition_number`)
      .all(profile,cycle.id) as Array<{observationId:string;targetId:string;word:string|null;displayed:number|null;answered:number|null}>)
      .map(s=>({...s,label:graph().nodes[s.targetId]?.label??s.targetId,displayed:s.displayed!==null,answered:s.answered!==null}))}:null;
  const activity=chainActivity(store,profile);
  return {version:1,generatedAt:Date.now(),auditStartedAt:(store.prepare('SELECT started_at FROM core_diagnostic_install WHERE id=1').get() as {started_at:number}).started_at,
    ...activity,guider:guider.get(profile)??{generating:false,cycleId:null},
    currentChain,currentCore:core,inventoryId:inventory,catalogError:workerError,progressError,targets,
    cache:wordStats?{total:wordStats.total,checked:wordStats.checked,parsed:wordStats.parsed,rejected:wordStats.rejected,validParses:Object.values(wordStats.matches).reduce((sum,n)=>sum+n,0)}:null,
    selectionPolicy:'shortest-codepoints-v1',worker:{phase:workerPhase,error:workerError},
    queue:{...getQueueCounts(profile,store),errors:(store.prepare(`SELECT DISTINCT o.preparation_error AS error
      FROM queue_items q JOIN observations o ON o.id=q.observation_id
      WHERE q.profile_code=? AND o.preparation_error IS NOT NULL`).all(profile) as Array<{error:string}>).map(r=>r.error)},
    activity:liveSelection.get(profile)??{phase:workerPhase,target:null,checked:0,error:workerError},
    cycles:{...summary,active:summary.active??0,reasons},
    historyNotice:'Matches count distinct cached words across profiles, not all corpus matches. Zero can mean not searched yet. Searches and connection cycles are recorded for this profile from this version onward. Previously shown observations remain eligible.',
    levels:[1,2,3].map(c=>{
      const all=targets.filter(t=>t.core===c),done=all.filter(t=>t.mastered).length;
      const group=(kind:'vocabulary'|'chain')=>{const rows=all.filter(t=>t.kind===kind),mastered=rows.filter(t=>t.mastered).length;return {total:rows.length,mastered,percent:percent(mastered,rows.length)};};
      return {core:c,total:all.length,mastered:done,percent:percent(done,all.length),vocabulary:group('vocabulary'),modifiers:group('chain'),
        withExamples:wordStats?all.filter(t=>(t.matchedWords??0)>0).length:null,withoutExamples:wordStats?all.filter(t=>t.matchedWords===0).length:null,
        pendingAnswers:0,status:c<core?'completed':c===core?'current':'upcoming'};
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
    ['observations',`SELECT o.*,a.target_id,a.core,a.mode,a.result,a.displayed_at,a.answered_at,
      q.selection_snapshot_json,q.question_mode FROM observation_acquisitions q JOIN observations o ON o.id=q.observation_id
      LEFT JOIN selection_attempts a ON a.observation_id=o.id WHERE q.profile_code=? ORDER BY q.acquisition_number`],
    ['selections','SELECT * FROM selection_attempts WHERE profile_code=? ORDER BY rowid'],
    ['acquisitions','SELECT * FROM observation_acquisitions WHERE profile_code=? ORDER BY acquisition_number'],
    ['history','SELECT * FROM history_entries WHERE profile_code=? ORDER BY history_position'],
    ['responses',`SELECT profile_code,observation_id,response_text,response_audio_mime_type,updated_at,
      length(response_audio) AS response_audio_bytes FROM question_responses WHERE profile_code=? ORDER BY updated_at,observation_id`],
    ['cycles','SELECT * FROM live_cycles WHERE profile_code=? ORDER BY started_at,id'],
    ['discarded','SELECT * FROM live_discarded_observations WHERE profile_code=? ORDER BY discarded_at,observation_id'],
    ['searches','SELECT s.* FROM live_searches s JOIN live_cycles c ON c.id=s.cycle_id WHERE c.profile_code=? ORDER BY s.rowid'],
    ['activeQueue','SELECT * FROM queue_items WHERE profile_code=? ORDER BY queue_position'],

    ['events','SELECT * FROM core_diagnostic_events WHERE profile_code=? ORDER BY seq'],
  ];
  if(reader.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='grammar_attempts'").get()) {
    sections.push(['legacyGrammarSelections','SELECT a.* FROM grammar_attempts a JOIN grammar_batches b ON b.id=a.batch_id WHERE b.profile_code=? ORDER BY a.rowid']);
    sections.push(['legacyGrammarBatches','SELECT * FROM grammar_batches WHERE profile_code=? ORDER BY rowid']);
    sections.push(['legacyGrammarProgress','SELECT * FROM grammar_progress WHERE profile_code=?']);
  }
  let closed=false;
  const close=()=>{if(!closed){closed=true;try{reader.exec('ROLLBACK');}finally{reader.close();}}};
  async function* chunks():AsyncGenerator<string> {
    try {
      yield '{"format":"telugu-live-frequency-diagnostics","version":2,"eventHighWater":'+highWater+',"summary":'+JSON.stringify(diagnostics);
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
