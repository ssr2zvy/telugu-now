import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { OrganizedAppearancePage } from '../frontend/src/settings/pages/OrganizedAppearancePage';
import { SettingsNavigationMemory } from '../frontend/src/settings/settings-memory';
import { appearanceGroups, type AppearancePage } from '../frontend/src/settings/appearance-navigation';
import { DEFAULT_APPEARANCE, parseAppearance } from '../shared/appearance';
import { randomAppearanceColors } from '../frontend/src/appearance';

const renderPage = (page: AppearancePage) => renderToStaticMarkup(createElement(OrganizedAppearancePage, {
  language: 'en', page, font: 'Mandali', onNavigate() {}, onFont() {},
}));

test('closing settings keeps its leaf and back stack for the same observation', () => {
  const memory = new SettingsNavigationMemory();
  memory.open('profile', 'observation-a');
  for (const page of ['display','appearance','appearanceModifications','appearanceModificationColor','appearanceModificationColorWheel'] as const) memory.enter(page);
  assert.equal(memory.open('profile', 'observation-a'), 'appearanceModificationColorWheel');
  assert.equal(memory.back(), 'appearanceModificationColor');
  assert.equal(memory.open('profile', 'observation-a'), 'appearanceModificationColor');
  assert.equal(memory.back(), 'appearanceModifications');
  assert.equal(memory.open('profile', 'observation-b'), 'index');
  assert.equal(memory.back(), 'index');
  memory.enter('dataSources');
  memory.enter('dataSourceDetail');
  assert.equal(memory.open('profile', 'observation-b'), 'dataSourceDetail');
  assert.equal(memory.back(), 'dataSources');
  assert.equal(memory.open('other-profile', 'observation-b'), 'index');
});

test('overview explicitly resets navigation while repeated opens do not', () => {
  const memory = new SettingsNavigationMemory();
  memory.open('profile', 'observation');
  memory.enter('nextChainSearch');
  memory.enter('searchAttempt');
  assert.equal(memory.open('profile', 'observation'), 'searchAttempt');
  assert.equal(memory.overview(), 'index');
  assert.equal(memory.back(), 'index');
});

test('appearance groups contain page links and defer controls to leaf pages', () => {
  for (const page of ['appearance','appearanceBackground','appearanceBackgroundColors','appearanceText','appearanceModifications','appearanceAudio','appearanceAudioPosition','appearanceSpacing','appearanceBehavior','appearanceSurfaces','appearanceFonts'] as const) {
    const html = renderPage(page);
    assert.match(html, /<nav/);
    assert.doesNotMatch(html, /<input|<details|<summary/, page);
  }
  assert.match(renderPage('appearanceHighlightEnabled'), /role="switch"/);
  assert.match(renderPage('appearanceSize'), /type="range"/);
  assert.match(renderPage('appearanceFont'), /Mandali/);
  assert.match(renderPage('appearanceFont'), /role="switch"/);
});

test('each color page offers presets and opens a separate color wheel page', () => {
  for (const page of ['appearanceBackground1','appearanceBackground2','appearanceBackground3','appearanceForeground','appearanceModificationColor','appearanceSurfaceColor'] as const) {
    const html = renderPage(page);
    assert.match(html, /aria-pressed/);
    assert.match(html, /Color wheel/);
    assert.doesNotMatch(html, /Automatic|type="color"/);
    const wheel = appearanceGroups[page]![0]!;
    assert.match(renderPage(wheel), /type="color"/);
  }
  assert.match(renderPage('appearanceModificationColor'), /aria-pressed="true"[^]*?Near/);
});

test('the new default migrates the previous neutral default without overriding custom colors', () => {
  assert.equal(parseAppearance({ foreground: '#171717' }).foreground, '#34304a');
  assert.equal(parseAppearance({ foreground: '#123456' }).foreground, '#123456');
  assert.equal(parseAppearance({ foreground: '#171717', foregroundDefaultVersion: 2 }).foreground, '#171717');
  assert.deepEqual(parseAppearance(JSON.parse(JSON.stringify(DEFAULT_APPEARANCE))), DEFAULT_APPEARANCE);
  for (const color of [DEFAULT_APPEARANCE.foreground, ...Array.from({length:5},(_,index)=>randomAppearanceColors(()=>index/5).foreground)]) {
    const channels = [1,3,5].map(offset=>parseInt(color.slice(offset,offset+2),16));
    assert.ok(Math.max(...channels)-Math.min(...channels)>=10, `${color} must be tinted`);
    assert.ok(Math.min(...channels)>30 && Math.max(...channels)<240, `${color} must avoid black/white extremes`);
  }
});
