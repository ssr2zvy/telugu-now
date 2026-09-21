import assert from 'node:assert/strict';
import test from 'node:test';
import { ReaderTaps, READER_DOUBLE_TAP_MS, READER_TRIPLE_TAP_GRACE_MS, readerTapRegions } from '../frontend/src/observation/reader-taps';

test('double taps never run the single-tap action, including between taps', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const actions: string[] = [];
  const openSettings = () => { actions.push('settings'); };
  const taps = new ReaderTaps(() => actions.push('audio'));
  taps.tap('center', 100, 100, openSettings);
  t.mock.timers.tick(READER_DOUBLE_TAP_MS - 1);
  assert.equal(actions.length, 0);
  taps.tap('center', 106, 104, openSettings);
  assert.deepEqual(actions, []);
  t.mock.timers.tick(READER_TRIPLE_TAP_GRACE_MS - 1);
  assert.deepEqual(actions, []);
  t.mock.timers.tick(1);
  assert.deepEqual(actions, ['settings']);
  taps.tap('center', 100, 100, openSettings);
  taps.tap('center', 100, 100, openSettings);
  t.mock.timers.tick(READER_DOUBLE_TAP_MS);
  assert.deepEqual(actions, ['settings', 'settings']);
});

test('a third nearby tap supersedes single and double actions anywhere in the reader', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const actions: string[] = [];
  const taps = new ReaderTaps();
  for (const region of ['back', 'center', 'next']) {
    taps.tap(region, 100, 100, () => actions.push('double'), () => actions.push('single'), () => actions.push('settings'));
    taps.tap(region, 103, 102, () => actions.push('double'), () => actions.push('single'), () => actions.push('settings'));
    taps.tap(region, 101, 104, () => actions.push('double'), () => actions.push('single'), () => actions.push('settings'));
  }
  t.mock.timers.tick(READER_DOUBLE_TAP_MS * 2);
  assert.deepEqual(actions, ['settings', 'settings', 'settings']);
});

test('single taps resolve once and cancelled observation gestures never fire later', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let singles = 0;
  const taps = new ReaderTaps(() => singles++);
  taps.tap('center', 100, 100, () => assert.fail('Not a double tap'));
  t.mock.timers.tick(READER_DOUBLE_TAP_MS);
  assert.equal(singles, 1);
  taps.tap('center', 100, 100, () => assert.fail('Expired taps cannot pair'));
  taps.cancel();
  t.mock.timers.tick(READER_DOUBLE_TAP_MS);
  assert.equal(singles, 1);
});

test('only nearby taps in the same region pair, and navigation doubles do not reveal audio', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const actions: string[] = [];
  const taps = new ReaderTaps(() => actions.push('audio'));
  taps.tap('back', 10, 100, () => actions.push('back'));
  taps.tap('back', 12, 103, () => actions.push('back'));
  t.mock.timers.tick(READER_DOUBLE_TAP_MS);
  assert.deepEqual(actions, ['back']);
  taps.tap('center', 100, 100, () => assert.fail('Different regions'));
  assert.equal(taps.matches('next', 110, 100), false);
  assert.equal(taps.matches('center', 100, 200), false);
  taps.cancel();
});

test('single and double hitboxes use independent screen thirds, not the text width', () => {
  const bounds = { left: 20, top: 10, width: 900, height: 600 };
  assert.deepEqual(readerTapRegions(100, 100, bounds), { single: 'playback', double: 'back' });
  assert.deepEqual(readerTapRegions(450, 200, bounds), { single: 'playback', double: 'center' });
  assert.deepEqual(readerTapRegions(800, 400, bounds), { single: 'playback', double: 'next' });
  assert.deepEqual(readerTapRegions(100, 410, bounds), { single: 'controls', double: 'back' });
  assert.deepEqual(readerTapRegions(450, 550, bounds), { single: 'controls', double: 'center' });
  assert.deepEqual(readerTapRegions(800, 550, bounds), { single: 'controls', double: 'next' });
});

test('a double crossing the bottom-third boundary never plays or toggles the bar', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const actions: string[] = [];
  const taps = new ReaderTaps();
  taps.tap('center', 300, 395, () => actions.push('settings'), () => actions.push('playback'));
  t.mock.timers.tick(150);
  assert.equal(actions.length, 0);
  taps.tap('center', 300, 410, () => actions.push('settings'), () => actions.push('controls'));
  t.mock.timers.tick(READER_DOUBLE_TAP_MS);
  taps.tap('center', 300, 395, () => actions.push('settings'), () => actions.push('playback'));
  taps.tap('center', 300, 410, () => actions.push('settings'), () => actions.push('controls'));
  t.mock.timers.tick(READER_DOUBLE_TAP_MS);
  assert.deepEqual(actions, ['settings', 'settings']);
});

test('taps crossing horizontal or visible-word hitboxes do not form a double', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const actions: string[] = [];
  const taps = new ReaderTaps(() => actions.push('single'));
  taps.tap('back', 298, 100, () => actions.push('back'));
  taps.tap('center', 302, 100, () => actions.push('settings'));
  t.mock.timers.tick(READER_DOUBLE_TAP_MS);
  taps.tap('center', 302, 100, () => actions.push('settings'));
  taps.tap('word:example', 303, 100, () => actions.push('image'));
  t.mock.timers.tick(READER_DOUBLE_TAP_MS);
  assert.deepEqual(actions, ['single', 'single', 'single', 'single']);
});

test('separate singles wait their whole window and preserve their own action', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const actions: string[] = [];
  const taps = new ReaderTaps();
  taps.tap('center', 300, 100, () => assert.fail('double'), () => actions.push('playback'));
  t.mock.timers.tick(100);
  taps.tap('center', 300, 550, () => assert.fail('double'), () => actions.push('controls'));
  assert.equal(actions.length, 0);
  t.mock.timers.tick(300);
  assert.deepEqual(actions, ['playback']);
  t.mock.timers.tick(100);
  assert.deepEqual(actions, ['playback', 'controls']);
});
