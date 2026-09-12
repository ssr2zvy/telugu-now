import assert from 'node:assert/strict';
import test from 'node:test';
import { appearanceAudioColor, appearanceAudioGlass, appearanceCornerColor, appearanceSurface, DEFAULT_APPEARANCE, parseAppearance, randomAppearanceColors } from '../frontend/src/appearance';
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

test('appearance positions preserve existing baselines and validate persisted offsets', () => {
  const previous = parseAppearance({ fontScale: 75 });
  assert.equal(previous.textOffset, 0);
  assert.equal(previous.audioOffset, 0);
  assert.equal(previous.magnifierPosition, 'below');
  assert.equal(parseAppearance({ magnifierPosition: 'above' }).magnifierPosition, 'above');
  const custom = parseAppearance({ textOffset: -35, audioOffset: 60, magnifierPosition: 'below' });
  assert.equal(custom.textOffset, -35);
  assert.equal(custom.audioOffset, 60);
  assert.equal(custom.magnifierPosition, 'below');
  assert.equal(parseAppearance({ textOffset: -999 }).textOffset, -200);
  assert.equal(parseAppearance({ audioOffset: 999 }).audioOffset, 200);
  assert.equal(parseAppearance({ textOffset: 12.6 }).textOffset, 13);
  for (const invalid of [null, '20', NaN, Infinity, -Infinity]) {
    assert.equal(parseAppearance({ textOffset: invalid, audioOffset: invalid }).textOffset, 0);
    assert.equal(parseAppearance({ textOffset: invalid, audioOffset: invalid }).audioOffset, 0);
    assert.equal(parseAppearance({ magnifierPosition: invalid }).magnifierPosition, 'below');
  }
});

test('audio controls derive their shared color from the gradient, not text or settings surfaces', () => {
  const color = appearanceAudioColor(DEFAULT_APPEARANCE);
  assert.match(color, /^#[0-9a-f]{6}$/);
  assert.equal(appearanceAudioColor({ ...DEFAULT_APPEARANCE, ...parseAppearance({ foreground: '#ffffff', surface: '#ff0000' }) }), color);
  assert.notEqual(appearanceAudioColor(parseAppearance(randomAppearanceColors(() => 0.6))), color);
});

test('audio shades retain palette color even when complementary gradient colors average to gray', () => {
  for (const gradient of [
    ['#cc5577', '#55cc77', '#7755cc'],
    ['#ff0000', '#00ff00', '#0000ff'],
    ['#344a44', '#56515e', '#354452'],
  ]) {
    const color = appearanceAudioColor(parseAppearance({ gradient }));
    const channels = [1, 3, 5].map(offset => parseInt(color.slice(offset, offset + 2), 16));
    assert.ok(Math.max(...channels) - Math.min(...channels) > 2, `${color} must retain a gradient hue`);
    assert.ok(!gradient.includes(color), `${color} must be a distinct shade`);
  }
  const neutral = appearanceAudioColor(DEFAULT_APPEARANCE);
  assert.equal(neutral.slice(1, 3), neutral.slice(3, 5));
  assert.equal(neutral.slice(3, 5), neutral.slice(5, 7));
});

test('pastel controls retain endpoint saturation and lie beyond the gradient luminance extremes', () => {
  const gradient = ['#dfe5f2', '#c1c9e0', '#c2dcd0'];
  const channels = (color: string) => [1, 3, 5].map(offset => parseInt(color.slice(offset, offset + 2), 16) / 255);
  const saturation = (color: string) => {
    const rgb = channels(color);
    const max = Math.max(...rgb);
    const min = Math.min(...rgb);
    return (max - min) / (1 - Math.abs(max + min - 1));
  };
  const luminance = (color: string) => channels(color)
    .map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
    .reduce((total, channel, index) => total + channel * [0.2126, 0.7152, 0.0722][index]!, 0);
  const shade = appearanceAudioColor(parseAppearance({ gradient }));
  assert.ok(Math.abs(saturation(shade) - saturation('#c1c9e0')) < 0.02, `${shade} must not desaturate the blue endpoint`);
  assert.ok(Math.max(...channels(shade)) - Math.min(...channels(shade)) > 0.2, `${shade} should be visibly colored`);
  for (const palette of [gradient, ...Array.from({ length: 5 }, (_, index) => randomAppearanceColors(() => index / 5).gradient)]) {
    const value = luminance(appearanceAudioColor(parseAppearance({ gradient: palette })));
    assert.ok(value < Math.min(...palette.map(luminance)) || value > Math.max(...palette.map(luminance)));
  }
});

test('glass controls use broad palette transitions without a repeated specular stripe', () => {
  const palette = parseAppearance({ gradient: ['#dfe5f2', '#c1c9e0', '#c2dcd0'] });
  const glass = appearanceAudioGlass(palette);
  assert.equal(glass.stops.length, 3);
  assert.ok(new Set(glass.stops.map(stop => stop.color)).size >= 3);
  assert.deepEqual(glass.stops.map(stop => stop.offset), [0, 0.5, 1]);
  for (const stop of glass.stops) {
    assert.match(stop.color, /^#[0-9a-f]{6}$/);
    assert.ok(stop.opacity > 0 && stop.opacity < 1);
    assert.ok(glass.gradient.includes(`${stop.color}${Math.round(stop.opacity * 255).toString(16)}`));
  }
  assert.equal(new Set(glass.stops.map(stop => stop.opacity)).size, 1);
  assert.ok(glass.stops.every(stop => stop.opacity < 0.7));
  assert.match(glass.edge, /^#[0-9a-f]{8}$/);
  assert.deepEqual(appearanceAudioGlass(parseAppearance({ ...palette, foreground: '#ff0000', surface: '#000000' })), glass);
  assert.notDeepEqual(appearanceAudioGlass(DEFAULT_APPEARANCE), glass);
});

test('appearance auto-fade delay defaults to 15 seconds and validates saved values', () => {
  assert.equal(parseAppearance({ fontScale: 75 }).autoFadeSeconds, 15);
  assert.equal(parseAppearance({ autoFadeSeconds: 5 }).autoFadeSeconds, 5);
  assert.equal(parseAppearance({ autoFadeSeconds: 30 }).autoFadeSeconds, 30);
  assert.equal(parseAppearance({ autoFadeSeconds: 0 }).autoFadeSeconds, 1);
  assert.equal(parseAppearance({ autoFadeSeconds: -10 }).autoFadeSeconds, 1);
  assert.equal(parseAppearance({ autoFadeSeconds: 999 }).autoFadeSeconds, 60);
  assert.equal(parseAppearance({ autoFadeSeconds: 5.7 }).autoFadeSeconds, 6);
  for (const invalid of [null, undefined, '5', NaN, Infinity, -Infinity]) {
    assert.equal(parseAppearance({ autoFadeSeconds: invalid }).autoFadeSeconds, 15);
  }
});

test('surface colors remain independent while corner colors adapt to palette and contrast', () => {
  assert.equal(parseAppearance({}).surface, null);
  assert.equal(parseAppearance({ surface: 'url(bad)' }).surface, null);
  assert.equal(appearanceSurface(parseAppearance({ foreground: '#171717' })), '#f8f9fa');
  assert.equal(appearanceSurface(parseAppearance({ foreground: '#ffffff' })), '#191b1d');
  const custom = parseAppearance({ surface: '#e8eeee', gradient: ['#ff0000', '#00ff00', '#0000ff'] });
  assert.equal(appearanceSurface(custom), '#e8eeee');
  assert.equal(appearanceSurface(parseAppearance({ ...custom, ...randomAppearanceColors(() => 0), surface: null })), '#f8f9fa');
  const relativeLuminance = (color: string) => [1, 3, 5].map(offset => parseInt(color.slice(offset, offset + 2), 16) / 255)
    .map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
    .reduce((total, channel, index) => total + channel * [0.2126, 0.7152, 0.0722][index]!, 0);
  const contrast = (first: string, second: string) => {
    const levels = [relativeLuminance(first), relativeLuminance(second)];
    return (Math.max(...levels) + 0.05) / (Math.min(...levels) + 0.05);
  };
  for (const appearance of [
    DEFAULT_APPEARANCE,
    ...Array.from({ length: 5 }, (_, index) => parseAppearance(randomAppearanceColors(() => index / 5))),
    parseAppearance({ gradient: ['#ffffff', '#ffffff', '#ffffff'], foreground: '#ffffff' }),
    parseAppearance({ gradient: ['#000000', '#000000', '#000000'], foreground: '#000000' }),
  ]) {
    const corner = appearanceCornerColor(appearance);
    assert.match(corner, /^#[0-9a-f]{6}$/);
    assert.equal(appearanceCornerColor(appearance), corner);
    assert.ok(contrast(corner, appearance.foreground) >= 1.2, `${corner} must differ visibly from text`);
    assert.ok(contrast(corner, appearanceAudioColor(appearance)) >= 1.2, `${corner} must differ visibly from audio`);
    for (const background of appearance.gradient) {
      assert.ok(contrast(corner, background) >= 3, `${corner} must contrast with ${background}`);
    }
  }
  const neutral = appearanceCornerColor(DEFAULT_APPEARANCE);
  assert.equal(neutral.slice(1, 3), neutral.slice(3, 5));
  assert.equal(neutral.slice(3, 5), neutral.slice(5, 7));
  assert.notEqual(appearanceCornerColor(parseAppearance(randomAppearanceColors(() => 0.6))), neutral);
  assert.equal(appearanceCornerColor({ ...DEFAULT_APPEARANCE, ...parseAppearance({ surface: '#ff0000' }) }), neutral);
  const extreme = parseAppearance({ gradient: ['#000000', '#ffffff', '#777777'] });
  assert.match(appearanceCornerColor(extreme), /^#[0-9a-f]{6}$/);
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