import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {Hono} from 'hono';
import {mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {accessCredentials} from '../server/src/access/credentials';
import {accessGate,issueAccessSession} from '../server/src/access/gate';
const saved={hash:'scrypt-v1$'+'11'.repeat(16)+'$'+'22'.repeat(64),secret:'33'.repeat(32)};
test('volume credentials survive reopening; duplicate claims and corrupt records cannot overwrite them',()=>{
  const dir=mkdtempSync(path.join(os.tmpdir(),'access-volume-'));const file=path.join(dir,'users.sqlite');
  const first=new Database(file);const second=new Database(file);
  try {
    const a=accessCredentials(first), b=accessCredentials(second);
    assert.equal(a.read().status,'missing');assert.equal(a.initialize(saved),true);
    assert.equal(b.initialize({...saved,secret:'44'.repeat(32)}),false);
    assert.deepEqual(b.read(),{status:'ready',credentials:saved});
    first.close();const reopened=new Database(file);
    try{assert.deepEqual(accessCredentials(reopened).read(),{status:'ready',credentials:saved});}finally{reopened.close();}
    second.prepare("UPDATE access_credentials SET hash='corrupt' WHERE id=1").run();
    assert.equal(b.resolve().status,'invalid');assert.equal(b.initialize(saved),false);
  }finally{if(first.open)first.close();second.close();rmSync(dir,{recursive:true,force:true});}
});
test('existing secrets migrate once; stored credentials win over later environment changes',()=>{
  const oldHash=process.env.ACCESS_PASSPHRASE_HASH,oldSecret=process.env.ACCESS_SESSION_SECRET;
  const db=new Database(':memory:');
  try {
    process.env.ACCESS_PASSPHRASE_HASH=saved.hash;process.env.ACCESS_SESSION_SECRET=saved.secret;
    const store=accessCredentials(db);assert.deepEqual(store.resolve(),{status:'ready',credentials:saved});
    process.env.ACCESS_PASSPHRASE_HASH='bad';process.env.ACCESS_SESSION_SECRET='bad';
    assert.deepEqual(store.resolve(),{status:'ready',credentials:saved});
  } finally {
    if(oldHash===undefined)delete process.env.ACCESS_PASSPHRASE_HASH;else process.env.ACCESS_PASSPHRASE_HASH=oldHash;
    if(oldSecret===undefined)delete process.env.ACCESS_SESSION_SECRET;else process.env.ACCESS_SESSION_SECRET=oldSecret;
    db.close();
  }
});
test('volume-backed sessions work across a new gate instance; anonymous profile access remains blocked',async()=>{
  const db=new Database(':memory:');try {
    accessCredentials(db); accessCredentials(db).initialize(saved);
    const cookie='__Host-telugu-access='+issueAccessSession(saved.hash,saved.secret);
    for(let i=0;i<2;i++){
      const app=new Hono();app.use('*',accessGate(db,{secure:true}));app.get('/api/profile',c=>c.json({profile:true}));
      assert.equal((await app.request('https://app.test/api/profile')).status,401);
      assert.equal((await app.request('https://app.test/api/profile',{headers:{Cookie:cookie}})).status,200);
    }
  }finally{db.close();}
});
