import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import Database from 'better-sqlite3';

test('global mode preserves ten frozen selections, ordered evaluations and profile isolation',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'grammar-integration-'));const corpus=path.join(dir,'corpus.sqlite');
 const c=new Database(corpus);c.exec(`CREATE TABLE sources(source_id TEXT,display_name TEXT,provider TEXT,license TEXT,upstream_url TEXT,catalog_version INTEGER,accepted_rows INTEGER,rejected_rows INTEGER,complexity_metric TEXT,status TEXT);
 INSERT INTO sources VALUES('fleurs-te','Fleurs','test','test',NULL,1,1,0,'grapheme-count','ready');
 CREATE TABLE source_rows(source_id TEXT,source_key TEXT,text TEXT,grapheme_count INTEGER,audio_sha256 TEXT,audio_object_key TEXT,audio_mime_type TEXT,duration_seconds REAL);
 INSERT INTO source_rows VALUES('fleurs-te','one','నేను',2,'','a.wav','audio/wav',1);`);c.close();
 const avail=new Database(path.join(dir,'availability.sqlite'));avail.exec(`CREATE TABLE metadata(generation TEXT,identity TEXT);CREATE TABLE source_complexity_members(source_id TEXT,source_key TEXT,grapheme_count INTEGER,class_index INTEGER);INSERT INTO source_complexity_members VALUES('fleurs-te','one',2,0);CREATE TABLE source_counts(source_id TEXT,row_count INTEGER);INSERT INTO source_counts VALUES('fleurs-te',1);CREATE TABLE complexity_counts(source_id TEXT,grapheme_count INTEGER,row_count INTEGER);INSERT INTO complexity_counts VALUES('fleurs-te',2,1);`);
 Object.assign(process.env,{NODE_ENV:'test',DATA_DIRECTORY:dir,DATABASE_PATH:path.join(dir,'users.sqlite'),CORPUS_DATABASE_PATH:corpus,CORPUS_AVAILABILITY_PATH:path.join(dir,'availability.sqlite'),AUDIO_VALIDATION_PATH:path.join(dir,'audio-validation.sqlite'),CORPUS_BACKEND:'local',PROFILE_CODES:'001,002'});
 const {availabilityIdentity}=await import('../server/src/services/corpus-availability');const {config}=await import('../server/src/config/config');avail.prepare('INSERT INTO metadata VALUES(?,?)').run('test',availabilityIdentity(config));avail.close();
 const file=path.join(dir,'grammar.sqlite'),g=new Database(file);g.exec(`CREATE TABLE metadata(key TEXT,value TEXT);INSERT INTO metadata VALUES('complete','true');INSERT INTO metadata VALUES('identity','{"inventory_id":"test"}');CREATE TABLE targets(target_id TEXT,level INTEGER,chain_json TEXT,base_id TEXT,nesting TEXT);INSERT INTO targets VALUES('BASE',1,'[]','base','linear');CREATE TABLE observations(id INTEGER,source_id TEXT,source_key TEXT,length INTEGER,audio_key TEXT);INSERT INTO observations VALUES(1,'fleurs-te','one',1,'a.wav');CREATE TABLE members(target_id TEXT,observation_id INTEGER,length INTEGER);INSERT INTO members VALUES('BASE',1,1);CREATE TABLE occurrences(observation_id INTEGER,target_id TEXT,word TEXT,token_index INTEGER,start_cp INTEGER,end_cp INTEGER,gi INTEGER,lexical_id TEXT);INSERT INTO occurrences VALUES(1,'BASE','నేను',0,0,4,1,'lex');CREATE TABLE vocabulary_occurrences(observation_id INTEGER,word TEXT,token_index INTEGER);CREATE TABLE vocabulary(word TEXT,rank INTEGER,frequency INTEGER,probability REAL);`);g.close();
 const {db}=await import('../server/src/db/database');const grammar=await import('../server/src/grammar/service');
 db.prepare('UPDATE grammar_system SET active=1,catalog_path=?,inventory_id=? WHERE id=1').run(file,'test');
 for(const code of ['001','002'])db.prepare('INSERT INTO profiles(code,created_at,updated_at) VALUES(?,0,0)').run(code);
 const queue=await import('../server/src/services/queue-service');queue.ensureLaunchQueue('001');
 const rows=db.prepare("SELECT g.*,a.selection_snapshot_json FROM grammar_attempts g JOIN observation_acquisitions a ON a.observation_id=g.observation_id ORDER BY slot").all() as {observation_id:string;selection_snapshot_json:string}[];
 assert.equal(rows.length,10);assert.equal(queue.ensureLaunchQueue('001'),false);assert.equal(queue.appendConsumptionReplacement('001','unused',0,0),'');
 assert.ok(rows.every(r=>JSON.parse(r.selection_snapshot_json).position===0));
 assert.equal((db.prepare("SELECT COUNT(*) AS n FROM observation_acquisitions WHERE observation_kind='question' AND question_requested_pool IS NULL").get() as {n:number}).n,10);
 for(let i=0;i<10;i++){
  const r=rows[i]!;db.prepare('INSERT INTO history_entries(profile_code,history_position,observation_id,presentation_state_json,absolute_started_at) VALUES(?,?,?, ?,0)').run('001',i,r.observation_id,JSON.stringify({questionPhase:'observation'}));db.prepare("UPDATE profiles SET current_position=? WHERE code='001'").run(i);db.prepare('DELETE FROM queue_items WHERE observation_id=?').run(r.observation_id);
  grammar.evaluate('001',r.observation_id,i!==8);grammar.evaluate('001',r.observation_id,i!==8);
  assert.throws(()=>grammar.evaluate('001',r.observation_id,i===8));
  if(i<9)assert.equal(grammar.progress('001').position,0,'batch does not update early');
 }
 assert.equal(grammar.progress('001').completed,true);assert.equal(grammar.progress('001').streaks[0]![0],1,'ordered false then true, even after completion');
 assert.equal(grammar.openBatch('001'),undefined);assert.equal(queue.ensureLaunchQueue('001'),true);assert.equal(queue.getQueueCount('001'),10);
 queue.ensureLaunchQueue('002');assert.equal(queue.getQueueCount('002'),10);assert.equal(grammar.progress('002').position,0);
 assert.throws(()=>grammar.evaluate('002',rows[0]!.observation_id,true));
 db.prepare("INSERT INTO profile_blacklisted_sentences(profile_code,text,created_at) VALUES('001','నేను',0)").run();
 assert.throws(()=>grammar.getCatalog().assertUsable('001'),/GRAMMAR_TARGET_UNAVAILABLE/);
 grammar.getCatalog().assertUsable('002');
 db.prepare("DELETE FROM profile_blacklisted_sentences WHERE profile_code='001'").run();
 grammar.getCatalog().assertUsable('001');
 grammar.getCatalog().close();db.close();fs.rmSync(dir,{recursive:true,force:true});
});
