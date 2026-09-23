import { randomUUID } from 'node:crypto';
import { db } from '../db/database';
import { coreEvent } from '../parsing/audit';
import { initializeMode, coreProgress, graph, inventoryId, questionChoice, recordAttempt, attempt, applyFinishedBatch } from '../parsing/state';
import { findWord, type WordRow } from '../parsing/live-worker';
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
db.prepare("UPDATE live_cycles SET ended_at=?,end_reason='process-restarted' WHERE ended_at IS NULL").run(Date.now());
db.prepare("UPDATE live_searches SET ended_at=?,outcome='process-restarted' WHERE ended_at IS NULL").run(Date.now());
interface Chain {id:string;core:number;visited:Set<string>;exhausted:Set<string>;current:string|null}
const chains=new Map<string,Chain>();
const filling=new Set<string>();
const retryAfter=new Map<string,number>();
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
      const pendingTargets=new Set((db.prepare("SELECT a.target_id FROM selection_attempts a JOIN core_batches b ON b.id=a.batch_id WHERE a.profile_code=? AND b.applied=0 AND a.result IS NULL AND a.mode='core' AND a.observation_id IN(SELECT observation_id FROM queue_items WHERE profile_code=? UNION SELECT observation_id FROM history_entries WHERE profile_code=?)").all(profile,profile,profile) as Array<{target_id:string}>).map(r=>r.target_id));
      if(targets.every(t=>pendingTargets.has(t.id))){
        liveSelection.set(profile,{phase:'awaiting-answers',target:null,checked:0,error:null});return;
      }
      chain??=newChain(profile,progress.core);
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
      db.prepare('INSERT INTO live_searches(id,cycle_id,target_id,started_at,from_target) VALUES(?,?,?,?,?)').run(searchId,chain.id,target.id,Date.now(),chain.current);
      let found;
      do{
        liveSelection.set(profile,{phase:'searching',target:target.id,checked:found?.checked??0,error:null});
        const blocked=(db.prepare('SELECT text FROM profile_blacklisted_sentences WHERE profile_code=?').all(profile) as Array<{text:string}>).map(r=>r.text);
        found=await findWord({target:target.id,searchId,storageIdentity:audioStorageIdentity(config),blocked});
        db.prepare('UPDATE live_searches SET checked=?,pattern_json=? WHERE id=?').run(found.checked,JSON.stringify(found.pattern),searchId);
        liveSelection.set(profile,{phase:'searching',target:target.id,checked:found.checked,error:null});
      }while(found.pending);
      db.prepare('UPDATE live_searches SET ended_at=?,outcome=?,word=? WHERE id=?').run(Date.now(),found.row?found.source:'exhausted',found.row?.word??null,searchId);
      const current=coreProgress(profile);
      if(current.core!==target.core||(current.streaks[target.id]??0)>=3)continue;
      if(found.row){reserve(profile,target.id,found.row,chain,found.source);
        void import('./preparation-service').then(({preparationService})=>preparationService.kick());
      }else chain.exhausted.add(target.id);
    }
    liveSelection.set(profile,{phase:'ready',target:null,checked:0,error:null});
  }catch(error){
    const message=error instanceof Error?error.message:String(error);
    closeChain(profile,'worker-error');
    db.prepare("UPDATE live_searches SET ended_at=?,outcome='worker-error' WHERE ended_at IS NULL AND cycle_id IN(SELECT id FROM live_cycles WHERE profile_code=?)").run(Date.now(),profile);
    liveSelection.set(profile,{phase:'failed',target:null,checked:0,error:message});retryAfter.set(profile,Date.now()+30000);
    logger.error('live_selection_failed',{error:message});
  }finally{filling.delete(profile);}
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
