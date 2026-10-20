import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { modifierEntries, modifierById, modifierGroups, modifierTitle, availableModifiers } from '../shared/modifiers';
import { modifierStore } from '../server/src/modifiers/store';
import { modifierRoutes } from '../server/src/modifiers/routes';
import { parentSettingsPage, visibleSettingsEntries } from '../frontend/src/settings/navigation';

function fixture(filename = ':memory:') {
  const db = new Database(filename);
  db.pragma('foreign_keys=ON');
  db.exec("CREATE TABLE IF NOT EXISTS profiles(code TEXT PRIMARY KEY); INSERT OR IGNORE INTO profiles VALUES('001'),('002')");
  return db;
}
test('updated archive retains every grammar entry and contextual example', () => {
  assert.equal(modifierEntries.length, 173);
  assert.equal(modifierById.size, 173);
  assert.equal(modifierEntries.flatMap(entry => entry.examples).length, 321);
  const exampleIds = new Set<string>();
  for (const entry of modifierEntries) {
    assert.ok(entry.examples.length);
    assert.ok(modifierTitle(entry));
    for (const example of entry.examples) {
      assert.ok(example.context_sentence.trim());
      assert.ok(!exampleIds.has(example.example_id)); exampleIds.add(example.example_id);
      const base = Array.from(example.base);
      assert.equal(base.slice(example.operation.keep_codepoints).join(''), example.operation.remove);
      assert.equal(base.slice(0,example.operation.keep_codepoints).join('') + example.operation.append, example.result);
    }
  }
});
test('draws mark whole entries seen, avoid immediate repeats, exclude all examples and partition the pool', () => {
  const db = fixture();
  try {
    const store = modifierStore(db);
    const initial = modifierGroups(store.state('001'));
    assert.equal(initial.unseen.length,173); assert.equal(initial.seen.length,0);
    const first = store.draw('001',null).entryId!;
    assert.ok(first);
    assert.notEqual(store.draw('001',first).entryId,first);
    store.setExcluded('001',first,true);
    assert.ok(!availableModifiers(store.state('001'),null).some(entry => entry.id === first));
    const groups = modifierGroups(store.state('001'));
    assert.equal(groups.excluded.length,1); assert.equal(groups.seen.length,1); assert.equal(groups.unseen.length,171);
    // Turning off an entry preserves its seen classification.
    store.setExcluded('001',first,false);
    assert.equal(modifierGroups(store.state('001')).seen.length,2);
    assert.equal(availableModifiers(store.state('001'),null).length,173);
  } finally { db.close(); }
});
test('empty pool never silently resets; a sole eligible entry can repeat; explicit reset clears only its profile', () => {
  const db = fixture();
  try {
    const store = modifierStore(db);
    for (const entry of modifierEntries) store.setExcluded('001',entry.id,true);
    assert.equal(store.draw('001',null).entryId,null);
    assert.equal(store.draw('001',null).progress.length,173);
    const id = modifierEntries[0]!.id;
    store.setExcluded('001',id,false);
    assert.equal(store.draw('001',id).entryId,id);
    store.setExcluded('002',id,true);
    assert.equal(store.reset('001').progress.length,0);
    assert.equal(modifierGroups(store.state('001')).unseen.length,173);
    assert.equal(store.state('002').progress[0]?.excluded,true);
    assert.throws(() => store.setExcluded('001','missing',true),/unknown-modifier/);
  } finally { db.close(); }
});
test('profile progress survives closing/reopening the volume database and follows profile deletion', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'modifier-test-'));
  let db = fixture(path.join(dir,'profiles.sqlite'));
  try {
    const store = modifierStore(db), first = store.draw('001',null).entryId!;
    const saved = store.setExcluded('001',first,true);
    db.close(); db = fixture(path.join(dir,'profiles.sqlite'));
    const reopened = modifierStore(db);
    assert.deepEqual(reopened.state('001'),saved);
    assert.deepEqual(reopened.state('002'),{progress:[],omitted:[]});
    db.prepare('DELETE FROM profiles WHERE code=?').run('001');
    assert.equal(reopened.state('001').progress.length,0);
    assert.deepEqual(db.pragma('foreign_key_check'),[]);
  } finally { db.close(); fs.rmSync(dir,{recursive:true,force:true}); }
});
test('API rejects invalid profiles, IDs and bodies; saves, draws and resets are scoped', async () => {
  const db = fixture();
  try {
    const app = modifierRoutes(db,code => ['001','002','003'].includes(code));
    const send = (url: string, method: string, body: unknown) => app.request(url,{method,headers:{'content-type':'application/json'},body:JSON.stringify(body)});
    assert.equal((await app.request('/999/modifiers/state')).status,404);
    assert.equal((await app.request('/003/modifiers/state')).status,404);
    assert.equal((await send('/001/modifiers/draw','POST',null)).status,400);
    assert.equal((await send('/001/modifiers/draw','POST',{current:'missing'})).status,400);
    assert.equal((await send('/001/modifiers/entries/plural','PUT',{excluded:'true'})).status,400);
    assert.equal((await send('/001/modifiers/entries/missing','PUT',{excluded:true})).status,404);
    assert.equal((await send('/001/modifiers/entries/plural','PUT',{excluded:true})).status,200);
    assert.deepEqual(await (await app.request('/002/modifiers/state')).json(),{progress:[],omitted:[]});
    const drawn = await (await send('/001/modifiers/draw','POST',{current:null})).json();
    assert.notEqual(drawn.entryId,'plural'); assert.ok(drawn.entryId);
    assert.equal((await send('/001/modifiers/reset','POST',{})).status,200);
    assert.deepEqual(await (await app.request('/001/modifiers/state')).json(),{progress:[],omitted:[]});
  } finally { db.close(); }
});
test('modifier settings are distinct pages under their own section', () => {
  assert.ok(visibleSettingsEntries('index',false).includes('modifierMode'));
  for (const page of ['modifierExcluded','modifierSeen','modifierUnseen','modifierReset'] as const) {
    assert.ok(visibleSettingsEntries('modifierMode',false).includes(page));
    assert.equal(parentSettingsPage(page),'modifierMode');
  }
});

test('persistent omissions survive resets, reopening, imports and round draws', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'modifier-omissions-'));
  let db = fixture(path.join(dir,'profiles.sqlite'));
  try {
    let store = modifierStore(db);
    const entry = modifierEntries[0]!;
    store.setOmitted('001',entry.id,true);
    store.setExcluded('001',modifierEntries[1]!.id,true);
    assert.equal(modifierGroups(store.reset('001')).omitted.length,1);
    assert.equal(modifierGroups(store.state('001')).excluded.length,0);
    store.importCatalog('001',[entry]);
    assert.equal(store.draw('001',null).entryId,null);
    assert.equal(store.state('002').entries,undefined);
    db.close(); db=fixture(path.join(dir,'profiles.sqlite')); store=modifierStore(db);
    assert.equal(store.draw('001',null).entryId,null);
    store.importCatalog('001',[modifierEntries[1]!]);
    store.importCatalog('001',[entry]);
    assert.equal(store.draw('001',null).entryId,null);
    store.setOmitted('001',entry.id,false);
    assert.equal(store.draw('001',null).entryId,entry.id);
  } finally { db.close(); fs.rmSync(dir,{recursive:true,force:true}); }
});

test('ZIP import validates before replacing profile data and ignores unrelated archive files', async () => {
  const { zipSync, strToU8 } = await import('fflate');
  const { readModifierZip } = await import('../server/src/modifiers/import');
  const entry = modifierEntries[0]!;
  const zip = zipSync({'telugu-modifiers/telugu_modifiers.json':strToU8(JSON.stringify({entries:[entry]})), '../../ignored.py':strToU8('unused')});
  assert.deepEqual(readModifierZip(zip),[entry]);
  assert.throws(() => readModifierZip(zipSync({'telugu_modifiers.json':strToU8('{"entries":[]}')})));
  assert.throws(() => readModifierZip(zipSync({'telugu_modifiers.json':strToU8(JSON.stringify({entries:[entry,entry]}))})));
  assert.throws(() => readModifierZip(zipSync({'a/telugu_modifiers.json':strToU8('{}'),'b/telugu_modifiers.json':strToU8('{}')})));
  assert.throws(() => readModifierZip(zipSync({'telugu_modifiers.json':new Uint8Array(8*1024*1024+1)})));
  const db=fixture();
  try {
    const app=modifierRoutes(db,()=>true);
    const response=await app.request('/001/modifiers/import',{method:'POST',body:zip,headers:{'content-type':'application/zip'}});
    assert.equal(response.status,200);
    const saved=await response.json();
    assert.equal(saved.entries.length,1);
    assert.equal((await app.request('/001/modifiers/import',{method:'POST',body:'not a zip'})).status,400);
    assert.deepEqual(await (await app.request('/001/modifiers/state')).json(),saved);
    assert.equal((await (await app.request('/002/modifiers/state')).json()).entries,undefined);
  } finally {db.close();}
});
