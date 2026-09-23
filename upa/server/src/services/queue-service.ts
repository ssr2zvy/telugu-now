import { randomUUID } from 'node:crypto';
import { db } from '../db/database';
import { coreEvent } from '../parsing/audit';
import { initializeMode, coreProgress, graph, inventoryId, questionChoice, recordAttempt, attempt, applyFinishedBatch } from '../parsing/state';
import { findWord, stopWordWorker, type SearchProgress, type WordRow } from '../parsing/live-worker';
import { audioStorageIdentity } from './audio-validation-store';
import { config } from '../config/config';
import { logger } from './logger';
import type { ObservationKind,QuestionKeyboard,QuestionMode,QuestionPool } from '../../../shared/contracts';

export interface ObservationPlan {kind:ObservationKind;requestedPool:QuestionPool|null;questionMode:QuestionMode|null;keyboard:QuestionKeyboard|null}
export function chooseObservationPlan(random=Math.random, probabilities={question:1,seen:0,audioGiven:0.6}):ObservationPlan {
  const mode=random()<probabilities.audioGiven?'audio-given':'text-given';
  return {kind:'question',requestedPool:null,questionMode:mode,keyboard:mode==='audio-given'?'windows-inscript':null};
}
export function getQueueCount(profile:string):number{return (db.prepare('SELECT COUNT(*) AS n FROM queue_items WHERE profile_code=?').get(profile) as {n:number}).n;}
export function getQueueCounts(profile:string,store=db){
  const rows=store.prepare('SELECT o.status,o.preparation_error,o.preparation_retry_at FROM queue_items q JOIN observations o ON o.id=q.observation_id WHERE q.profile_code=?').all(profile) as Array<{status:string;preparation_error:string|null;preparation_retry_at:number|null}>;
  return {depth:rows.length,preparing:rows.filter(r=>r.status==='preparing').length,pending:rows.filter(r=>r.status==='pending').length,ready:rows.filter(r=>r.status==='ready').length,
    failed:rows.filter(r=>r.preparation_error&&r.preparation_retry_at===null).length};
}

db.exec(`CREATE TABLE IF NOT EXISTS live_cycles(
  id TEXT PRIMARY KEY,profile_code TEXT NOT NULL REFERENCES profiles(code) ON DELETE CASCADE,
  core INTEGER NOT NULL,started_at INTEGER NOT NULL,ended_at INTEGER,end_reason TEXT,steps INTEGER NOT NULL DEFAULT 0);
  CREATE INDEX IF NOT EXISTS live_cycles_profile ON live_cycles(profile_code,started_at);
  CREATE TABLE IF NOT EXISTS live_searches(
  id TEXT PRIMARY KEY,cycle_id TEXT NOT NULL REFERENCES live_cycles(id) ON DELETE CASCADE,target_id TEXT NOT NULL,
  started_at INTEGER NOT NULL,ended_at INTEGER,checked INTEGER NOT NULL DEFAULT 0,outcome TEXT,word TEXT,
  pattern_json TEXT,from_target TEXT);
  CREATE INDEX IF NOT EXISTS live_searches_cycle ON live_searches(cycle_id,started_at);`);
// NULL means these measurements predate tracking; never invent historic counts.
for(const [name,type] of Object.entries({returned:'INTEGER',examined:'INTEGER',parsed:'INTEGER',matching:'INTEGER',reused:'INTEGER',stage:'TEXT',search_succeeded:'INTEGER',error:'TEXT'})) {
  if(!(db.prepare('PRAGMA table_info(live_searches)').all() as Array<{name:string}>).some(column=>column.name===name))db.exec(`ALTER TABLE live_searches ADD COLUMN ${name} ${type}`);
}
db.exec(`CREATE TABLE IF NOT EXISTS live_chain_resets(profile_code TEXT PRIMARY KEY,requested_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS live_discarded_observations(observation_id TEXT PRIMARY KEY,profile_code TEXT NOT NULL,discarded_at INTEGER NOT NULL)`);
export function isDiscarded(id:string,profile:string):boolean{return Boolean(db.prepare('SELECT 1 FROM live_discarded_observations WHERE observation_id=? AND profile_code=?').get(id,profile));}
export const guider=new Map<string,{generating:boolean;cycleId:string|null}>();
function recordSearchProgress(id:string,progress:SearchProgress) {
  db.prepare('UPDATE live_searches SET checked=?,returned=?,examined=?,parsed=?,matching=?,reused=?,stage=?,search_succeeded=COALESCE(?,search_succeeded) WHERE id=? AND ended_at IS NULL')
    .run(progress.checked,progress.returned,progress.examined,progress.parsed,progress.matching,progress.reused,progress.stage,progress.stage==='searching'?null:1,id);
}
db.prepare("UPDATE live_cycles SET ended_at=?,end_reason='process-restarted' WHERE ended_at IS NULL").run(Date.now());
db.prepare("UPDATE live_searches SET ended_at=?,outcome='process-restarted' WHERE ended_at IS NULL").run(Date.now());
interface Chain {id:string;core:number;visited:Set<string>;exhausted:Set<string>;current:string|null}
const chains=new Map<string,Chain>();
const filling=new Set<string>();
const retryAfter=new Map<string,number>();
const retryRequested=new Set<string>();
const discardedCycles=new Set<string>();
export const liveSelection=new Map<string,{phase:string;target:string|null;checked:number;error:string|null}>();
const shuffled=<T,>(items:T[]):T[]=>{for(let i=items.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[items[i],items[j]]=[items[j]!,items[i]!];}return items;};
function closeChain(profile:string,reason:string){
  const chain=chains.get(profile);if(!chain)return;
  db.prepare('UPDATE live_cycles SET ended_at=?,end_reason=? WHERE id=?').run(Date.now(),reason,chain.id);
  coreEvent(profile,'cycle-ended',{core:chain.core},{cycleId:chain.id,reason,visited:[...chain.visited],exhausted:[...chain.exhausted]});
  chains.delete(profile);
}
function newChain(profile:string,core:number):Chain{
  const chain={id:randomUUID(),core,visited:new Set<string>(),exhausted:new Set<string>(),current:null};
  db.prepare('INSERT INTO live_cycles(id,profile_code,core,started_at) VALUES(?,?,?,?)').run(chain.id,profile,core,Date.now());
  chains.set(profile,chain);coreEvent(profile,'cycle-started',{core},{cycleId:chain.id,reason:'random-unfinished-seed'});return chain;
}
function reserve(profile:string,targetId:string,row:WordRow,chain:Chain,source:string){
  const target=graph().nodes[targetId]!,id=randomUUID(),batch=randomUUID(),now=Date.now(),question=questionChoice(profile);
  const snapshot={mode:'core',policy:'frequency-word-cache-v1',inventoryId:inventoryId(),targetId,core:target.core,
    category:target.core-1,categoryLevel:target.core,kind:target.kind,label:target.label,chain:target.chain??null,
    chainAlternatives:target.chain_alternatives??null,sourceId:row.source_id,sourceKey:row.source_key,
    word:row.word,occurrence:row.occurrence,cycleId:chain.id,transition:chain.current?'neighbor':'seed',
    fromTargetId:chain.current,parseSource:source,questionType:question,
    observationSelection:row.observation_selection,wordSelection:'shortest-codepoints-v1',wordLength:Array.from(row.word).length,
    matchedTargets:row.matched_targets.map(id=>({id,label:graph().nodes[id]?.label??id}))};
  db.transaction(()=>{
    db.prepare('INSERT INTO core_batches(id,profile_code,inventory_id,core,size,snapshot_json,end_reason) VALUES(?,?,?,?,1,?,?)')
      .run(batch,profile,inventoryId(),target.core,'{}','single-answer');
    db.prepare("INSERT INTO observations(id,source_id,source_key,text,status,selected_at,group_id,group_kind,group_size,group_position) VALUES(?,?,?,?,'pending',?,?,'launch-fill',1,1)").run(id,row.source_id,row.source_key,row.text,now,batch);
    const number=(db.prepare('SELECT COALESCE(MAX(acquisition_number),0)+1 AS n FROM observation_acquisitions WHERE profile_code=?').get(profile) as {n:number}).n;
    const position=(db.prepare('SELECT COALESCE(MAX(queue_position),-1)+1 AS n FROM queue_items WHERE profile_code=?').get(profile) as {n:number}).n;
    db.prepare(`INSERT INTO observation_acquisitions(observation_id,profile_code,acquisition_number,trigger_kind,trigger_observation_id,trigger_history_position,triggered_at,waiting_ahead_at_trigger,preparation_in_flight_at_trigger,selection_snapshot_json,observation_kind,question_requested_pool,question_mode,question_keyboard)
      VALUES(?,?,?,'initial-fill',NULL,NULL,?,?,0,?,'question',NULL,?,?)`).run(id,profile,number,now,getQueueCount(profile),JSON.stringify(snapshot),question.mode,question.mode==='audio-given'?'windows-inscript':null);
    db.prepare('INSERT INTO queue_items VALUES(?,?,?)').run(profile,position,id);
    recordAttempt(id,profile,'core',{batch,slot:0,target:targetId,core:target.core,textHash:''});
    db.prepare('UPDATE live_cycles SET steps=steps+1 WHERE id=?').run(chain.id);
    coreEvent(profile,'observation-selected',{core:target.core,batchId:batch,observationId:id,targetId},
      {cycleId:chain.id,fromTargetId:chain.current,word:row.word,sourceId:row.source_id,sourceKey:row.source_key,parseSource:source});
  })();
  chain.visited.add(targetId);chain.current=targetId;
}
async function fill(profile:string){
  try{
    while(getQueueCount(profile)<3){
      const progress=coreProgress(profile);
      if(progress.core===4){closeChain(profile,'all-cores-completed');liveSelection.set(profile,{phase:'completed',target:null,checked:0,error:null});return;}
      let chain=chains.get(profile);
      if(chain&&chain.core!==progress.core){closeChain(profile,'core-advanced');chain=undefined;}
      const targets=Object.values(graph().nodes).filter(t=>t.core===progress.core&&(progress.streaks[t.id]??0)<3);
      const pendingTargets=new Set((db.prepare("SELECT a.target_id FROM selection_attempts a JOIN core_batches b ON b.id=a.batch_id WHERE a.profile_code=? AND b.applied=0 AND a.result IS NULL AND a.mode='core' AND NOT EXISTS(SELECT 1 FROM live_discarded_observations d WHERE d.observation_id=a.observation_id) AND a.observation_id IN(SELECT observation_id FROM queue_items WHERE profile_code=? UNION SELECT observation_id FROM history_entries WHERE profile_code=?)").all(profile,profile,profile) as Array<{target_id:string}>).map(r=>r.target_id));
      if(targets.every(t=>pendingTargets.has(t.id))){
        liveSelection.set(profile,{phase:'awaiting-answers',target:null,checked:0,error:null});return;
      }
      chain??=newChain(profile,progress.core);
      guider.set(profile,{generating:true,cycleId:chain.id});
      let eligible=targets.filter(t=>!chain!.visited.has(t.id)&&!chain!.exhausted.has(t.id));
      if(chain.current)eligible=eligible.filter(t=>graph().nodes[chain!.current!]!.neighbors.includes(t.id));
      const options=eligible.filter(t=>!pendingTargets.has(t.id));
      if(!options.length&&eligible.some(t=>pendingTargets.has(t.id))){
        liveSelection.set(profile,{phase:'awaiting-answers',target:null,checked:0,error:null});return;
      }
      if(!options.length){
        if(chain.current){closeChain(profile,'eligible-connections-exhausted');continue;}
        if(targets.some(t=>pendingTargets.has(t.id))){closeChain(profile,'awaiting-pending-answers');return;}
        closeChain(profile,'no-matching-unfinished-target');
        liveSelection.set(profile,{phase:'blocked',target:null,checked:0,error:'No matching playable word found for an unfinished target within its Unicode and length bounds.'});
        retryAfter.set(profile,Date.now()+30000);return;
      }
      const target=shuffled(options)[0]!, searchId=randomUUID();
      db.prepare("INSERT INTO live_searches(id,cycle_id,target_id,started_at,from_target,returned,examined,parsed,matching,reused,stage) VALUES(?,?,?,?,?,0,0,0,0,0,'searching')").run(searchId,chain.id,target.id,Date.now(),chain.current);
      let found;
      do{
        liveSelection.set(profile,{phase:'searching',target:target.id,checked:found?.checked??0,error:null});
        const blocked:string[]=[];
        found=await findWord({target:target.id,searchId,storageIdentity:audioStorageIdentity(config),blocked},progress=>{
          if(discardedCycles.has(chain.id))return;
          recordSearchProgress(searchId,progress);
          liveSelection.set(profile,{phase:progress.stage,target:target.id,checked:progress.checked,error:null});
        });
        if(discardedCycles.has(chain.id))return;
        recordSearchProgress(searchId,{...found,stage:'selecting'});
        db.prepare('UPDATE live_searches SET checked=?,pattern_json=? WHERE id=?').run(found.checked,JSON.stringify(found.pattern),searchId);
        liveSelection.set(profile,{phase:'searching',target:target.id,checked:found.checked,error:null});
      }while(found.pending);
      db.prepare("UPDATE live_searches SET ended_at=?,outcome=?,word=?,stage='finished',search_succeeded=1 WHERE id=?").run(Date.now(),found.row?found.source:'exhausted',found.row?.word??null,searchId);
      const current=coreProgress(profile);
      if(current.core!==target.core||(current.streaks[target.id]??0)>=3)continue;
      if(found.row){reserve(profile,target.id,found.row,chain,found.source);
        void import('./preparation-service').then(({preparationService})=>preparationService.kick());
      }else chain.exhausted.add(target.id);
    }
    liveSelection.set(profile,{phase:'ready',target:null,checked:0,error:null});
  }catch(error){
    const message=error instanceof Error?error.message:String(error);
    const reason=retryRequested.has(profile)?'manual-retry':'worker-error';
    closeChain(profile,reason);
    db.prepare("UPDATE live_searches SET ended_at=?,outcome=?,error=?,stage='failed',search_succeeded=COALESCE(search_succeeded,0) WHERE ended_at IS NULL AND cycle_id IN(SELECT id FROM live_cycles WHERE profile_code=?)").run(Date.now(),reason,message,profile);
    liveSelection.set(profile,{phase:'failed',target:null,checked:0,error:message});retryAfter.set(profile,Date.now()+30000);
    logger.error('live_selection_failed',{error:message});
  }finally{guider.set(profile,{generating:false,cycleId:chains.get(profile)?.id??null});filling.delete(profile);if(retryRequested.delete(profile)){retryAfter.delete(profile);queueMicrotask(()=>ensureLaunchQueue(profile));}}
}
export function ensureLaunchQueue(profile:string):boolean{
  initializeMode(profile);
  if(!filling.has(profile)&&getQueueCount(profile)<3&&Date.now()>=(retryAfter.get(profile)??0)){
    filling.add(profile);void fill(profile);
  }
  return false;
}
export function appendConsumptionReplacement(profile:string,_id:string,_position:number,_time:number):string{ensureLaunchQueue(profile);return '';}
export function clearQueue(profile:string):void{
  db.prepare("UPDATE observations SET preparation_attempts=0,preparation_error=NULL,preparation_retry_at=NULL WHERE id IN(SELECT observation_id FROM queue_items WHERE profile_code=?) AND status='pending'").run(profile);
}
export function replaceRejectedQueuedObservation(id:string,reason='invalid-audio'):void{
  const row=db.prepare('SELECT profile_code FROM queue_items WHERE observation_id=?').get(id) as {profile_code:string}|undefined;
  if(!row)return;
  const selected=attempt(id,row.profile_code);
  db.transaction(()=>{
    coreEvent(row.profile_code,'observation-rejected',{observationId:id,targetId:selected?.target_id??null},{reason});
    db.prepare('DELETE FROM queue_items WHERE observation_id=?').run(id);
    db.prepare('DELETE FROM observations WHERE id=?').run(id);
    if(selected?.batch_id){db.prepare('UPDATE core_batches SET size=0 WHERE id=?').run(selected.batch_id);applyFinishedBatch(selected.batch_id);}
  })();
  ensureLaunchQueue(row.profile_code);
}

// Restart selection without deleting answers, history, or already selected observations.
export function retryLiveSelection(profile:string):void {
  retryAfter.delete(profile);
  if(filling.has(profile)){retryRequested.add(profile);stopWordWorker();return;}
  closeChain(profile,'manual-retry');
  ensureLaunchQueue(profile);
}

// Discard just the displayed chain. Prepared selections from another chain survive.
export function discardCurrentChain(profile:string):void {
  const row=db.prepare(`SELECT json_extract(a.selection_snapshot_json,'$.cycleId') AS id
    FROM profiles p JOIN history_entries h ON h.profile_code=p.code AND h.history_position=p.current_position
    JOIN observation_acquisitions a ON a.observation_id=h.observation_id WHERE p.code=?`).get(profile) as {id:string|null}|undefined;
  const id=row?.id??chains.get(profile)?.id??null;
  if(id){
    discardedCycles.add(id);
    db.transaction(()=>{
      db.prepare("UPDATE live_cycles SET ended_at=?,end_reason='chain-discarded' WHERE id=? AND profile_code=?").run(Date.now(),id,profile);
      db.prepare("UPDATE live_searches SET ended_at=?,outcome='chain-discarded',stage='cancelled' WHERE cycle_id=? AND ended_at IS NULL").run(Date.now(),id);
      db.prepare(`INSERT OR IGNORE INTO live_discarded_observations SELECT a.observation_id,a.profile_code,? FROM observation_acquisitions a
        JOIN selection_attempts s ON s.observation_id=a.observation_id WHERE a.profile_code=? AND json_extract(a.selection_snapshot_json,'$.cycleId')=? AND s.result IS NULL`).run(Date.now(),profile,id);
      db.prepare(`DELETE FROM queue_items WHERE profile_code=? AND observation_id IN(SELECT observation_id FROM observation_acquisitions WHERE profile_code=? AND json_extract(selection_snapshot_json,'$.cycleId')=?)`).run(profile,profile,id);
      coreEvent(profile,'cycle-discarded',{}, {cycleId:id,reason:'reset'});
    })();
    if(chains.get(profile)?.id===id){
      chains.delete(profile);
      if(filling.has(profile))retryRequested.add(profile);
    }
  }
  retryAfter.delete(profile);
  ensureLaunchQueue(profile);
}

// Retire every pending chain before restarting mastery. In-flight worker replies
// are ignored by the same cancellation checks used for a chain reset.
export function discardPendingChains(profile: string): void {
  const active = chains.get(profile);
  if (active) discardedCycles.add(active.id);
  const cycles = db.prepare('SELECT id FROM live_cycles WHERE profile_code=? AND ended_at IS NULL').all(profile) as Array<{id:string}>;
  for (const cycle of cycles) discardedCycles.add(cycle.id);
  const now = Date.now();
  db.prepare("UPDATE live_searches SET ended_at=?, outcome='progress-reset', stage='cancelled' WHERE ended_at IS NULL AND cycle_id IN (SELECT id FROM live_cycles WHERE profile_code=?)").run(now,profile);
  db.prepare("UPDATE live_cycles SET ended_at=?, end_reason='progress-reset' WHERE profile_code=? AND ended_at IS NULL").run(now,profile);
  db.prepare('INSERT OR IGNORE INTO live_discarded_observations SELECT observation_id,profile_code,? FROM selection_attempts WHERE profile_code=? AND result IS NULL').run(now,profile);
  db.prepare('DELETE FROM queue_items WHERE profile_code=?').run(profile);
  chains.delete(profile); retryAfter.delete(profile);
  if (filling.has(profile)) retryRequested.add(profile);
}
