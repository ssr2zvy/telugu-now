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
import { CurrentSearch } from '../frontend/src/settings/pages/CurrentSearch';
import { SelectedWordMatch } from '../frontend/src/settings/pages/SelectedWordMatch';
import { DiagnosticsDownloadPage } from '../frontend/src/settings/pages/DiagnosticsDownloadPage';
import {ParserDiagnosticsPage} from '../frontend/src/settings/pages/ParserDiagnosticsPage';

test('Observations and External expose the requested pages without legacy sampling controls', () => {
  assert.deepEqual(settingsGroups.observations,['parser','parsingMode','dataSources']);
  assert.deepEqual(settingsGroups.diagnostic,['objectCoverage','searchAndParse','cycleHistory','parserEvents','parserDetails']);
  assert.ok(!settingsGroups.index?.includes('parsingMode'));
  assert.ok(settingsGroups.index?.includes('observations'));
  assert.deepEqual(settingsGroups.external, ['epubExport','htmlExport','archiveExport','archiveImport']);
  assert.equal(parentSettingsPage('diagnosticsDownload'), 'parserEvents');
  assert.equal(parentSettingsPage('diagnostic'), 'parser');
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
  for (const label of ['Observations','Next chain search','External','EPUB Export','HTML Export','App Archive Export','App Archive Import','Data Sources','Reset']) assert.ok(markup.includes(label));
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
  const markup=renderToStaticMarkup(createElement(SelectedWordMatch,{observation:observation({
    policy:'frequency-word-cache-v1',targetId:'A',label:'That',word:'అది',core:1,parseSource:'cached-parse',
    wordSelection:'shortest-codepoints-v1',observationSelection:{policy:'core1-shortest-five-v1',poolSize:5,length:12},occurrence:{original_token:'అది',start_offset:8,end_offset:11},
    matchedTargets:[{id:'A',label:'That'},{id:'B',label:'It'}],
  })}));
  assert.match(markup,/ఇది అది <mark[^>]*>అది<\/mark>/);
  assert.match(markup,/>Reused</);assert.match(markup,/Only the selected word was checked/);
  assert.match(markup,/Random among 5 shortest/);
  assert.doesNotMatch(markup,/Build the grammar database|Plain vocabulary|No saved parser details/);
});
test('old target-only records say evidence is missing, not loading or failure',()=>{
  const markup=renderToStaticMarkup(createElement(SelectedWordMatch,{observation:observation({targetId:'VOC:meaning_they'})}));
  assert.match(markup,/Not recorded/);
  assert.doesNotMatch(markup,/<mark/);
});
test('Unicode spans are validated and repeated words without offsets are never guessed',()=>{
  const sentence='😀 అది అదే';
  assert.deepEqual(matchedWordEvidence({word:'అది',occurrence:{start_offset:3,end_offset:6}},sentence).parts,['😀 ','అది',' అదే']);
  assert.deepEqual(matchedWordEvidence({occurrence:{token_surface:'అది',start_cp:2,end_cp:5}},sentence).parts,['😀 ','అది',' అదే']);
  assert.equal(matchedWordEvidence({word:'అది',occurrence:{start_offset:999,end_offset:1002}},'అది అది').parts,null);
  assert.equal(matchedWordEvidence({targetId:'VOC:meaning_they'},sentence).word,'');
});
test('current search uses the three explicit worker states and links to attempt pages',()=>{
  const data={worker:{phase:'idle',error:null},activity:{phase:'ready',error:null},queue:{errors:[]},targets:[],guider:{generating:false},chainSearches:[]} as unknown as ParsingDiagnostics;
  const render=()=>renderToStaticMarkup(createElement(CurrentSearch,{data,onNavigate:()=>{},onAttempt:()=>{}}));
  assert.match(render(),/No chain to generate/);assert.match(render(),/No core in queue to search/);assert.match(render(),/No searches to parse/);
  data.guider={generating:true,cycleId:'c'};
  data.targets=[{id:'A',forms:['అది'],pattern:null} as ParsingDiagnostics['targets'][number]];
  data.chainSearches=[{id:'c',core:1,endedAt:null,endReason:null,searches:[{id:'s',cycleId:'c',targetId:'A',core:1,startedAt:1,endedAt:null,checked:0,returned:4,examined:0,parsed:0,matching:0,reused:0,outcome:null,word:null,stage:'parsing',searchSucceeded:true,error:null}]}];
  assert.match(render(),/Generating chain/);assert.match(render(),/Searching core 1 · అది/);assert.match(render(),/Parsing searches/);assert.doesNotMatch(render(),/<details/);
});

test('dedicated download includes all recorded history with no row limit',()=>{
  const markup=renderToStaticMarkup(createElement(DiagnosticsDownloadPage,{profileCode:'001'}));
  assert.match(markup,/No date or row limit/);assert.match(markup,/across every session/);
  assert.match(markup,/href="\/api\/profiles\/001\/parsing\/diagnostics\/export"/);
});
