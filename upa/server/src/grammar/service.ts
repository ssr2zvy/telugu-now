import { randomUUID } from 'node:crypto';
import { db } from '../db/database';
import { GrammarCatalog, type GrammarChoice } from './store';
import { initialProgress, update, type Progress } from './model';

db.exec(`
CREATE TABLE IF NOT EXISTS grammar_system(id INTEGER PRIMARY KEY CHECK(id=1),active INTEGER NOT NULL DEFAULT 0,catalog_path TEXT,inventory_id TEXT,catalog_sha TEXT,corpus_stamp TEXT,job_json TEXT NOT NULL DEFAULT '{}');
INSERT OR IGNORE INTO grammar_system(id) VALUES(1);
CREATE TABLE IF NOT EXISTS grammar_progress(profile_code TEXT PRIMARY KEY,inventory_id TEXT NOT NULL,state_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS grammar_batches(id TEXT PRIMARY KEY,profile_code TEXT NOT NULL,state_json TEXT NOT NULL,applied INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS grammar_attempts(observation_id TEXT PRIMARY KEY,batch_id TEXT NOT NULL REFERENCES grammar_batches(id),slot INTEGER NOT NULL,target_id TEXT NOT NULL,category INTEGER NOT NULL,target_index INTEGER NOT NULL,result INTEGER CHECK(result IN(0,1)),answered_at INTEGER,update_json TEXT,UNIQUE(batch_id,slot));
`);
export interface System {active:number;catalog_path:string|null;inventory_id:string|null;catalog_sha:string|null;corpus_stamp:string|null;job_json:string}
export const system=()=>db.prepare('SELECT * FROM grammar_system WHERE id=1').get() as System;
let catalog:GrammarCatalog|undefined;
export const grammarActive=()=>system().active===1;
export function getCatalog(){const s=system();if(!s.catalog_path)throw new Error('Grammar catalog missing');if(!catalog||catalog.filename!==s.catalog_path){catalog?.close();catalog=new GrammarCatalog(s.catalog_path);}return catalog;}
export function progress(profile:string):Progress {
  const cat=getCatalog();const row=db.prepare('SELECT inventory_id,state_json FROM grammar_progress WHERE profile_code=?').get(profile) as {inventory_id:string;state_json:string}|undefined;
  if(row){if(row.inventory_id!==cat.identity.inventory_id)throw new Error('Grammar inventory migration required');return JSON.parse(row.state_json);}
  const state=initialProgress(cat.sizes);db.prepare('INSERT INTO grammar_progress VALUES(?,?,?)').run(profile,cat.identity.inventory_id,JSON.stringify(state));return state;
}
export function openBatch(profile:string):{id:string;state_json:string}|undefined {
  return db.prepare('SELECT id,state_json FROM grammar_batches WHERE profile_code=? AND applied=0 ORDER BY rowid DESC LIMIT 1').get(profile) as {id:string;state_json:string}|undefined;
}
export function newBatch(profile:string):string {
  if(openBatch(profile))throw new Error('Previous grammar batch unanswered');
  getCatalog().assertUsable(profile);
  const id=randomUUID();db.prepare('INSERT INTO grammar_batches VALUES(?,?,?,0)').run(id,profile,JSON.stringify(progress(profile)));return id;
}
export function grammarSelect(profile:string,batch:string,requiredTarget?:string):GrammarChoice {
  const row=db.prepare('SELECT state_json FROM grammar_batches WHERE id=? AND profile_code=?').get(batch,profile) as {state_json:string};
  return getCatalog().choose(profile,JSON.parse(row.state_json),Math.random,requiredTarget);
}
export function recordSelection(observation:string,batch:string,slot:number,selection:GrammarChoice){
  db.prepare('INSERT INTO grammar_attempts(observation_id,batch_id,slot,target_id,category,target_index) VALUES(?,?,?,?,?,?)').run(observation,batch,slot,selection.targetId,selection.category,selection.targetIndex);
}
export function attempt(observation:string,profile:string){return db.prepare(`SELECT g.*,b.profile_code FROM grammar_attempts g JOIN grammar_batches b ON b.id=g.batch_id WHERE g.observation_id=? AND b.profile_code=?`).get(observation,profile) as {observation_id:string;batch_id:string;slot:number;target_id:string;result:number|null}|undefined;}
export function evaluate(profile:string,observation:string,result:boolean) {
  return db.transaction(()=>{
    const a=attempt(observation,profile);if(!a)throw new Error('Grammar question missing');
    // A retried identical request is idempotent even after the user has moved on.
    if(a.result!==null){if(a.result!==Number(result))throw new Error('Evaluation is final');return;}
    const visible=db.prepare(`SELECT h.presentation_state_json FROM profiles p JOIN history_entries h ON h.profile_code=p.code AND h.history_position=p.current_position WHERE p.code=? AND h.observation_id=?`).get(profile,observation) as {presentation_state_json:string}|undefined;
    if(!visible||JSON.parse(visible.presentation_state_json).questionPhase!=='observation')throw new Error('Open the evaluation page first');
    db.prepare('UPDATE grammar_attempts SET result=?,answered_at=? WHERE observation_id=? AND result IS NULL').run(Number(result),Date.now(),observation);
    const rows=db.prepare('SELECT * FROM grammar_attempts WHERE batch_id=? ORDER BY slot').all(a.batch_id) as {observation_id:string;category:number;target_index:number;result:number|null}[];
    if(rows.length===10&&rows.every(r=>r.result!==null)){
      const batch=db.prepare('SELECT state_json,applied FROM grammar_batches WHERE id=?').get(a.batch_id) as {state_json:string;applied:number};
      if(batch.applied)return;
      const state:Progress=JSON.parse(batch.state_json),sizes=getCatalog().sizes;
      for(const r of rows){const event=update(sizes,state,r.category,r.target_index,r.result===1);db.prepare('UPDATE grammar_attempts SET update_json=? WHERE observation_id=?').run(JSON.stringify(event),r.observation_id);}
      db.prepare('UPDATE grammar_progress SET state_json=? WHERE profile_code=?').run(JSON.stringify(state),profile);
      db.prepare('UPDATE grammar_batches SET applied=1 WHERE id=?').run(a.batch_id);
    }
  }).immediate();
}
