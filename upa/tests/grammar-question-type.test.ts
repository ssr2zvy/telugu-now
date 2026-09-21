import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { initialProgress, probabilities, update } from '../server/src/grammar/model';
import { questionTypeCurve, chooseQuestionType } from '../server/src/grammar/question-type';
import { GrammarQuestionTypePage } from '../frontend/src/settings/pages/GrammarQuestionTypePage';
const near = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} != ${expected}`);

test('two-rank Zipf reverses text to audio within every category and resets at the grammar peak boundary', () => {
  const sizes=[2,3,4],state=initialProgress(sizes),peak=probabilities(sizes,state)[0]!;
  for(let category=0;category<sizes.length;category++) {
    for(const phase of [0,.25,.5,.75,1-1e-8]) {
      state.position=category+phase;
      const q=questionTypeCurve(sizes,state);
      assert.equal(q.categoryIndex,category);near(q.phase,phase);
      near(q.textGiven,(2-phase)/3);near(q.textGiven+q.audioGiven,1);
    }
    state.position=category;
    near(probabilities(sizes,state)[category]!,peak);
    near(questionTypeCurve(sizes,state).textGiven,2/3);
  }
});
test('actual streak updates drive the reset only at the existing gated category transition', () => {
  const sizes=[2,2,1],s=initialProgress(sizes);
  for(let i=0;i<3;i++)update(sizes,s,0,0,true);
  near(s.position,.5);near(questionTypeCurve(sizes,s).textGiven,.5);
  update(sizes,s,0,1,true);update(sizes,s,0,1,true);
  assert.equal(questionTypeCurve(sizes,s).categoryIndex,0);
  assert.ok(questionTypeCurve(sizes,s).audioGiven>.5);
  update(sizes,s,0,1,true);
  assert.equal(s.position,1);assert.equal(questionTypeCurve(sizes,s).phase,0);
  near(questionTypeCurve(sizes,s).textGiven,2/3);
});
test('failed current and earlier targets use the same regressed position without an independent mode clock', () => {
  const sizes=[2,2,1],s=initialProgress(sizes);
  s.position=1.75;s.streaks=[[1,3],[3,3],[0]];
  update(sizes,s,1,0,false);
  near(s.position,1.25);near(questionTypeCurve(sizes,s).phase,.25);
  update(sizes,s,0,0,false);
  assert.equal(questionTypeCurve(sizes,s).categoryIndex,0);
  near(questionTypeCurve(sizes,s).phase,s.position);
});
test('sampling records its exact draw and chosen probability and never mutates progress', () => {
  const sizes=[1,1],s=initialProgress(sizes),before=JSON.stringify(s);
  const text=chooseQuestionType(sizes,s,()=>0),audio=chooseQuestionType(sizes,s,()=>2/3);
  assert.equal(text.mode,'text-given');assert.equal(audio.mode,'audio-given');
  near(text.selectedProbability,2/3);near(audio.selectedProbability,1/3);
  assert.equal(text.draw,0);assert.equal(audio.draw,2/3);assert.equal(JSON.stringify(s),before);
  for(const bad of [NaN,Infinity,-.1,1])assert.throws(()=>chooseQuestionType(sizes,s,()=>bad));
});
test('last category still reverses, then completion holds its audio-heavy endpoint even on later failures', () => {
  const sizes=[1],s=initialProgress(sizes);
  update(sizes,s,0,0,true);update(sizes,s,0,0,true);
  assert.ok(questionTypeCurve(sizes,s).audioGiven>.5);
  update(sizes,s,0,0,true);assert.equal(s.completed,true);
  const final=questionTypeCurve(sizes,s);near(final.audioGiven,2/3);assert.equal(final.phase,1);
  update(sizes,s,0,0,false);assert.deepEqual(questionTypeCurve(sizes,s),final);
});
test('completion and category math remain unchanged in a run through every tier', () => {
  const sizes=[2,3,2,1],s=initialProgress(sizes),originalPeak=probabilities(sizes,s)[0]!;
  for(let j=0;j<sizes.length;j++) {
    near(questionTypeCurve(sizes,s).textGiven,2/3);
    near(probabilities(sizes,s)[j]!,originalPeak);
    for(let t=0;t<sizes[j]!;t++)for(let n=0;n<3;n++)update(sizes,s,j,t,true);
    assert.equal(s.position,j+1);
  }
  assert.equal(s.completed,true);near(questionTypeCurve(sizes,s).audioGiven,2/3);
});
test('question diagnostics show saved probabilities, and label old records without inventing a split', () => {
  const q=chooseQuestionType([1,1],initialProgress([1,1]),()=>.8);
  const markup=renderToStaticMarkup(createElement(GrammarQuestionTypePage,{selected:{questionType:{...q,categoryLevel:1}},mode:q.mode}));
  assert.match(markup,/66.67%/);assert.match(markup,/33.33%/);assert.match(markup,/audio-given/);assert.match(markup,/Frozen for this batch of 10/);
  const historical=renderToStaticMarkup(createElement(GrammarQuestionTypePage,{selected:{},mode:'text-given'}));
  assert.match(historical,/curve not recorded/);assert.doesNotMatch(historical,/60.00%|66.67%/);
});
