import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { repositoryStore, RepositoryError } from '../server/src/repository/store';
import { repositoryRoutes } from '../server/src/repository/routes';
function fixture(file = ':memory:') {
  const db = new Database(file); db.pragma('foreign_keys=ON');
  db.exec("CREATE TABLE IF NOT EXISTS profiles(code TEXT PRIMARY KEY); INSERT OR IGNORE INTO profiles VALUES('001'),('002')");
  return db;
}
test('repository persists through reopen, scopes profiles, and recursively deletes only the selected subtree', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'repository-test-'));const filename=path.join(dir,'users.sqlite');
  let db=fixture(filename);
  try {
    let store=repositoryStore(db);
    const root=store.create('001',{name:'పదాలు',kind:'folder',parentId:null});
    const nested=store.create('001',{name:'లోపల',kind:'folder',parentId:root.id});
    const file=store.create('001',{name:'తెలుగు',kind:'file',parentId:nested.id});
    const other=store.create('002',{name:'పదాలు',kind:'folder',parentId:null});
    const sibling=store.create('001',{name:'వేరే',kind:'file',parentId:null});
    const saved=store.update('001',file.id,{revision:file.revision,content:'మొదటి పంక్తి\nరెండవ పంక్తి'});
    db.close(); db=fixture(filename); store=repositoryStore(db);
    assert.equal(store.get('001',file.id).content,saved.content);
    assert.throws(()=>store.get('002',file.id),RepositoryError);
    assert.throws(()=>store.create('002',{name:'వద్దు',kind:'file',parentId:root.id}),RepositoryError);
    assert.throws(()=>store.update('001',file.id,{revision:1,content:'stale'}),/stale-revision/);
    assert.throws(()=>store.remove('001',file.id,1),/stale-revision/);
    assert.throws(()=>store.create('001',{name:'తెలుగు',kind:'file',parentId:nested.id}),/duplicate-name/);
    store.update('001',file.id,{revision:saved.revision,name:'మారిన పేరు'});
    store.remove('001',root.id,root.revision);
    assert.throws(()=>store.get('001',nested.id),/not-found/);
    assert.throws(()=>store.get('001',file.id),/not-found/);
    assert.equal(store.get('002',other.id).name,'పదాలు');assert.equal(store.get('001',sibling.id).name,'వేరే');
    assert.deepEqual(db.pragma('foreign_key_check'),[]);
  } finally { db.close(); fs.rmSync(dir,{recursive:true,force:true}); }
});
test('repository routes reject invalid profiles, malformed bodies, and cross-profile IDs', async () => {
  const db=fixture();try {
    const api=repositoryRoutes(db,code=>['001','002'].includes(code));
    const send=(url:string,method:string,body:unknown)=>api.request(url,{method,headers:{'content-type':'application/json'},body:JSON.stringify(body)});
    assert.equal((await api.request('/999/repository/entries')).status,404);
    assert.equal((await send('/001/repository/entries','POST',null)).status,400);
    const made=await send('/001/repository/entries','POST',{name:'నాది',kind:'file',parentId:null});assert.equal(made.status,201);
    const file=await made.json();
    assert.equal((await api.request(`/002/repository/entries/${file.id}`)).status,404);
    assert.equal((await send(`/002/repository/entries/${file.id}`,'PUT',{revision:1,content:'wrong'})).status,404);
    assert.equal((await send(`/002/repository/entries/${file.id}`,'DELETE',{revision:1})).status,404);
    assert.equal((await send(`/001/repository/entries/${file.id}`,'PUT',{revision:1,content:'తెలుగు'})).status,200);
    assert.equal((await send(`/001/repository/entries/${file.id}`,'PUT',{revision:1,content:'older'})).status,409);
    assert.equal((await send('/001/repository/entries','POST',{name:'nested',kind:'file',parentId:file.id})).status,400);
  } finally { db.close(); }
});

test('moving a file or folder preserves content/descendants and checks cycles, profiles, collisions and revisions atomically', () => {
  const db=fixture(); try {
    const store=repositoryStore(db);
    const create=(name:string,kind:'file'|'folder',parentId:string|null=null,profile='001')=>store.create(profile,{name,kind,parentId});
    const source=create('source','folder'); const target=create('target','folder');
    const nested=create('nested','folder',source.id);const file=create('file','file',nested.id);
    store.update('001',file.id,{revision:1,content:'తెలుగు\nపత్రం'});
    const foreign=create('other','folder',null,'002');
    assert.throws(()=>store.update('001',source.id,{revision:1,parentId:source.id}),/invalid-move/);
    assert.throws(()=>store.update('001',source.id,{revision:1,parentId:nested.id}),/invalid-move/);
    assert.throws(()=>store.update('001',source.id,{revision:1,parentId:foreign.id}),/not-found/);
    assert.throws(()=>store.update('001',source.id,{revision:1,parentId:file.id}),/not-folder/);
    assert.throws(()=>store.update('001',source.id,{revision:1,parentId:42}),/invalid-parent/);
    const duplicate=create('source','file',target.id);
    assert.throws(()=>store.update('001',source.id,{revision:1,parentId:target.id}),/duplicate-name/);
    assert.equal(store.get('001',source.id).parentId,null);assert.equal(store.get('001',source.id).revision,1);
    store.remove('001',duplicate.id,1);
    const moved=store.update('001',source.id,{revision:1,parentId:target.id});
    assert.equal(moved.parentId,target.id);assert.equal(moved.revision,2);
    assert.equal(store.get('001',nested.id).parentId,source.id);assert.equal(store.get('001',file.id).content,'తెలుగు\nపత్రం');
    assert.throws(()=>store.update('001',source.id,{revision:1,parentId:null}),/stale-revision/);
    const movedFile=store.update('001',file.id,{revision:2,parentId:null});
    assert.equal(movedFile.parentId,null);assert.equal(movedFile.content,'తెలుగు\nపత్రం');
    store.remove('001',target.id,1);assert.throws(()=>store.get('001',nested.id),/not-found/);
    assert.equal(store.get('001',file.id).id,file.id);assert.deepEqual(db.pragma('foreign_key_check'),[]);
  } finally { db.close(); }
});

test('moving checks the depth of every descendant, not only the folder being moved', () => {
  const db=fixture();try {
    const store=repositoryStore(db);let parent:string|null=null;
    for(let i=0;i<64;i++)parent=store.create('001',{name:String(i),kind:'folder',parentId:parent}).id;
    const folder=store.create('001',{name:'subtree',kind:'folder',parentId:null});
    const child=store.create('001',{name:'child',kind:'file',parentId:folder.id});
    assert.throws(()=>store.update('001',folder.id,{revision:1,parentId:parent}),/depth-limit/);
    assert.equal(store.get('001',folder.id).parentId,null);
    // A leaf fits exactly at the supported depth.
    assert.equal(store.update('001',child.id,{revision:1,parentId:parent}).parentId,parent);
  } finally { db.close(); }
});

test('move API supports root destinations and rejects cross-profile destination folders', async () => {
  const db=fixture();try {
    const store=repositoryStore(db);const app=repositoryRoutes(db,()=>true);
    const file=store.create('001',{name:'file',kind:'file',parentId:null});
    const folder=store.create('001',{name:'folder',kind:'folder',parentId:null});
    const foreign=store.create('002',{name:'folder',kind:'folder',parentId:null});
    const move=(revision:number,parentId:string|null)=>app.request(`/001/repository/entries/${file.id}`,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({revision,parentId})});
    assert.equal((await move(1,foreign.id)).status,404);
    const result=await move(1,folder.id);assert.equal(result.status,200);assert.equal((await result.json()).parentId,folder.id);
    assert.equal((await move(1,null)).status,409);
    assert.equal((await move(2,null)).status,200);assert.equal(store.get('001',file.id).parentId,null);
  } finally {db.close();}
});
