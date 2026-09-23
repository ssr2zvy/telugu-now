import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {settingsGroups, parentSettingsPage, exportFormatForPage, visibleSettingsEntries} from '../frontend/src/settings/navigation';
import {SettingsShell} from '../frontend/src/settings/SettingsShell';
import {ExportPage} from '../frontend/src/settings/pages/ExportPage';
import type { DisplayObservation } from '../shared/contracts';
import type { ParsingDiagnostics } from '../shared/parsing-diagnostics';
import { matchedWordEvidence } from '../frontend/src/settings/pages/SelectedWordMatch';
import { ParsingStatus } from '../frontend/src/settings/pages/ParsingStatus';
import { DiagnosticsDownloadPage } from '../frontend/src/settings/pages/DiagnosticsDownloadPage';
import {ParserDiagnosticsPage} from '../frontend/src/settings/pages/ParserDiagnosticsPage';

test('Observations and External expose the requested pages without legacy sampling controls', () => {
  assert.equal(settingsGroups.observations,undefined);
  assert.deepEqual(settingsGroups.diagnostic,['parsingMode','diagnosticsDownload','queue','dataSources','blacklist','reset']);
  assert.ok(!settingsGroups.index?.includes('parsingMode'));
  assert.ok(settingsGroups.index?.includes('diagnostic'));
  assert.deepEqual(settingsGroups.external, ['epubExport','htmlExport','archiveExport','archiveImport']);
  assert.equal(parentSettingsPage('diagnosticsDownload'), 'diagnostic');
  assert.equal(parentSettingsPage('diagnostic'), 'index');
  assert.equal(parentSettingsPage('archiveImport'), 'external');
  const pages = Object.values(settingsGroups).flat();
  for (const old of ['sampling','questions','complexity','sources','frequencyExport']) assert.ok(!pages.includes(old as never));
  assert.ok(!visibleSettingsEntries('index',false).includes('grammarMigration'));
  assert.ok(!visibleSettingsEntries('index',true).includes('grammarMigration'));
});

test('side menu also hides the temporary worker when disabled and has no old controls', () => {
  const markup = renderToStaticMarkup(createElement(SettingsShell, {
    page:'external',language:'en',title:'External',profileCode:'001',migrationAvailable:false,
    onNavigate:()=>{},onOverview:()=>{},onClose:()=>{},onToggleLanguage:()=>{},children:null,
  }));
  for (const label of ['Observations &amp; diagnostics','Download full diagnostics','External','EPUB Export','HTML Export','App Archive Export','App Archive Import','Data Sources','Reset Queue']) assert.ok(markup.includes(label));
  assert.doesNotMatch(markup, /Grammar Migration|Source Weights|>Sampling<|Frequency Export/);
});

test('each export destination uses its chosen format without a format chooser', () => {
  assert.deepEqual(exportFormatForPage, {epubExport:'epub',htmlExport:'html',archiveExport:'app-archive'});
  for (const format of Object.values(exportFormatForPage)) {
    const markup = renderToStaticMarkup(createElement(ExportPage, {
      language:'en',format,count:'10',exporting:false,phase:'selecting',error:false,
      preparedArtifact:{format,blob:new Blob(['test']),fileName:'test',entryCount:10},
      onCountChange:()=>{},onRequestExport:()=>{},
    }));
    assert.doesNotMatch(markup, /<dialog|Choose export format/);
    assert.ok(markup.includes(format==='epub'?'EPUB':format==='html'?'HTML':'App Archive'));
    assert.ok(markup.includes('Download'));
  }
});

const observation=(target:Record<string,unknown>)=>({id:'o1',sourceId:'s',sourceKey:'k',text:'ఇది అది అది',grammar:{target,result:null}} as DisplayObservation);
test('current match highlights the saved occurrence and explains other words were not checked', () => {
  const markup=renderToStaticMarkup(createElement(ParserDiagnosticsPage,{profileCode:'001',language:'en',observation:observation({
    policy:'frequency-word-cache-v1',targetId:'A',label:'That',word:'అది',core:1,parseSource:'cached-parse',
    wordSelection:'shortest-codepoints-v1',observationSelection:{policy:'core1-shortest-five-v1',poolSize:5,length:12},occurrence:{original_token:'అది',start_offset:8,end_offset:11},
    matchedTargets:[{id:'A',label:'That'},{id:'B',label:'It'}],
  })}));
  assert.match(markup,/ఇది అది <mark[^>]*>అది<\/mark>/);
  assert.match(markup,/saved word parse was reused/);assert.match(markup,/not checked for this selection/);
  assert.match(markup,/also matched: It/);assert.match(markup,/chosen randomly from the 5 shortest usable observations/);
  assert.doesNotMatch(markup,/Build the grammar database|Plain vocabulary|No saved parser details/);
});
test('old target-only records say evidence is missing, not loading or failure',()=>{
  const markup=renderToStaticMarkup(createElement(ParserDiagnosticsPage,{profileCode:'001',language:'en',observation:observation({targetId:'VOC:meaning_they'})}));
  assert.match(markup,/did not save which word matched/);assert.match(markup,/cannot be recovered from the object name/);
  assert.doesNotMatch(markup,/<mark/);
});
test('Unicode spans are validated and repeated words without offsets are never guessed',()=>{
  const sentence='😀 అది అదే';
  assert.deepEqual(matchedWordEvidence({word:'అది',occurrence:{start_offset:3,end_offset:6}},sentence).parts,['😀 ','అది',' అదే']);
  assert.deepEqual(matchedWordEvidence({occurrence:{token_surface:'అది',start_cp:2,end_cp:5}},sentence).parts,['😀 ','అది',' అదే']);
  assert.equal(matchedWordEvidence({word:'అది',occurrence:{start_offset:999,end_offset:1002}},'అది అది').parts,null);
  assert.equal(matchedWordEvidence({targetId:'VOC:meaning_they'},sentence).word,'');
});
test('parser readiness is separate from queued audio preparation and loading',()=>{
  const data={selectionPolicy:'shortest-codepoints-v1',worker:{phase:'ready',error:null},activity:{phase:'ready',target:null,checked:0,error:null},
    queue:{depth:3,pending:0,preparing:3,ready:0,failed:0,errors:[]},targets:[]} as unknown as ParsingDiagnostics;
  const render=()=>renderToStaticMarkup(createElement(ParsingStatus,{data}));
  assert.match(render(),/Parser: loaded and ready/);assert.match(render(),/0 next questions ready/);assert.match(render(),/Audio preparation is a separate step/);
  data.worker.phase='loading-parser';data.activity.phase='searching';assert.match(render(),/loading rules/);assert.doesNotMatch(render(),/Searching for the shortest/);
  data.worker.phase='ready';data.activity.phase='blocked';assert.match(render(),/This is not loading/);
  data.activity.phase='searching';data.targets=[{id:'A',label:'They'} as ParsingDiagnostics['targets'][number]];data.activity.target='A';assert.match(render(),/shortest matching word for They/);
});

test('dedicated download includes all recorded history with no row limit',()=>{
  const markup=renderToStaticMarkup(createElement(DiagnosticsDownloadPage,{profileCode:'001'}));
  assert.match(markup,/no date or row limit/);assert.match(markup,/all sessions/);
  assert.match(markup,/href="\/api\/profiles\/001\/parsing\/diagnostics\/export"/);
});
