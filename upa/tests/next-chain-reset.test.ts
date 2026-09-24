import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {wavFixture} from './helpers/audio-fixture';
import Database from 'better-sqlite3';
test('reset discards only the current chain, preserves the next chain and does not submit an answer',{timeout:20000},async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'live-test-')),assets=path.join(dir,'assets');fs.mkdirSync(assets);
 const original=path.resolve('../data-transform/scripts/parse-core');
 fs.copyFileSync(path.join(original,'live.py'),path.join(assets,'live.py'));fs.mkdirSync(path.join(assets,'parser'));
 fs.writeFileSync(path.join(assets,'parser','core_parser.py'),`import json
from pathlib import Path
class CoreParser:
 def __init__(self):
  self.index={};self._productive_cache={}
  self.graph=json.loads((Path(__file__).resolve().parents[1]/'graph.json').read_text())
 def analyze(self,word):
  return {'separation':'resolved_in_model','analyses':[], 'vocabulary_expression_matches':[{'id':n['id'][4:]} for n in self.graph['nodes'].values() if word in n.get('forms',[])]}
`);
 const g=JSON.parse(fs.readFileSync(path.join(original,'graph.json'),'utf8'));
 const ids=['VOC:meaning_i','VOC:meaning_here','VOC:meaning_this','VOC:meaning_that','VOC:meaning_now'],words=['నేను','ఇక్కడ','ఇది','అది','ఇప్పుడు'];
 g.nodes=Object.fromEntries(ids.map((id,i)=>[id,{...g.nodes[id],core:i<3?1:i===3?2:3,neighbors:i<3?ids.slice(0,3).filter(n=>n!==id):[]}]));g.edges=[];
 fs.writeFileSync(path.join(assets,'graph.json'),JSON.stringify(g));
 const corpus=path.join(dir,'corpus.sqlite'),availability=path.join(dir,'availability.sqlite'),frequency=path.join(dir,'frequency.sqlite');
 const c=new Database(corpus);c.exec(`CREATE TABLE sources(source_id TEXT,display_name TEXT,provider TEXT,license TEXT,upstream_url TEXT,catalog_version INTEGER,accepted_rows INTEGER,rejected_rows INTEGER,complexity_metric TEXT,status TEXT);
 CREATE TABLE source_rows(source_id TEXT,source_key TEXT,text TEXT,grapheme_count INTEGER,audio_sha256 TEXT,audio_object_key TEXT,audio_mime_type TEXT,duration_seconds REAL,PRIMARY KEY(source_id,source_key));`);
 for(const source of ['fleurs-te','shrutilipi-te','indicvoices-te'])c.prepare("INSERT INTO sources VALUES(?,?,'test','test',NULL,1,5,0,'grapheme-count','ready')").run(source,source);
 words.forEach((w,i)=>c.prepare("INSERT INTO source_rows VALUES('fleurs-te',?,?,1,'',?,'audio/wav',1)").run(String(i),w,`${i}.wav`));c.close();
 const a=new Database(availability);a.exec(`CREATE TABLE metadata(generation TEXT,identity TEXT);CREATE TABLE source_complexity_members(source_id TEXT,source_key TEXT,grapheme_count INTEGER,class_index INTEGER);
 CREATE TABLE source_counts(source_id TEXT,row_count INTEGER);CREATE TABLE complexity_counts(source_id TEXT,grapheme_count INTEGER,row_count INTEGER);
 INSERT INTO source_counts VALUES('fleurs-te',5);INSERT INTO complexity_counts VALUES('fleurs-te',1,5);`);
 words.forEach((_,i)=>a.prepare("INSERT INTO source_complexity_members VALUES('fleurs-te',?,1,?)").run(String(i),i));
 const f=new Database(frequency);f.exec(`CREATE TABLE metadata(identity TEXT,total_occurrences INTEGER);INSERT INTO metadata VALUES('{}',5);
 CREATE TABLE frequencies(normalized_word TEXT PRIMARY KEY,occurrence_count INTEGER) WITHOUT ROWID;
 CREATE TABLE occurrences(occurrence_index INTEGER PRIMARY KEY,source_id TEXT,source_key TEXT,token_ordinal INTEGER,start_offset INTEGER,end_offset INTEGER,original_token TEXT,normalized_word TEXT);`);
 words.forEach((w,i)=>{f.prepare('INSERT INTO frequencies VALUES(?,1)').run(w);f.prepare("INSERT INTO occurrences VALUES(?,'fleurs-te',?,0,0,?,?,?)").run(i,String(i),Array.from(w).length,w,w);});f.close();
 Object.assign(process.env,{NODE_ENV:'test',DATA_DIRECTORY:dir,DATABASE_PATH:path.join(dir,'users.sqlite'),CORPUS_DATABASE_PATH:corpus,CORPUS_AVAILABILITY_PATH:availability,FREQUENCY_DATABASE_PATH:frequency,AUDIO_VALIDATION_PATH:path.join(dir,'audio-validation.sqlite'),CORPUS_BACKEND:'local',PROFILE_CODES:'001',PARSING_ASSETS_DIRECTORY:assets});
 const {config}=await import('../server/src/config/config');const {availabilityIdentity}=await import('../server/src/services/corpus-availability');a.prepare('INSERT INTO metadata VALUES(?,?)').run('test',availabilityIdentity(config));a.close();
 const {db}=await import('../server/src/db/database');db.prepare("INSERT INTO profiles(code,created_at,updated_at) VALUES('001',0,0)").run();
 const queue=await import('../server/src/services/queue-service'),state=await import('../server/src/parsing/state'),worker=await import('../server/src/parsing/live-worker');
 const {preparationService}=await import('../server/src/services/preparation-service');preparationService.kick=()=>{};
 const settings=await import('../server/src/services/selection-settings-service');
 const waitFor=async(fn:()=>boolean)=>{const end=Date.now()+45000;while(!fn()){const e=queue.liveSelection.get('001')?.error;if(e)throw new Error(e);if(Date.now()>end)throw new Error('Timeout '+JSON.stringify(queue.liveSelection.get('001')));await new Promise(r=>setTimeout(r,25));}};
 try {
  const cached=new Database(frequency);cached.exec("ALTER TABLE frequencies ADD COLUMN parse_result TEXT; ALTER TABLE metadata ADD COLUMN parse_cache_version TEXT;");cached.prepare('UPDATE frequencies SET parse_result=? WHERE normalized_word=?').run(JSON.stringify({status:'parsed',targets:[ids[0]]}),words[0]);cached.close();
  assert.equal(worker.savedWordStats()?.parsed,1);assert.equal(worker.workerPhase,'idle');
  queue.ensureLaunchQueue('001');await waitFor(()=>queue.getQueueCount('001')===3);
  const selected=db.prepare("SELECT q.observation_id AS id,a.selection_snapshot_json AS snapshot FROM queue_items q JOIN observation_acquisitions a ON a.observation_id=q.observation_id ORDER BY queue_position").all() as Array<{id:string;snapshot:string}>;
  const [displayed,unused,next]=selected;assert.ok(displayed&&unused&&next);
  const oldCycle=JSON.parse(displayed.snapshot).cycleId;
  db.prepare("DELETE FROM queue_items WHERE observation_id=?").run(displayed.id);
  db.prepare("INSERT INTO history_entries(profile_code,history_position,observation_id,absolute_started_at,presentation_state_json) VALUES('001',0,?,0,'{\"questionPhase\":\"comparison\"}')").run(displayed.id);
  db.prepare("UPDATE profiles SET current_position=0 WHERE code='001'").run();
  db.prepare("INSERT INTO live_cycles(id,profile_code,core,started_at) VALUES('next-chain','001',1,1)").run();
  db.prepare('UPDATE observation_acquisitions SET selection_snapshot_json=? WHERE observation_id=?').run(JSON.stringify({...JSON.parse(next.snapshot),cycleId:'next-chain'}),next.id);
  db.prepare("UPDATE observations SET status='ready' WHERE id=?").run(next.id);
  preparationService.checkQueue=()=>{};
  const profiles=await import('../server/src/services/profile-service');
  const reset=profiles.resetQueue('001',false);
  assert.equal(reset.currentObservation?.id,next.id,'advance to the next already prepared chain');
  assert.equal(reset.currentObservation?.question?.phase,'question');
  assert.equal(db.prepare('SELECT 1 FROM queue_items WHERE observation_id=?').get(unused.id),undefined);
  assert.equal((db.prepare('SELECT end_reason FROM live_cycles WHERE id=?').get(oldCycle) as any).end_reason,'chain-discarded');
  assert.ok(queue.isDiscarded(displayed.id,'001'));assert.ok(queue.isDiscarded(unused.id,'001'));
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM selection_attempts WHERE result IS NOT NULL').get() as any).n,0);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM history_entries WHERE profile_code='001'").get() as any).n,2,'retain history');
  assert.throws(()=>state.evaluate('001',displayed.id,true),/discarded/);
  const comparison=profiles.navigateNext('001',false);
  assert.equal(comparison.currentObservation?.question?.phase,'comparison');assert.equal(comparison.canBack,true);assert.equal(comparison.canNext,true);
  assert.equal(profiles.navigateBack('001',false).currentObservation?.question?.phase,'question');
  profiles.navigateNext('001',false);
  const observation = profiles.navigateNext('001',false);
  assert.equal(observation.currentObservation?.question?.phase,'observation','comparison advances without prematurely submitting the answer');
  assert.equal(observation.currentObservation?.grammar?.result,null);
  assert.equal(observation.canNext,true,'allow the client to finalize its draft when leaving the observation');
  for(let poll=0;poll<3;poll++) assert.equal(profiles.getProfileState('001',false).currentObservation?.question?.phase,'observation','polling must not rewind an unanswered observation');
  assert.throws(()=>profiles.navigateNext('001',false),/Self-evaluate/,'server still prevents leaving without a saved evaluation');
  assert.equal(profiles.navigateBack('001',false).currentObservation?.question?.phase,'comparison');
  assert.equal(profiles.navigateNext('001',false).currentObservation?.question?.phase,'observation');
  state.evaluate('001',next.id,false);
  assert.equal(profiles.getProfileState('001',false).currentObservation?.grammar?.result,false,'off is a valid final answer');
  assert.equal(profiles.navigateBack('001',false).currentObservation?.question?.phase,'comparison');
  assert.equal(profiles.navigateNext('001',false).currentObservation?.question?.phase,'observation','already answered questions remain navigable');
  const {parsingDiagnostics}=await import('../server/src/parsing/diagnostics');
  const diagnostics=parsingDiagnostics('001');assert.ok(diagnostics.allTime);assert.ok(diagnostics.lastAttempt);assert.ok(diagnostics.cache?.validParses);
  // A reset with nothing ready stays pending, then automatically opens the first ready selection.
  db.prepare("UPDATE observations SET status='pending' WHERE id IN(SELECT observation_id FROM queue_items)").run();
  const waiting=profiles.resetQueue('001',false);
  assert.equal(waiting.currentObservation,null);
  await waitFor(()=>queue.getQueueCount('001')>0);
  const queued=db.prepare("SELECT observation_id AS id FROM queue_items ORDER BY queue_position LIMIT 1").get() as {id:string};
  db.prepare("UPDATE observations SET status='ready' WHERE id=?").run(queued.id);
  assert.equal(profiles.getProfileState('001',false).currentObservation?.id,queued.id);
  assert.equal(db.prepare("SELECT 1 FROM live_chain_resets WHERE profile_code='001'").get(),undefined);
 } finally {
  // Let any already requested batch finish before closing its DB.
  await new Promise(resolve=>setTimeout(resolve,300));worker.stopWordWorker();await new Promise(resolve=>setTimeout(resolve,50));db.close();fs.rmSync(dir,{recursive:true,force:true});
 }
});
