import assert from 'node:assert/strict';
import test from 'node:test';
import { appearanceSurface, DEFAULT_APPEARANCE, parseAppearance, randomAppearanceColors } from '../frontend/src/appearance';
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

test('the default gradient is lighter neutral grey and preserves custom palettes', () => {
  const previousLevels = [0x9a, 0x70, 0x51];
  DEFAULT_APPEARANCE.gradient.forEach((color, index) => {
    const channels = [color.slice(1, 3), color.slice(3, 5), color.slice(5, 7)];
    assert.equal(channels[0], channels[1]);
    assert.equal(channels[1], channels[2]);
    assert.ok(parseInt(channels[0]!, 16) > previousLevels[index]!);
  });
  assert.deepEqual(parseAppearance(null).gradient, DEFAULT_APPEARANCE.gradient);
  const custom = ['#344a44', '#56515e', '#354452'];
  assert.deepEqual(parseAppearance({ gradient: custom }).gradient, custom);
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

test('non-object persisted appearance values recover all defaults', () => {
  for (const value of [undefined, null, false, 0, 'invalid', []]) {
    assert.deepEqual(parseAppearance(value), DEFAULT_APPEARANCE);
  }
});

test('parsed appearance arrays do not alias persisted settings or shared defaults', () => {
  const persisted = { gradient: ['#112233', '#445566', '#778899'], fonts: ['Mandali'] };
  const parsed = parseAppearance(persisted);
  parsed.gradient[0] = '#abcdef';
  parsed.fonts.push('NTR');
  assert.deepEqual(persisted, { gradient: ['#112233', '#445566', '#778899'], fonts: ['Mandali'] });

  const defaults = parseAppearance(null);
  const expected = structuredClone(DEFAULT_APPEARANCE);
  defaults.gradient[0] = '#abcdef';
  defaults.fonts.pop();
  assert.deepEqual(DEFAULT_APPEARANCE, expected);
  assert.deepEqual(parseAppearance(null), expected);
});

test('gradient validation preserves valid mixed-case hex and rejects malformed palettes atomically', () => {
  const valid = ['#AaBbCc', '#001122', '#DDEEFF'];
  assert.deepEqual(parseAppearance({ gradient: valid }).gradient, valid);
  for (const gradient of [
    ['#112233', '#445566', '#gg7788'],
    ['#112233', '#fff', '#778899'],
    ['#112233', '#445566', '#77889900'],
    ['#112233', '#445566', null],
    [...valid, '#ffffff'],
  ]) {
    assert.deepEqual(parseAppearance({ gradient }).gradient, DEFAULT_APPEARANCE.gradient);
  }
});

test('persisted font pools discard duplicates and unknown fonts in canonical order', () => {
  const fonts = [...OBSERVATION_FONTS].reverse();
  const parsed = parseAppearance({ fonts: [...fonts, fonts[0], 'unknown', fonts[0]] });
  assert.deepEqual(parsed.fonts, [...OBSERVATION_FONTS]);
  assert.equal(new Set(parsed.fonts).size, parsed.fonts.length);
});