import test from 'node:test';
import assert from 'node:assert/strict';
import {explorationSteps,explorationIndex} from '../frontend/src/observation/exploration-steps';

test('letters, whole words and growing phrases precede the original full observation',()=>{
  const steps=explorationSteps('We like tea.');
  assert.deepEqual(steps.map(step=>step.text),['W','e','We','l','i','k','e','like','We like','t','e','a','tea']);
  let index:number|null=null;
  for(let i=0;i<steps.length;i++){index=explorationIndex(index,'up',steps.length);assert.equal(index,i);}
  assert.equal(explorationIndex(index,'up',steps.length),null,'completion restores original, including punctuation');
  for(let i=steps.length-1;i>=0;i--){assert.equal(index,i);index=explorationIndex(index,'down',steps.length);}
  assert.equal(index,null,'reverse traversal returns to original');
});
test('Telugu graphemes stay intact and all focus offsets map to the original transcript',()=>{
  const text='  నేను, ఇక్కడ ఉన్నాను!';const steps=explorationSteps(text);
  for(const step of steps){
    assert.equal(text.slice(step.start,step.end),step.text);
    assert.equal(text.slice(step.wordStart,step.wordEnd),step.word);
    if(step.kind==='letter'){
      assert.equal(step.word.slice(step.graphemeStart,step.graphemeEnd),step.text);
      assert.equal([...new Intl.Segmenter('te',{granularity:'grapheme'}).segment(step.text)].length,1);
      assert.doesNotMatch(step.text,/^\p{M}/u);
    }
  }
  assert.ok(steps.some(step=>step.text==='  నేను, ఇక్కడ'&&step.kind==='phrase'));
});
test('empty text, single word and one-letter words have explicit boundaries',()=>{
  assert.deepEqual(explorationSteps('… !'),[]);
  assert.equal(explorationIndex(null,'up',0),null);
  assert.deepEqual(explorationSteps('నేను').map(step=>step.kind),['letter','letter']);
  assert.equal(explorationIndex(null,'down',4),null);
  assert.deepEqual(explorationSteps('I am').map(step=>step.text),['I','I','a','m','am']);
});

import {ReaderWheel} from '../frontend/src/observation/reader-wheel';
test('wheel momentum advances one step and a deliberate reversal can retrace it',()=>{
  const wheel=new ReaderWheel();
  assert.equal(wheel.move(0,-24,0,800,0),null);
  assert.equal(wheel.move(0,-24,0,800,10),'up');
  assert.equal(wheel.move(0,-180,0,800,20),null);
  assert.equal(wheel.move(0,60,0,800,30),'down');
  assert.equal(wheel.move(0,60,0,800,40),null);
  assert.equal(wheel.move(0,-3,1,800,300),'up');
  assert.equal(wheel.move(0,1,2,800,600),'down');
  assert.equal(wheel.move(70,0,0,800,900),'next');
  assert.equal(wheel.move(-70,0,0,800,1200),'back');
});
