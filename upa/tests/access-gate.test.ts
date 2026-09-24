import test from 'node:test';
import assert from 'node:assert/strict';
import {scryptSync} from 'node:crypto';
import Database from 'better-sqlite3';
import {Hono} from 'hono';
import {accessGate,issueAccessSession,validAccessSession,verifyAccessPassphrase} from '../server/src/access/gate';
const hash='scrypt-v1$'+'11'.repeat(16)+'$'+'22'.repeat(64);
const secret='33'.repeat(32);
function fixture(options: Parameters<typeof accessGate>[1] = {}) {
  const db=new Database(':memory:');let calls=0;
  const app=new Hono();app.use('*',accessGate(db,{hash:()=>hash,secret:()=>secret,secure:true,verify:async text=>text==='నాకు మాత్రమే ఈ ప్రవేశం',...options}));
  app.all('*',c=>{calls++;return c.json({protected:true});});
  const cookie=`__Host-telugu-access=${issueAccessSession(hash,secret)}`;
  return {app,db,cookie,calls:()=>calls};
}
test('anonymous traffic cannot reach app, API, audio, images, exports or assets; absent secrets fail closed',async()=>{
  const f=fixture();
  try {
    for(const path of ['/api/profiles/load','/api/audio/file.wav','/api/word-images','/api/profiles/001/export','/assets/index.js','/version.json']) {
      assert.equal((await f.app.request('https://app.test'+path)).status,401,path);
      assert.equal((await f.app.request('https://app.test'+path,{method:'POST',headers:{Origin:'https://app.test'}})).status,401,path);
    }
    assert.equal(f.calls(),0);
    assert.equal((await f.app.request('https://app.test/api/health')).status,200);
    const login=await f.app.request('https://app.test/');
    const html=await login.text();assert.match(html,/autocomplete="current-password"/);assert.match(html,/lang="te"/);assert.match(html,/type="password"/);assert.doesNotMatch(html,/onpaste|preventDefault|22{20}/);
    assert.equal(login.headers.get('cache-control'),'no-store');
    assert.equal((await f.app.request('https://app.test/assets/index.js',{headers:{Cookie:f.cookie}})).status,200);
    assert.equal(f.calls(),1);
  } finally {f.db.close();}
  const missing=fixture({hash:()=>''});try{assert.equal((await missing.app.request('https://app.test/api/profiles/001/state')).status,503);assert.equal(missing.calls(),0);}finally{missing.db.close();}
});
test('Telugu form login issues a secure cookie; the profile flow remains behind it; logout clears it',async()=>{
  const f=fixture();try {
    const login=await f.app.request('https://app.test/access',{method:'POST',headers:{Origin:'https://app.test','Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({password:'నాకు మాత్రమే ఈ ప్రవేశం'})});
    assert.equal(login.status,303);assert.equal(login.headers.get('location'),'/');
    const cookie=login.headers.get('set-cookie')!;
    for(const flag of ['HttpOnly','Secure','SameSite=Strict','Path=/','Max-Age=2592000'])assert.ok(cookie.includes(flag),flag);
    assert.equal((await f.app.request('https://app.test/api/profiles/load',{method:'POST',headers:{Origin:'https://app.test',Cookie:cookie.split(';')[0]!}})).status,200);
    const logout=await f.app.request('https://app.test/access/logout',{method:'POST',headers:{Origin:'https://app.test',Cookie:f.cookie}});
    assert.equal(logout.status,303);assert.match(logout.headers.get('set-cookie')!,/Max-Age=0/);
  }finally{f.db.close();}
});
test('forged, expired and rotated sessions fail; cross-origin writes fail even with a valid session',async()=>{
  const token=issueAccessSession(hash,secret,100000);
  assert.equal(validAccessSession(token,hash,secret,101000),true);
  assert.equal(validAccessSession(token+'x',hash,secret,101000),false);
  assert.equal(validAccessSession(token,hash,secret,100000+31*86400000),false);
  assert.equal(validAccessSession(token,hash.replace('22','44'),secret,101000),false);
  assert.equal(validAccessSession(token,hash,'55'.repeat(32),101000),false);
  const f=fixture();try {
    assert.equal((await f.app.request('https://app.test/access',{method:'POST',headers:{Origin:'https://evil.test'},body:'password=whatever'})).status,403);
    assert.equal((await f.app.request('https://app.test/api/word-images',{method:'POST',headers:{Origin:'https://evil.test',Cookie:f.cookie}})).status,403);
    assert.equal(f.calls(),0);
  }finally{f.db.close();}
});
test('failed attempts are bounded globally and survive recreation of the gate',async()=>{
  let n=0;const f=fixture({verify:async()=>{n++;return false;}});
  try {
    const request=()=>f.app.request('https://app.test/access',{method:'POST',headers:{Origin:'https://app.test','Content-Type':'application/x-www-form-urlencoded'},body:'password=no'});
    for(let i=0;i<5;i++)assert.equal((await request()).status,401);
    assert.equal((await request()).status,429);assert.equal(n,5);
    const next=new Hono();next.use('*',accessGate(f.db,{hash:()=>hash,secret:()=>secret,secure:true,verify:async()=>{throw new Error('must not verify');}}));
    assert.equal((await next.request('https://app.test/access',{method:'POST',headers:{Origin:'https://app.test','Content-Type':'application/x-www-form-urlencoded'},body:'password=no'})).status,429);
  }finally{f.db.close();}
});
test('oversized login bodies are rejected before hashing',async()=>{
  let n=0;const f=fixture({verify:async()=>{n++;return false;}});
  try {assert.equal((await f.app.request('https://app.test/access',{method:'POST',headers:{Origin:'https://app.test','Content-Type':'application/x-www-form-urlencoded'},body:'password='+'x'.repeat(17000)})).status,413);assert.equal(n,0);}finally{f.db.close();}
});
test('real scrypt verifier accepts canonically equivalent Telugu input and rejects a different passphrase',async()=>{
  const phrase='కొండ మీద పచ్చని చెట్టు';const salt=Buffer.alloc(16,7);
  const digest=scryptSync(phrase.normalize('NFC'),salt,64,{N:131072,r:8,p:1,maxmem:256*1024*1024});
  const verifier=`scrypt-v1$${salt.toString('hex')}$${digest.toString('hex')}`;
  assert.equal(await verifyAccessPassphrase(phrase.normalize('NFD'),verifier),true);
  assert.equal(await verifyAccessPassphrase(phrase+' తప్పు',verifier),false);
});
