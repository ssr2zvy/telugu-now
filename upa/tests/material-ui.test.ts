import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProfileEntry } from '../frontend/src/profile/ProfileEntry';
import { GrammarEvaluation } from '../frontend/src/observation/GrammarEvaluation';
import { observationShowsPhaseIndicator } from '../frontend/src/observation/observation-content';

test('login uses buttons, preserves three code slots, and contains no editable OS-keyboard target', () => {
  const markup = renderToStaticMarkup(createElement(ProfileEntry, { invalidCode: false, loadUnavailable: false, onSubmit: async () => false, onInputChange: () => {} }));
  assert.doesNotMatch(markup, /<input|<textarea|contenteditable="true"/i);
  assert.equal((markup.match(/class="entry-digit"/g) ?? []).length, 3);
  assert.equal((markup.match(/<button /g) ?? []).length, 15);
  assert.match(markup, /aria-label="Paste profile code"/);
  assert.match(markup, /aria-label="Backspace"/);
});
test('comparison evaluation is one unlabeled switch, defaults off, and locks saved answers',()=>{
  const props={profileCode:'001',observationId:'one',result:null};
  const fresh=renderToStaticMarkup(createElement(GrammarEvaluation,props));
  assert.equal((fresh.match(/role="switch"/g)??[]).length,1);
  assert.match(fresh,/aria-checked="false"/);assert.doesNotMatch(fresh,/disabled=""|type="radio"|<p|<label|True|False|Choose|Was your answer/);
  for(const result of [false,true]) {
    const saved=renderToStaticMarkup(createElement(GrammarEvaluation,{...props,result}));
    assert.match(saved,/<button[^>]*disabled=""/);assert.ok(saved.includes(`aria-checked="${result}"`));
  }
});
test('ordinary observations receive an indicator too, while empty entries do not', () => {
  const normal = { kind: 'normal' as const, text: 'తెలుగు', audio: null, question: null };
  assert.equal(observationShowsPhaseIndicator(normal, null), true);
  assert.equal(observationShowsPhaseIndicator({ ...normal, text: '' }, null), false);
  assert.equal(observationShowsPhaseIndicator(null, null), false);
});
