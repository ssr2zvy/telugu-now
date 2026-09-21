import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {settingsGroups, parentSettingsPage, exportFormatForPage, visibleSettingsEntries} from '../frontend/src/settings/navigation';
import {SettingsShell} from '../frontend/src/settings/SettingsShell';
import {ExportPage} from '../frontend/src/settings/pages/ExportPage';
import {ParserDiagnosticsPage} from '../frontend/src/settings/pages/ParserDiagnosticsPage';

test('Observations and External expose the requested pages without legacy sampling controls', () => {
  assert.deepEqual(settingsGroups.observations, ['diagnostic','dataSources','blacklist','reset']);
  assert.deepEqual(settingsGroups.external, ['epubExport','htmlExport','archiveExport','archiveImport']);
  assert.equal(parentSettingsPage('parser'), 'diagnostic');
  assert.equal(parentSettingsPage('diagnostic'), 'observations');
  assert.equal(parentSettingsPage('archiveImport'), 'external');
  const pages = Object.values(settingsGroups).flat();
  for (const old of ['sampling','questions','complexity','sources','frequencyExport']) assert.ok(!pages.includes(old as never));
  assert.ok(!visibleSettingsEntries('index',false).includes('grammarMigration'));
  assert.ok(visibleSettingsEntries('index',true).includes('grammarMigration'));
});

test('side menu also hides the temporary worker when disabled and has no old controls', () => {
  const markup = renderToStaticMarkup(createElement(SettingsShell, {
    page:'external',language:'en',title:'External',profileCode:'001',migrationAvailable:false,
    onNavigate:()=>{},onOverview:()=>{},onClose:()=>{},onToggleLanguage:()=>{},children:null,
  }));
  for (const label of ['Observations','External','EPUB Export','HTML Export','App Archive Export','App Archive Import','Data Sources','Reset Queue']) assert.ok(markup.includes(label));
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

test('parser diagnostics display saved word analysis without inventing missing historical evidence', () => {
  const markup = renderToStaticMarkup(createElement(ParserDiagnosticsPage, {
    profileCode:'001',language:'en',selected:{categoryLevel:1,targetId:'dative',components:[{kind:'modifier',id:'mod_dative'}],
      occurrence:{token_surface:'మంచానికి',start_cp:0,end_cp:8},parser:{version:'v20_gi_relevance_stemfix_v1',status:'parsed',confidence:'high',eligible:true,giScore:1,baseId:'మంచం',baseType:'dictionary_non_core_base',chain:['mod_dative']}},
  }));
  assert.match(markup, /మంచానికి/); assert.match(markup, /v20_gi_relevance_stemfix_v1/);
  assert.match(markup, /mod_dative/); assert.match(markup, /Plain vocabulary/);
  const historical=renderToStaticMarkup(createElement(ParserDiagnosticsPage,{profileCode:'001',language:'en',selected:null}));
  assert.match(historical,/No saved parser details/);
});
