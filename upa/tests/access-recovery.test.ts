import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {Hono} from 'hono';
import {mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {accessGate,issueAccessSession,verifyAccessPassphrase} from '../server/src/access/gate';
import {accessCredentials} from '../server/src/access/credentials';
import {oneTimeRecovery} from '../server/src/access/recovery';
const old={hash:'scrypt-v1$'+'11'.repeat(16)+'$'+'22'.repeat(64),secret:'33'.repeat(32)};
const appFor=(db:Database.Database)=>{const a=new Hono();a.use('*',accessGate(db,{secure:true}));a.all('*',c=>c.json({protected:true}));return a;};
const submit=(app:Hono,password:string)=>app.request('https://app.test/access/setup',{method:'POST',headers:{Origin:'https://app.test','Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({password})});
test('forgotten password recovery replaces credentials once, preserves profiles, invalidates old sessions, and stays closed after restart',async()=>{
 const dir=mkdtempSync(path.join(os.tmpdir(),'access-recovery-'));const file=path.join(dir,'users.sqlite');
 const db=new Database(file),other=new Database(file);
 try{
  accessCredentials(db).initialize(old);db.exec("CREATE TABLE profiles(code TEXT); INSERT INTO profiles VALUES ('001')");
  const a=appFor(db),b=appFor(other);const previousCookie='__Host-telugu-access='+issueAccessSession(old.hash,old.secret);
  for(const url of ['/','/access','/access/','/index.html']){
   const r=await a.request('https://app.test'+url,{headers:{Accept:'text/html',Cookie:previousCookie}});assert.equal(r.status,200);assert.match(await r.text(),/id="generate"/);
  }
  const gen=await a.request('https://app.test/access/generate',{method:'POST',headers:{Origin:'https://app.test'}});
  assert.equal(gen.status,200);assert.deepEqual(accessCredentials(db).read(),{status:'ready',credentials:old});
  const phrases=['కొండ మీద పచ్చని చెట్టు','నాకు మాత్రమే ఈ ప్రవేశం'];
  const responses=await Promise.all([submit(a,phrases[0]!),submit(b,phrases[1]!)]);assert.deepEqual(responses.map(r=>r.status).sort(),[303,409]);
  const winner=responses.findIndex(r=>r.status===303);const saved=accessCredentials(db).read();assert.equal(saved.status,'ready');if(saved.status!=='ready')throw Error();
  assert.notEqual(saved.credentials.secret,old.secret);assert.equal(await verifyAccessPassphrase(phrases[winner]!,saved.credentials.hash),true);
  assert.equal(await verifyAccessPassphrase(phrases[1-winner]!,saved.credentials.hash),false);
  assert.equal((await a.request('https://app.test/api/private',{headers:{Cookie:previousCookie}})).status,401);
  const cookie=responses[winner]!.headers.get('set-cookie')!.split(';')[0]!;
  assert.equal((await a.request('https://app.test/api/private',{headers:{Cookie:cookie}})).status,200);
  assert.deepEqual(db.prepare('SELECT * FROM profiles').all(),[{code:'001'}]);
  const reopened=new Database(file);try{
   const restored=appFor(reopened);assert.match(await (await restored.request('https://app.test/')).text(),/current-password/);
   assert.equal((await submit(restored,phrases[0]!)).status,409);
   assert.equal((await restored.request('https://app.test/access/generate',{method:'POST',headers:{Origin:'https://app.test'}})).status,409);
  }finally{reopened.close();}
 }finally{db.close();other.close();rmSync(dir,{recursive:true,force:true});}
});
test('a failed credential update rolls back the recovery claim',()=>{
 const db=new Database(':memory:');try{
  accessCredentials(db).initialize(old);const recovery=oneTimeRecovery(db);
  db.exec("CREATE TRIGGER refuse_change BEFORE UPDATE ON access_credentials BEGIN SELECT RAISE(ABORT, 'fixture failure'); END");
  assert.throws(()=>recovery.replace({...old,secret:'44'.repeat(32)}));assert.equal(recovery.pending(),true);assert.deepEqual(accessCredentials(db).read(),{status:'ready',credentials:old});
 }finally{db.close();}
});
