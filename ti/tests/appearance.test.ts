import assert from 'node:assert/strict';
import test from 'node:test';
import { appearanceSurface, parseAppearance, randomAppearanceColors } from '../frontend/src/appearance';
import { chooseRandomObservationFont, preferredObservationFontSizePx, OBSERVATION_FONTS } from '../frontend/src/presentation';
import { parentSettingsPage, settingsGroups } from '../frontend/src/settings/navigation';

test('appearance validates persisted data and keeps a nonempty font pool', () => {
  assert.deepEqual(parseAppearance({ fonts: [] }).fonts, [...OBSERVATION_FONTS]);
  assert.deepEqual(parseAppearance({ fonts: ['Mandali', 'unknown'] }).fonts, ['Mandali']);
  assert.equal(parseAppearance({ fontScale: 900 }).fontScale, 100);
  assert.equal(parseAppearance({ fontScale: NaN }).fontScale, 50);
  assert.equal(parseAppearance({ foreground: 'url(bad)' }).foreground, '#171717');
  assert.equal(parseAppearance({ gradient: ['#ffffff'] }).gradient.length, 3);
  assert.equal(randomAppearanceColors(() => 0).gradient.length, 3);
});

test('font selection respects exclusions and size scale preserves the content relationship', () => {
  assert.equal(chooseRandomObservationFont(() => 0.99, ['Mandali']), 'Mandali');
  assert.ok(chooseRandomObservationFont(() => 0, []));
  const short = 'తెలుగు భాష';
  assert.ok(preferredObservationFontSizePx(short, 600, 600, 100) > preferredObservationFontSizePx(short, 600, 600, 0));
  assert.ok(preferredObservationFontSizePx(short, 600, 600, 80) > preferredObservationFontSizePx(short.repeat(20), 600, 600, 80));
});

test('surface colors migrate to automatic and custom colors remain independent of the gradient', () => {
  assert.equal(parseAppearance({}).surface, null);
  assert.equal(parseAppearance({ surface: 'url(bad)' }).surface, null);
  assert.equal(appearanceSurface(parseAppearance({ foreground: '#171717' })), '#f8f9fa');
  assert.equal(appearanceSurface(parseAppearance({ foreground: '#ffffff' })), '#191b1d');
  const custom = parseAppearance({ surface: '#e8eeee', gradient: ['#ff0000', '#00ff00', '#0000ff'] });
  assert.equal(appearanceSurface(custom), '#e8eeee');
  assert.equal(appearanceSurface(parseAppearance({ ...custom, ...randomAppearanceColors(() => 0), surface: null })), '#f8f9fa');
});

test('settings leaf pages return to their group and reset remains last', () => {
  assert.equal(parentSettingsPage('complexity'), 'sampling');
  assert.equal(parentSettingsPage('global'), 'diagnostic');
  assert.equal(parentSettingsPage('appearance'), 'display');
  assert.equal(parentSettingsPage('sampling'), 'index');
  assert.equal(settingsGroups.index?.at(-1), 'reset');
});