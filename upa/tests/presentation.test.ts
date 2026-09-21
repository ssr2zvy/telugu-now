import assert from 'node:assert/strict';
import test from 'node:test';
import {
  OBSERVATION_FONTS,
  OBSERVATION_PRESENTATION,
  chooseRandomObservationFont,
  compatibleObservationFonts,
  fontVerticalCorrectionPx,
  preferredObservationFontSizePx,
} from '../frontend/src/presentation';
test('observation font collection is the fixed curated Telugu set', () => {
  assert.deepEqual(OBSERVATION_FONTS, [
    'Noto Sans Telugu',
    'Noto Serif Telugu',
    'Mandali',
    'Ramabhadra',
    'NTR',
    'Peddana',
    'Ramaraja',
    'Sree Krushnadevaraya',
    'Suranna',
    'Tenali Ramakrishna',
  ]);
  assert.deepEqual(OBSERVATION_PRESENTATION.fonts, OBSERVATION_FONTS);
  assert.equal(OBSERVATION_PRESENTATION.fitIterations, 10);
  assert.equal(OBSERVATION_PRESENTATION.fitMinimumFontSizePx, 12);
  assert.equal(OBSERVATION_PRESENTATION.preferredMinimumFontSizePx, 24);
  assert.equal(OBSERVATION_PRESENTATION.preferredMaximumFontSizePx, 160);
});
test('random font selection maps the full random interval onto the curated collection', () => {
  assert.equal(chooseRandomObservationFont(() => 0), 'Noto Sans Telugu');
  assert.equal(chooseRandomObservationFont(() => 0.099999), 'Noto Sans Telugu');
  assert.equal(chooseRandomObservationFont(() => 0.1), 'Noto Serif Telugu');
  assert.equal(chooseRandomObservationFont(() => 0.999999), 'Tenali Ramakrishna');
});
test('iOS devices use only fonts verified with Safari shaping', () => {
  const iphone = { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', platform: 'iPhone', maxTouchPoints: 5 };
  const ipad = { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)', platform: 'MacIntel', maxTouchPoints: 5 };
  const desktop = { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)', platform: 'MacIntel', maxTouchPoints: 0 };
  assert.deepEqual(compatibleObservationFonts(OBSERVATION_FONTS, iphone), ['Noto Sans Telugu', 'Noto Serif Telugu', 'NTR']);
  assert.deepEqual(compatibleObservationFonts(['Mandali'], ipad), ['Noto Sans Telugu', 'Noto Serif Telugu', 'NTR']);
  assert.deepEqual(compatibleObservationFonts(['Mandali', 'NTR'], iphone), ['Noto Sans Telugu', 'Noto Serif Telugu', 'NTR']);
  assert.deepEqual(compatibleObservationFonts(OBSERVATION_FONTS, desktop), OBSERVATION_FONTS);
});
test('preferred font size decreases smoothly as observation content grows', () => {
  const width = 700;
  const height = 700;
  const short = preferredObservationFontSizePx('తెలుగు', width, height);
  const medium = preferredObservationFontSizePx(
    'తెలుగు భాషలో కొన్ని పదాలు కలిసి ఒక వాక్యంగా కనిపిస్తున్నాయి',
    width,
    height,
  );
  const long = preferredObservationFontSizePx(
    Array.from({ length: 40 }, (_, index) => `పదం${index + 1}`).join(' '),
    width,
    height,
  );
  assert.ok(short > medium);
  assert.ok(medium > long);
  assert.ok(long >= OBSERVATION_PRESENTATION.preferredMinimumFontSizePx);
  assert.ok(short <= OBSERVATION_PRESENTATION.preferredMaximumFontSizePx);
});
test('preferred font size responds to available observation width without buckets', () => {
  const text = 'ఇది ఒక మధ్యస్థ పొడవు గల తెలుగు పరిశీలన వాక్యం';
  const narrow = preferredObservationFontSizePx(text, 240, 700);
  const wide = preferredObservationFontSizePx(text, 900, 700);
  assert.ok(wide > narrow);
});
