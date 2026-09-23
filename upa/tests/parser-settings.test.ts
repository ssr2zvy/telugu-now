import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parentSettingsPage, visibleSettingsEntries, settingsPageLabel } from '../frontend/src/settings/navigation';
import { targetUnicode, completion } from '../frontend/src/settings/parser-display';
import { ParserSection } from '../frontend/src/settings/pages/ParserSection';
import { matchedWordEvidence } from '../frontend/src/settings/pages/SelectedWordMatch';
import type { ParsingDiagnostics, TargetDiagnostic } from '../shared/parsing-diagnostics';

test('observations hierarchy and back navigation reach each nested page', () => {
  assert.ok(visibleSettingsEntries('index',false).includes('observations'));
  assert.ok(!visibleSettingsEntries('index',false).includes('diagnostic'));
  assert.deepEqual(visibleSettingsEntries('observations',false),['parser','parsingMode','dataSources']);
  assert.deepEqual(visibleSettingsEntries('parser',false),['parserCurrent','diagnostic']);
  for(const [child,parent] of [['parser','observations'],['parsingMode','observations'],['parserCurrent','parser'],['diagnostic','parser'],['diagnosticsDownload','diagnostic'],['dataSources','observations']] as const) assert.equal(parentSettingsPage(child),parent);
  assert.equal(settingsPageLabel('observations','en'),'Observations');
  assert.equal(settingsPageLabel('parsingMode','en'),'Questions');
});
test('chain labels use inventory Unicode and never expose internal identifiers as a fallback', () => {
  const target = {id:'CHAIN:mod_plural',label:'mod_plural',forms:[],pattern:{needles:['లు','లు','ల'],maxCodepoints:20,scope:'word'}} as unknown as TargetDiagnostic;
  assert.deepEqual(targetUnicode(target),['లు','ల']);
  assert.deepEqual(targetUnicode({...target,forms:['ఇది']}),['ఇది']);
  assert.deepEqual(targetUnicode({...target,pattern:null}),[]);
  assert.deepEqual(targetUnicode(undefined),[]);
});
test('overall completion counts mastered objects, not partially earned streaks or mean core percentages', () => {
  const data = {levels:[{total:10,mastered:10},{total:90,mastered:0}]} as ParsingDiagnostics;
  assert.deepEqual(completion(data),{total:100,done:10,percent:10});
  assert.deepEqual(completion({levels:[]} as unknown as ParsingDiagnostics),{total:0,done:0,percent:0});
});
test('technical sections start collapsed and have native keyboard disclosure', () => {
  const html = renderToStaticMarkup(createElement(ParserSection,{title:'Details',children:'Evidence'}));
  assert.match(html,/<details/);assert.match(html,/<summary>/);assert.doesNotMatch(html,/open=""/);
});
test('current word highlighting preserves span validation for Telugu and refuses repeated guesses', () => {
  const evidence = matchedWordEvidence({word:'నేను'},'నేను ఇక్కడ');
  assert.equal(evidence.word,'నేను');assert.deepEqual(evidence.parts,['','నేను',' ఇక్కడ']);
  assert.equal(matchedWordEvidence({word:'నేను'},'నేను నేను').parts,null);
});
