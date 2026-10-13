import assert from 'node:assert/strict';
import test from 'node:test';
import { RepositoryDraft, type SavedDraft } from '../frontend/src/repository/draft';

test('autosave serializes updates and never loses edits typed while a save is in flight',async()=>{
 const requests: SavedDraft[]=[];let resolve: (value:SavedDraft)=>void=()=>{};
 let persisted:SavedDraft|null=null;
 const draft=new RepositoryDraft({content:'',revision:1},async sent=>{requests.push(sent);if(requests.length===1)return new Promise(r=>{resolve=r});return {...sent,revision:sent.revision+1};},v=>{persisted=v},()=>{});
 draft.edit('మొదటి');const saving=draft.flush();draft.edit('రెండవ');
 assert.equal(draft.flush(),saving);assert.equal(requests.length,1);
 resolve({content:'మొదటి',revision:2});assert.equal(await saving,true);
 assert.deepEqual(requests,[{content:'మొదటి',revision:1},{content:'రెండవ',revision:2}]);assert.equal(draft.state,'saved');assert.equal(persisted,null);draft.dispose();
});
test('failed saves retain recoverable drafts and stale recovery cannot overwrite another device',async()=>{
 let persisted:SavedDraft|null=null;let calls=0;
 const draft=new RepositoryDraft({content:'old',revision:2},async()=>{calls++;throw new Error('offline')},v=>{persisted=v},()=>{});
 draft.edit('unsaved');assert.equal(await draft.flush(),false);assert.equal(draft.state,'error');assert.deepEqual(persisted,{content:'unsaved',revision:2});draft.dispose();
 const recovered=new RepositoryDraft({content:'other device',revision:3},async sent=>{calls++;return sent;},()=>{},()=>{},persisted);
 assert.equal(recovered.value,'unsaved');assert.equal(recovered.state,'conflict');assert.equal(await recovered.flush(),false);assert.equal(calls,1);recovered.dispose();
});
test('remote deletion retains the draft for save-as-copy instead of overwriting or discarding it',async()=>{
 let persisted:SavedDraft|null=null;
 const draft=new RepositoryDraft({content:'old',revision:1},async()=>{throw Object.assign(new Error('deleted'),{code:'not-found'})},v=>{persisted=v},()=>{});
 draft.edit('local edit');assert.equal(await draft.flush(),false);assert.equal(draft.state,'conflict');assert.deepEqual(persisted,{content:'local edit',revision:1});draft.dispose();
});
