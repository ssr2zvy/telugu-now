import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import Database from 'better-sqlite3';
import {Hono} from 'hono';
import {Readable} from 'node:stream';

test('worker resumes after upload failure, publishes derived catalog and activates without restart',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'grammar-worker-'));const corpus=path.join(dir,'corpus.sqlite');
 const c=new Database(corpus);c.exec(`CREATE TABLE sources(source_id TEXT,display_name TEXT,provider TEXT,license TEXT,upstream_url TEXT,catalog_version INTEGER,accepted_rows INTEGER,rejected_rows INTEGER,complexity_metric TEXT,status TEXT);
 INSERT INTO sources VALUES('fleurs-te','Fleurs','test','test',NULL,1,1,0,'grapheme-count','ready');
 CREATE TABLE source_rows(source_id TEXT,source_key TEXT,text TEXT,grapheme_count INTEGER,audio_sha256 TEXT,audio_object_key TEXT,audio_mime_type TEXT,duration_seconds REAL);
 INSERT INTO source_rows VALUES('fleurs-te','one','నేను చేశాను.',8,'','a.wav','audio/wav',1);`);c.close();
 const before=fs.readFileSync(corpus);
 Object.assign(process.env,{NODE_ENV:'test',DATA_DIRECTORY:dir,DATABASE_PATH:path.join(dir,'users.sqlite'),CORPUS_DATABASE_PATH:corpus,CORPUS_AVAILABILITY_PATH:path.join(dir,'availability.sqlite'),AUDIO_VALIDATION_PATH:path.join(dir,'audio-validation.sqlite'),CORPUS_BACKEND:'tigris',BUCKET_NAME:'mock-only',PROFILE_CODES:'001,002',GRAMMAR_MIGRATION_ENABLED:'true',GRAMMAR_MIGRATION_TOKEN:'test-operator'});
 const {config}=await import('../server/src/config/config');const {availabilityIdentity}=await import('../server/src/services/corpus-availability');
 const avail=new Database(config.corpusAvailabilityPath);avail.exec(`CREATE TABLE metadata(generation TEXT,identity TEXT);CREATE TABLE source_complexity_members(source_id TEXT,source_key TEXT,grapheme_count INTEGER,class_index INTEGER);INSERT INTO source_complexity_members VALUES('fleurs-te','one',8,0);CREATE TABLE source_counts(source_id TEXT,row_count INTEGER);INSERT INTO source_counts VALUES('fleurs-te',1);CREATE TABLE complexity_counts(source_id TEXT,grapheme_count INTEGER,row_count INTEGER);INSERT INTO complexity_counts VALUES('fleurs-te',8,1);`);avail.prepare('INSERT INTO metadata VALUES(?,?)').run('mock',availabilityIdentity(config));avail.close();
 const {getCorpusObjectStore}=await import('../server/src/services/corpus-object-store');
 let fail=true,aborted=false;const remote=new Map<string,Buffer>();let part=Buffer.alloc(0);const touched:string[]=[];
 getCorpusObjectStore().client.send=(async(command:{constructor:{name:string};input:Record<string,unknown>})=>{
  const name=command.constructor.name,key=String(command.input.Key);touched.push(key);
  if(name==='CreateMultipartUploadCommand')return {UploadId:'mock'};
  if(name==='UploadPartCommand'){if(fail)throw new Error('simulated upload failure');part=Buffer.from(command.input.Body as Uint8Array);return {ETag:'part'};}
  if(name==='AbortMultipartUploadCommand'){aborted=true;return {};}
  if(name==='CompleteMultipartUploadCommand'){remote.set(key,part);return {};}
  if(name==='PutObjectCommand'){remote.set(key,Buffer.from(String(command.input.Body)));return {};}
  if(name==='GetObjectCommand')return {Body:Readable.from([remote.get(key)!])};
  throw new Error('Unexpected remote call '+name);
 }) as typeof getCorpusObjectStore extends (...args: never[])=>{client:{send:infer S}}?S:never;
 const migration=await import('../server/src/grammar/migration');const {db}=await import('../server/src/db/database');
 const {system}=await import('../server/src/grammar/service');const {grammarRoutes}=await import('../server/src/grammar/routes');const {bootstrapGrammar}=await import('../server/src/grammar/persistence');
 const app=new Hono();app.route('/api/profiles',grammarRoutes());
 assert.equal((await app.request('/api/profiles/001/grammar')).status,200);
 assert.equal((await app.request('/api/profiles/001/grammar/build',{method:'POST'})).status,403);
 const wait=async()=>{const end=Date.now()+30000;while(!['ready','failed'].includes(migration.job().phase??'')){if(Date.now()>end)throw new Error('worker timeout');await new Promise(r=>setTimeout(r,30));}};
 await migration.startMigration();await assert.rejects(migration.startMigration());await wait();assert.equal(migration.job().phase,'failed');assert.equal(aborted,true);assert.equal(system().active,0);
 fail=false;await migration.startMigration();await wait();assert.equal(migration.job().phase,'ready',migration.job().error);assert.ok(remote.has('corpus/grammar/latest.json'));
 assert.ok(touched.every(k=>k.startsWith('corpus/grammar/')));assert.deepEqual(fs.readFileSync(corpus),before,'canonical corpus never changes');
 const file=migration.job().file!;const built=new Database(file,{readonly:true});assert.equal((built.prepare('SELECT COUNT(*) AS n FROM observations').get() as {n:number}).n,1);assert.equal((built.prepare('SELECT COUNT(*) AS n FROM words').get() as {n:number}).n,2);built.close();
 for(const code of ['001','002'])db.prepare('INSERT INTO profiles(code,created_at,updated_at) VALUES(?,0,0)').run(code);
 const r=await app.request('/api/profiles/001/grammar/activate',{method:'POST',headers:{'x-grammar-operator-token':'test-operator'}});assert.equal(r.status,200,await r.text());assert.equal(system().active,1);
 // Permanent loader works after disabling the temporary worker and restores missing local bytes.
 process.env.GRAMMAR_MIGRATION_ENABLED='false';fs.unlinkSync(file);await bootstrapGrammar();assert.ok(fs.existsSync(file));assert.deepEqual(fs.readFileSync(corpus),before);
 assert.equal((await app.request('/api/profiles/001/grammar/build',{method:'POST',headers:{'x-grammar-operator-token':'test-operator'}})).status,409);
 db.close();fs.rmSync(dir,{recursive:true,force:true});
});
