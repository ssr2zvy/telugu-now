import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {Hono} from 'hono';
import {accessGate,issueAccessSession} from '../server/src/access/gate';
import {accessCredentials} from '../server/src/access/credentials';
const saved={hash:'scrypt-v1$'+'11'.repeat(16)+'$'+'22'.repeat(64),secret:'33'.repeat(32)};
test('permanent setup and generation endpoints are absent for missing, corrupt and configured credentials',async()=>{
  for(const state of ['missing','corrupt','ready']){
    const db=new Database(':memory:');try {
      const store=accessCredentials(db);if(state!=='missing')store.initialize(saved);
      if(state==='corrupt')db.prepare("UPDATE access_credentials SET hash='bad'").run();
      const app=new Hono();app.use('*',accessGate(db,{secure:true}));app.all('*',c=>c.json({protected:true}));
      const cookie='__Host-telugu-access='+issueAccessSession(saved.hash,saved.secret);
      for(const url of ['/access/setup','/access/generate'])for(const method of ['GET','POST','PUT'])for(const authenticated of [false,true]){
        const response=await app.request('https://app.test'+url,{method,headers:{Origin:'https://app.test',...(authenticated?{Cookie:cookie}:{})}});
        assert.equal(response.status,404,`${state} ${method} ${url}`);
        assert.doesNotMatch(await response.text(),/new-password|id="generate"|id="copy"/);
      }
      if(state!=='ready'){
        for(const url of ['/','/access','/api/profiles/001'])assert.equal((await app.request('https://app.test'+url)).status,503);
        assert.equal((await app.request('https://app.test/access',{method:'POST',headers:{Origin:'https://app.test','Content-Type':'application/x-www-form-urlencoded'},body:'password=one+two+three+four'})).status,503);
        assert.equal(store.read().status,state==='missing'?'missing':'invalid');
      }else{
        const html=await (await app.request('https://app.test/')).text();
        assert.match(html,/autocomplete="current-password"/);assert.doesNotMatch(html,/new-password|id="generate"|id="copy"/);
      }
    }finally{db.close();}
  }
});
