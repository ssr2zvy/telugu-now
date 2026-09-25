import test from 'node:test';
import assert from 'node:assert/strict';
import { categoryCurve } from '../server/src/grammar/category-view';
import { initialProgress, probabilities } from '../server/src/grammar/model';
const sizes=[3,7,2,5];const levels=[1,2,4,6];
for(const position of [0,.5,1,1.5,2,3])test(`category curve uses actual scheduler distribution at ${position}`,()=>{
 const state={...initialProgress(sizes),position};const rows=categoryCurve(levels,sizes,state);
 assert.deepEqual(rows.map(r=>r.probability),probabilities(sizes,state));
 assert.deepEqual(rows.map(r=>r.level),levels);
 assert.ok(Math.abs(rows.reduce((s,r)=>s+r.probability,0)-1)<1e-12);
 if(position===0)assert.ok(rows.every(r=>r.reversal===0));
 if(position===.5)assert.deepEqual(rows.map(r=>r.reversal),[.5,.5,0,0]);
 if(position===1)assert.deepEqual(rows.map(r=>r.reversal),[1,1,0,0]);
});
test('completion highlights the whole reversal and holds the final distribution',()=>{
 const state={...initialProgress(sizes),position:4,completed:true};const rows=categoryCurve(levels,sizes,state);
 assert.ok(rows.every(r=>r.reversal===1));
 assert.deepEqual(rows.map(r=>r.probability),rows.map(r=>r.initialProbability).reverse());
});
test('one category is represented without invalid probabilities',()=>{
 const rows=categoryCurve([1],[2],initialProgress([2]));assert.equal(rows[0]!.probability,1);assert.equal(rows[0]!.reversal,0);
});
