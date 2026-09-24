import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {Hono} from 'hono';
import {Script} from 'node:vm';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {accessGate,verifyAccessPassphrase} from '../server/src/access/gate';
import {accessCredentials} from '../server/src/access/credentials';
import {generateSetupPhrase} from '../server/src/access/setup';
import {SETUP_WORDS} from '../server/src/access/setup-words';
function appFor(db: Database.Database) {const app=new Hono();app.use('*',accessGate(db,{secure:true}));app.all('*',c=>c.json({protected:true}));return app;}
const submit=(app:Hono,phrase:string)=>app.request('https://app.test/access/setup',{method:'POST',headers:{Origin:'https://app.test','Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({password:phrase})});
test('dictionary exactly matches single-word Core 1–3 vocabulary; ten-word phrases use it',()=>{
  const graph=JSON.parse(readFileSync('../data-transform/scripts/parse-core/graph.json','utf8'));
  const words=new Set<string>();
  for(const n of Object.values(graph.nodes) as {kind:string;core:number;forms:string[]}[])
    if(n.kind==='vocabulary' && [1,2,3].includes(n.core))for(const word of n.forms)
      if(/^[\u0c00-\u0c7f]+$/u.test(word) && Buffer.byteLength(word)<=96)words.add(word.normalize('NFC'));
  assert.deepEqual([...SETUP_WORDS].sort(),[...words].sort());assert.ok(SETUP_WORDS.length>=256);
  for(let i=0;i<20;i++){const phrase=generateSetupPhrase();assert.equal(phrase.split(' ').length,10);assert.ok(Buffer.byteLength(phrase)<=1024);assert.ok(phrase.split(' ').every(word=>words.has(word)));}
});
test('setup supports generation, reveal, copy and autofill; generation does not claim ownership',async()=>{
  const db=new Database(':memory:');try{
    const app=appFor(db);const html=await (await app.request('https://app.test/')).text();
    new Script(html.match(/<script>([\s\S]*?)<\/script>/)![1]!);
    assert.match(html,/autocomplete="new-password"/);assert.match(html,/lang="te"/);assert.match(html,/id="copy"/);assert.doesNotMatch(html,/<h[1-6]/);
    const generated=await app.request('https://app.test/access/generate',{method:'POST',headers:{Origin:'https://app.test'}});
    assert.equal(generated.status,200);assert.equal(generated.headers.get('cache-control'),'no-store');assert.equal(generated.headers.get('set-cookie'),null);
    assert.equal((await generated.json()).phrase.split(' ').length,10);
    assert.equal(accessCredentials(db).read().status,'missing');assert.equal((await app.request('https://app.test/api/profiles/001')).status,503);
    assert.equal((await app.request('https://app.test/access/generate',{method:'POST',headers:{Origin:'https://evil.test'}})).status,403);
    assert.equal((await submit(app,'ఒక పదం')).status,400);
  }finally{db.close();}
});
test('two independent servers race: exactly one claims ownership; setup closes; stored verifier works',async()=>{
  const dir=mkdtempSync(path.join(os.tmpdir(),'access-race-'));const file=path.join(dir,'users.sqlite');
  const a=new Database(file),b=new Database(file);a.pragma('journal_mode=WAL');b.pragma('busy_timeout=5000');
  try {
    const first=appFor(a),second=appFor(b);const phrases=['కొండ మీద పచ్చని చెట్టు','నాకు మాత్రమే ఈ ప్రవేశం'];
    const results=await Promise.all([submit(first,phrases[0]!),submit(second,phrases[1]!)]);
    assert.deepEqual(results.map(r=>r.status).sort(),[303,409]);
    const winner=results.findIndex(r=>r.status===303);const state=accessCredentials(a).read();assert.equal(state.status,'ready');if(state.status!=='ready')throw Error();
    assert.equal(await verifyAccessPassphrase(phrases[winner]!,state.credentials.hash),true);
    assert.equal(await verifyAccessPassphrase(phrases[1-winner]!,state.credentials.hash),false);
    assert.ok(!JSON.stringify(a.prepare('SELECT * FROM access_credentials').all()).includes(phrases[winner]!));
    const cookie=results[winner]!.headers.get('set-cookie')!.split(';')[0]!;
    assert.equal((await second.request('https://app.test/api/profiles/001',{headers:{Cookie:cookie}})).status,200);
    for(const url of ['/access/setup','/access/generate'])for(const method of ['GET','POST'])
      assert.equal((await first.request('https://app.test'+url,{method,headers:{Origin:'https://app.test'}})).status,409);
    const login=await first.request('https://app.test/access',{method:'POST',headers:{Origin:'https://app.test','Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({password:phrases[winner]!})});
    assert.equal(login.status,303);
    const restored=appFor(b);assert.match(await (await restored.request('https://app.test/')).text(),/autocomplete="current-password"/);
  }finally{a.close();b.close();rmSync(dir,{recursive:true,force:true});}
});
test('generation is rate limited; malformed stored credentials never reopen setup',async()=>{
  const db=new Database(':memory:');try {
    const app=appFor(db);const generate=()=>app.request('https://app.test/access/generate',{method:'POST',headers:{Origin:'https://app.test'}});
    for(let i=0;i<5;i++)assert.equal((await generate()).status,200);assert.equal((await generate()).status,429);
    db.prepare("INSERT INTO access_credentials VALUES (1,'bad','bad',0)").run();
    assert.equal((await generate()).status,409);assert.equal((await app.request('https://app.test/')).status,503);
  }finally{db.close();}
});
