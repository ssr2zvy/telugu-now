/** Focused integration fixture. Node 24+, no npm dependencies.
 * Runs the actual add-on backend modules with real SQLite (node:sqlite).
 * Adapts better-sqlite3's synchronous API; unrelated source/audio services are stubs.
 * Does not replace npm run typecheck / npm test in the application environment.
 * Run from upa: node --experimental-vm-modules tests/parsing-diagnostics.fixture.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { stripTypeScriptTypes } from 'node:module';
import { SourceTextModule, SyntheticModule } from 'node:vm';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'core-diagnostic-'));
const opened=[];
class Database {
  constructor(file,options={}){this.raw=new DatabaseSync(file,{readOnly:options.readonly??false});opened.push(this);}
  exec(sql){return this.raw.exec(sql);}
  prepare(sql){const stmt=this.raw.prepare(sql);return {
    get:(...a)=>stmt.get(...a),all:(...a)=>stmt.all(...a),iterate:(...a)=>stmt.iterate(...a),
    run:(...a)=>{const r=stmt.run(...a);return {...r,changes:Number(r.changes)};},
  };}
  transaction(fn){const run=(...args)=>{this.exec('SAVEPOINT fixture');try{const r=fn(...args);this.exec('RELEASE fixture');return r;}catch(e){this.exec('ROLLBACK TO fixture');this.exec('RELEASE fixture');throw e;}};run.immediate=run;return run;}
  close(){if(this.raw.isOpen)this.raw.close();}
}
const config={dataDirectory:temp,databasePath:path.join(temp,'users.sqlite'),corpusDatabasePath:path.join(temp,'corpus.sqlite'),corpusAvailabilityPath:path.join(temp,'availability.sqlite'),audioValidationPath:path.join(temp,'validation.sqlite')};
const db=new Database(config.databasePath);
db.exec(`PRAGMA journal_mode=WAL;PRAGMA foreign_keys=ON;
CREATE TABLE profiles(code TEXT PRIMARY KEY,current_position INTEGER);
INSERT INTO profiles VALUES('A',0),('B',0),('C',0),('D',0);
CREATE TABLE observations(id TEXT PRIMARY KEY,source_id TEXT,source_key TEXT,status TEXT,selected_at INTEGER,
 group_id TEXT,group_kind TEXT,group_size INTEGER,group_position INTEGER,text TEXT,prepared_at INTEGER,
 preparation_error TEXT,preparation_retry_at INTEGER,preparation_attempts INTEGER DEFAULT 0);
CREATE TABLE queue_items(profile_code TEXT,queue_position INTEGER,observation_id TEXT UNIQUE REFERENCES observations(id) ON DELETE CASCADE,PRIMARY KEY(profile_code,queue_position));
CREATE TABLE observation_acquisitions(observation_id TEXT PRIMARY KEY REFERENCES observations(id) ON DELETE CASCADE,
 profile_code TEXT,acquisition_number INTEGER,trigger_kind TEXT,trigger_observation_id TEXT,trigger_history_position INTEGER,
 triggered_at INTEGER,waiting_ahead_at_trigger INTEGER,preparation_in_flight_at_trigger INTEGER,selection_snapshot_json TEXT,
 observation_kind TEXT,question_requested_pool TEXT,question_mode TEXT,question_keyboard TEXT);
CREATE TABLE history_entries(profile_code TEXT,history_position INTEGER,observation_id TEXT,presentation_state_json TEXT);
CREATE TABLE profile_blacklisted_sentences(profile_code TEXT,text TEXT);
`);
const corpus=new Database(config.corpusDatabasePath);corpus.exec('CREATE TABLE source_rows(source_id TEXT,source_key TEXT,text TEXT)');
const avail=new Database(config.corpusAvailabilityPath);avail.exec('CREATE TABLE source_complexity_members(source_id TEXT,source_key TEXT)');
const validation=new Database(config.audioValidationPath);validation.exec('CREATE TABLE audio_validation(storage_identity TEXT,object_key TEXT,status TEXT)');
const assets=path.join(temp,'assets');fs.mkdirSync(assets);process.env.PARSING_ASSETS_DIRECTORY=assets;
const nodes={};
for(let core=1;core<=3;core++)for(const [id,kind] of [['V','vocabulary'],['M','chain'],['ZERO','vocabulary']]){
 const tid=`${core}${id}`;nodes[tid]={id:tid,core,kind,label:tid,forms:kind==='vocabulary'?[tid]:undefined,chain:kind==='chain'?['mod_test']:undefined,neighbors:id==='ZERO'?[]:[`${core}${id==='V'?'M':'V'}`]};
}
fs.writeFileSync(path.join(assets,'graph.json'),JSON.stringify({nodes,edges:[]}));
const builtins=new Map();const modules=new Map();
function synthetic(name,exports){const m=new SyntheticModule(Object.keys(exports),function(){for(const [k,v]of Object.entries(exports))this.setExport(k,v);},{identifier:name});return m;}
const stubDefs={
 'server/src/db/database.ts':{db},'server/src/config/config.ts':{config},
 'server/src/grammar/question-type.ts':{chooseQuestionType:()=>({mode:'text-given',textGiven:2/3,audioGiven:1/3})},
 'server/src/services/audio-validation-store.ts':{audioStorageIdentity:()=> 'fixture',audioValidationStore:{revision:1}},
 'server/src/grammar/service.ts':{openBatch:()=>undefined,grammarSelect:()=>{throw Error('unused');},recordSelection:()=>{},attempt:()=>undefined},
 'server/src/parsing/random.ts':{uniformAudioRow:()=>{throw Error('unused');}},
 'server/src/services/selection-engine.ts':{selectionEngine:{}},
 'server/src/services/selection-settings-service.ts':{getProfileSelectionSettings:()=>({})},
 'server/src/services/logger.ts':{logger:{info:()=>{},warn:()=>{},error:()=>{}}},
};
async function load(filename){
 if(modules.has(filename))return modules.get(filename);
 const relative=path.relative(root,filename).split(path.sep).join('/');
 const m=stubDefs[relative]?synthetic(filename,stubDefs[relative]):new SourceTextModule(stripTypeScriptTypes(fs.readFileSync(filename,'utf8'),{mode:'transform'}),{identifier:filename});
 modules.set(filename,m);return m;
}
async function link(spec,parent){
 if(spec==='better-sqlite3'){if(!builtins.has(spec))builtins.set(spec,synthetic(spec,{default:Database}));return builtins.get(spec);}
 if(spec.startsWith('node:')){if(!builtins.has(spec))builtins.set(spec,synthetic(spec,await import(spec)));return builtins.get(spec);}
 let file=path.resolve(path.dirname(parent.identifier),spec);if(!file.endsWith('.ts'))file+='.ts';return load(file);
}
async function importActual(relative){const m=await load(path.join(root,relative));if(m.status==='unlinked')await m.link(link);if(m.status==='linked')await m.evaluate();return m.namespace;}
try {
 const state=await importActual('server/src/parsing/state.ts');
 const catFile=path.join(temp,'parsing.sqlite'),cat=new Database(catFile);
 cat.exec(`CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT);CREATE TABLE rows(id INTEGER PRIMARY KEY,source_id TEXT,source_key TEXT,text_hash TEXT,length INTEGER,audio_key TEXT);
 CREATE TABLE members(target_id TEXT,row_id INTEGER,core INTEGER,length INTEGER,PRIMARY KEY(target_id,row_id));CREATE INDEX shortest_member ON members(target_id,length,row_id);
 CREATE TABLE matches(row_id INTEGER,target_id TEXT,start_cp INTEGER,end_cp INTEGER,token_index INTEGER,surface TEXT,reason TEXT);
 CREATE TABLE words(surface TEXT,analysis_json TEXT);`);
 const texts=['నేను','నువ్వు','మనం','మీరు','ఇది','అది','ఇవి','అవి','ఎవరు','ఎక్కడ','ఇక్కడ','అక్కడ','నేను'];
 for(let i=0;i<texts.length;i++){
  corpus.prepare('INSERT INTO source_rows VALUES(?,?,?)').run('source',String(i),texts[i]);
  avail.prepare('INSERT INTO source_complexity_members VALUES(?,?)').run('source',String(i));
  cat.prepare('INSERT INTO rows VALUES(?,?,?,?,?,?)').run(i+1,'source',String(i),state.textHash(texts[i]),1,`audio/${i}`);
  for(let core=1;core<=3;core++){
   const target=`${core}${i%2?'M':'V'}`;
   cat.prepare('INSERT INTO members VALUES(?,?,?,?)').run(target,i+1,core,1);
   cat.prepare('INSERT INTO matches VALUES(?,?,?,?,?,?,?)').run(i+1,target,0,Array.from(texts[i]).length,0,texts[i],'fixture');
  }
 }
 for(const [k,v]of Object.entries({complete:true,identity:{schema:1,inventoryId:'fixture',parserHash:state.parserFingerprint()},stats:{}}))cat.prepare('INSERT INTO metadata VALUES(?,?)').run(k,JSON.stringify(v));
 cat.close();corpus.close();avail.close();validation.close();
 const catalog=await importActual('server/src/parsing/catalog.ts');
 db.prepare('UPDATE parsing_system SET catalog_path=?,inventory_id=?,corpus_stamp=? WHERE id=1').run(catFile,'fixture',catalog.corpusStamp());
 const queue=await importActual('server/src/services/queue-service.ts');
 const diagnostic=await importActual('server/src/parsing/diagnostics.ts');
 const audit=await importActual('server/src/parsing/audit.ts');
 const queued=profile=>db.prepare('SELECT a.* FROM queue_items q JOIN selection_attempts a ON a.observation_id=q.observation_id WHERE q.profile_code=? ORDER BY q.queue_position').all(profile);
 const events=(profile,type)=>db.prepare('SELECT * FROM core_diagnostic_events WHERE profile_code=? AND type=? ORDER BY seq').all(profile,type);
 let historyPosition=0;
 const answer=(profile,id,result)=>{
  const pos=historyPosition++;
  db.prepare('INSERT INTO history_entries VALUES(?,?,?,?)').run(profile,pos,id,JSON.stringify({questionPhase:'observation'}));
  db.prepare('UPDATE profiles SET current_position=? WHERE code=?').run(pos,profile);
  db.prepare('DELETE FROM queue_items WHERE observation_id=?').run(id);
  state.markDisplayed(profile,id);state.markDisplayed(profile,id);
  state.evaluate(profile,id,result);state.evaluate(profile,id,result);
 };
 const oldRandom=Math.random;Math.random=()=>0;
 try{
  // Full denominator and duplicate-corpus rows versus distinct sentences.
  let d=diagnostic.parsingDiagnostics('A');
  assert.equal(d.levels[0].total,3);assert.equal(d.levels[0].withoutExamples,1);
  assert.equal(d.targets.find(t=>t.id==='1V').corpusRows,7);assert.equal(d.targets.find(t=>t.id==='1V').corpusTexts,6);
  assert.equal(d.targets.find(t=>t.id==='1ZERO').corpusTexts,0);
  state.switchMode('A','core');queue.ensureLaunchQueue('A');let rows=queued('A');assert.equal(rows.length,10);
  assert.equal(events('A','walk-started').length,1);assert.equal(events('A','walk-closed').length,1);
  assert.equal(JSON.parse(events('A','walk-closed')[0].details_json).reason,'batch-full');
  const selected=JSON.parse(events('A','observation-selected')[1].details_json);
  assert.equal(selected.fromTargetId,'1V');assert.ok(selected.decision.available.includes('1M'));assert.ok(selected.text);
  db.prepare("UPDATE observations SET status='ready',text='నేను',prepared_at=100 WHERE id=?").run(rows[0].observation_id);
  assert.equal(events('A','observation-prepared').length,1);
  answer('A',rows[0].observation_id,true);d=diagnostic.parsingDiagnostics('A');
  assert.equal(d.levels[0].mastered,0);assert.equal(d.levels[0].pendingAnswers,1);
  assert.equal(events('A','observation-displayed').length,1);assert.equal(events('A','answer-recorded').length,1);
  for(let i=1;i<rows.length;i++)answer('A',rows[i].observation_id,i!==9);
  d=diagnostic.parsingDiagnostics('A');assert.equal(d.levels[0].mastered,1);assert.equal(d.levels[0].percent,100/3);
  assert.equal(d.levels[0].vocabulary.percent,50);assert.equal(d.levels[0].modifiers.percent,0);
  assert.equal(d.levels[0].pendingAnswers,0);assert.equal(events('A','progress-applied').length,10);
  const changes=events('A','progress-applied').map(e=>JSON.parse(e.details_json));assert.equal(changes.at(-1).after,0);
  state.applyFinishedBatch(rows[0].batch_id);assert.equal(events('A','batch-applied').length,1);
  queue.ensureLaunchQueue('A');rows=queued('A');assert.equal(rows.length,2);
  assert.equal(JSON.parse(events('A','walk-started').at(-1).details_json).reason,'batch-full');
  assert.equal(JSON.parse(events('A','walk-closed').at(-1).details_json).reason,'no-unused-neighbor');
  answer('A',rows[0].observation_id,true);answer('A',rows[1].observation_id,false);
  assert.equal(diagnostic.parsingDiagnostics('A').levels[0].mastered,0,'False can reset an already mastered neighbor');
  assert.throws(()=>queue.ensureLaunchQueue('A'),/blocked/);assert.throws(()=>queue.ensureLaunchQueue('A'),/blocked/);
  assert.equal(events('A','walk-blocked').length,1,'blocked reason survives failed selection without polling spam');
  // A replacement's deleted reservation remains in the audit; replacing a slot
  // is not a new movement or a failed answer.
  state.switchMode('B','core');queue.ensureLaunchQueue('B');rows=queued('B');const replaced=rows[0].observation_id;
  queue.replaceRejectedQueuedObservation(replaced);
  assert.equal(events('B','observation-discarded').length,1);assert.equal(events('B','observation-replaced').length,1);
  assert.equal(events('B','walk-started').length,1);assert.equal(events('B','answer-recorded').length,0);
  assert.equal(diagnostic.parsingDiagnostics('B').targets.find(t=>t.id==='1V').selected,6);
  // Unavailable media truncates suffix and records the cause, never False credit.
  db.prepare("INSERT INTO profile_blacklisted_sentences VALUES('B',?)").run('నేను');
  db.prepare("INSERT INTO profile_blacklisted_sentences VALUES('B',?)").run('ఇక్కడ');
  queue.replaceRejectedQueuedObservation(queued('B')[0].observation_id,'blacklisted-text');
  assert.equal(events('B','walk-truncated').length,1);assert.equal(JSON.parse(events('B','walk-truncated')[0].details_json).rejectionReason,'blacklisted-text');assert.equal(events('B','observation-discarded').length,11);
  assert.equal(events('B','answer-recorded').length,0);
  // Failed writes roll back their audit records with their state change.
  const n=events('A','test-rollback').length;
  assert.throws(()=>db.transaction(()=>{audit.coreEvent('A','test-rollback');throw Error('rollback');})(),/rollback/);
  assert.equal(events('A','test-rollback').length,n);
  // All-core, profile-scoped streaming export and persistent history.
  const ex=diagnostic.diagnosticExport('A');let content='';for await(const chunk of ex.chunks)content+=chunk;const exported=JSON.parse(content);
  assert.equal(exported.summary.levels.length,3);assert.equal(exported.inventory.nodes['1ZERO'].kind,'vocabulary');
  assert.equal(exported.observations.length,12);assert.equal(exported.events.length,db.prepare("SELECT COUNT(*) AS n FROM core_diagnostic_events WHERE profile_code='A'").get().n);
  assert.ok(exported.events.every(e=>e.profile_code==='A'));assert.ok(exported.events.some(e=>e.type==='walk-blocked'));
  assert.ok(exported.batches.every(b=>typeof b.snapshot==='object'));
  const page=diagnostic.diagnosticEvents('A',1,Number.MAX_SAFE_INTEGER,3);assert.equal(page.length,3);
  assert.ok(diagnostic.diagnosticEvents('A',1,page.at(-1).seq,3).every(e=>e.seq<page.at(-1).seq));
  const frozen=diagnostic.diagnosticExport('A');
  audit.coreEvent('A','after-export-snapshot');
  let frozenText='';for await(const chunk of frozen.chunks)frozenText+=chunk;
  assert.ok(!JSON.parse(frozenText).events.some(e=>e.type==='after-export-snapshot'),'export holds one consistent snapshot');
  const cancelled=diagnostic.diagnosticExport('A');await cancelled.chunks.next();await cancelled.chunks.return();cancelled.close();
  const reopened=new Database(config.databasePath);assert.ok(reopened.prepare("SELECT COUNT(*) AS n FROM core_diagnostic_events WHERE profile_code='A'").get().n>0);reopened.close();
  audit.initializeCoreDiagnostics();assert.equal(events('A','legacy-observation').length,0,'restart must not manufacture legacy events');
  // Core advancement still requires every target, zero-example requirement included.
  state.switchMode('C','core');queue.ensureLaunchQueue('C');rows=queued('C');
  db.prepare("INSERT INTO core_streaks VALUES('C','fixture',1,'1ZERO',3)").run();
  for(const r of rows)answer('C',r.observation_id,true);
  assert.equal(state.coreProgress('C').core,2);assert.equal(events('C','core-advanced').length,1);
  queue.ensureLaunchQueue('C');assert.equal(JSON.parse(events('C','walk-started').at(-1).details_json).reason,'core-advanced');
  assert.equal(diagnostic.parsingDiagnostics('D').levels[0].mastered,0,'profile isolation');
  // Catalogue failure is unknown, never fake zero availability.
  db.prepare('UPDATE parsing_system SET corpus_stamp=? WHERE id=1').run('changed');d=diagnostic.parsingDiagnostics('A');
  assert.ok(d.catalogError);assert.equal(d.targets[0].corpusTexts,null);assert.equal(d.levels[0].withoutExamples,null);
  console.log('PASS: real-SQLite fixtures for percentages, full denominators, distinct counts, pending answers, idempotence, False resets, walk reasons, replacement/deletion preservation, rollback, profile isolation, export, pagination, persistence and core advancement.');
 }finally{Math.random=oldRandom;}
}finally{
 for(const d of opened.reverse())d.close();fs.rmSync(temp,{recursive:true,force:true});
}
