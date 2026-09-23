import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readerSwipe } from '../frontend/src/observation/reader-swipe';
import { observationShowsText } from '../frontend/src/observation/observation-content';
import { GrammarEvaluation } from '../frontend/src/observation/GrammarEvaluation';

test('swipe navigation rejects taps, small drags and ambiguous diagonals', () => {
  for (const [x,y] of [[0,0],[20,0],[47,0],[60,60],[-70,60]]) assert.equal(readerSwipe(x!, y!), null);
  assert.equal(readerSwipe(-90,15), 'next');
  assert.equal(readerSwipe(90,-15), 'back');
  assert.equal(readerSwipe(10,80), 'down');
  assert.equal(readerSwipe(-10,-80), 'up');
});
test('text-given prompt remains visible through question, comparison and observation', () => {
  for (const phase of ['question','comparison','observation'] as const) {
    assert.equal(observationShowsText({text:'తెలుగు',audio:null,kind:'question',question:{mode:'text-given',requestedPool:null,keyboard:null,phase,responseText:'',responseAudio:null}}), true);
  }
  assert.equal(observationShowsText({text:'తెలుగు',audio:null,kind:'question',question:{mode:'audio-given',requestedPool:null,keyboard:null,phase:'comparison',responseText:'',responseAudio:null}}), false);
});
test('switch defaults off, preserves an unsaved draft, and locks either saved value', () => {
  const render = (result: boolean | null, initialDraft = false) => renderToStaticMarkup(createElement(GrammarEvaluation, {profileCode:'001',observationId:'test',result,initialDraft}));
  assert.match(render(null), /aria-checked="false"/);
  assert.doesNotMatch(render(null), /disabled=/);
  assert.match(render(null,true), /aria-checked="true"/);
  for (const result of [true,false]) {
    const html = render(result,!result);
    assert.match(html,new RegExp(`aria-checked="${result}"`));
    assert.match(html,/disabled=""/);
  }
});
