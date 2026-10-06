import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
test('word limit replaces a seed, retries the previous connection, then ends an exhausted chain',{timeout:90000},async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'live-test-')),assets=path.join(dir,'assets');fs.mkdirSync(assets);
 const original=path.resolve('../data-transform/scripts/parse-core');
 fs.copyFileSync(path.join(original,'live.py'),path.join(assets,'live.py'));fs.symlinkSync(path.join(original,'parser'),path.join(assets,'parser'),'dir');
 const g=JSON.parse(fs.readFileSync(path.join(original,'graph.json'),'utf8'));
 const ids=['VOC:meaning_i','VOC:meaning_here','VOC:meaning_this','VOC:meaning_that','VOC:meaning_now'],words=['నేను','ఇక్కడ','ఇది','అది','ఇప్పుడు'];
 g.nodes=Object.fromEntries(ids.map((id,i)=>[id,{...g.nodes[id],core:1,neighbors:i===1?[ids[2],ids[3]]:[]}]));g.edges=[];
 fs.writeFileSync(path.join(assets,'graph.json'),JSON.stringify(g));
 // Exercise production queue routing with deterministic capped worker replies.
 // Python live-frequency tests separately exercise the actual 2,500-word cutoff.
 const workerFile=path.join(assets,'live.py');
 fs.writeFileSync(workerFile,fs.readFileSync(workerFile,'utf8').replace("        pattern = self.patterns[tid]", `        if tid in ${JSON.stringify(["VOC:meaning_i","VOC:meaning_this"])}:
            return dict(row=None,pending=False,source='new-parse',stopReason='word-limit',checked=2500,
                        returned=2500,examined=2500,parsed=0,matching=0,reused=0,matchedWords=0,
                        pattern=self.patterns[tid],stats=self.stats_summary())
        pattern = self.patterns[tid]`));
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
 const waitFor=async(fn:()=>boolean)=>{const end=Date.now()+45000;while(!fn()){const e=queue.liveSelection.get('001')?.error;if(e)throw new Error(e);if(Date.now()>end)throw new Error('Timeout '+JSON.stringify(queue.liveSelection.get('001')));await new Promise(r=>setTimeout(r,25));}};
 const random=Math.random;Math.random=()=>0.999999;
 try {
  queue.ensureLaunchQueue('001');await waitFor(()=>queue.getQueueCount('001')===3);
  const attempts=db.prepare('SELECT target_id,from_target,outcome,cycle_id FROM live_searches ORDER BY rowid').all() as Array<{target_id:string;from_target:string|null;outcome:string;cycle_id:string}>;
  assert.deepEqual(attempts.map(a=>a.target_id),[ids[0],ids[1],ids[2],ids[3],ids[0],ids[2],ids[4]]);
  assert.deepEqual(attempts.map(a=>a.outcome),['word-limit','new-parse','word-limit','new-parse','word-limit','word-limit','new-parse']);
  assert.equal(attempts[0]!.from_target,null,'first seed capped');
  assert.equal(attempts[1]!.from_target,null,'replacement is another random seed');
  assert.equal(attempts[2]!.from_target,ids[1],'connection capped');
  assert.equal(attempts[3]!.from_target,ids[1],'replacement uses previous successful object');
  assert.equal(attempts[3]!.cycle_id,attempts[1]!.cycle_id,'successful prefix is retained');
  assert.notEqual(attempts[4]!.cycle_id,attempts[3]!.cycle_id,'no connections starts another chain');
  const ended=db.prepare('SELECT end_reason,steps FROM live_cycles WHERE id=?').get(attempts[1]!.cycle_id) as {end_reason:string;steps:number};
  assert.deepEqual(ended,{end_reason:'eligible-connections-exhausted',steps:2});
  assert.equal(queue.liveSelection.get('001')?.phase,'ready');
  assert.equal(worker.workerPhase,'ready','capped attempts do not kill parser');
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM live_searches WHERE outcome='word-limit' AND (stage!='finished' OR search_succeeded!=1)").get() as {n:number}).n,0);
 } finally {
  Math.random=random;worker.stopWordWorker();await new Promise(r=>setTimeout(r,100));db.close();fs.rmSync(dir,{recursive:true,force:true});
 }
});
