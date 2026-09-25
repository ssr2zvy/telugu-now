import test from 'node:test';
import assert from 'node:assert/strict';
import reference from './fixtures/grammar-model-reference.json';
import {initialProgress,probabilities,update} from '../server/src/grammar/model';
test('production port matches Python scheduler event by event',()=>{
 const state=initialProgress(reference.sizes);
 for(const e of reference.events){update(reference.sizes,state,e.j,e.t,e.result);assert.ok(Math.abs(state.position-e.position)<1e-12);assert.deepEqual(state.streaks,e.streaks);probabilities(reference.sizes,state).forEach((p,i)=>assert.ok(Math.abs(p-e.probabilities[i]!)<1e-12));}
});
test('completion stays at final distribution while review streaks continue',()=>{
 const s=initialProgress([1,1]);for(let i=0;i<3;i++)update([1,1],s,0,0,true);for(let i=0;i<3;i++)update([1,1],s,1,0,true);
 assert.equal(s.completed,true);const p=probabilities([1,1],s);update([1,1],s,0,0,false);assert.equal(s.position,2);assert.deepEqual(probabilities([1,1],s),p);assert.equal(s.streaks[0]![0],0);
});
test('adjacent earlier failure has 2.5 multiplier and current failure cannot cross a tier',()=>{
 const s=initialProgress([1,1,1]);s.position=1.5;s.streaks=[[3],[2],[0]];
 const e=update([1,1,1],s,0,0,false);assert.equal(e.multiplier,2.5);assert.equal(s.position,0);
 s.position=1.5;s.streaks[1]=[3];update([1,1,1],s,1,0,false);assert.equal(s.position,1);
});
