import assert from 'node:assert/strict';
import test from 'node:test';
import { ReaderTaps, READER_DOUBLE_TAP_MS } from '../frontend/src/observation/reader-taps';

test('double taps never run the single-tap action, including between taps', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const actions: string[] = [];
  const taps = new ReaderTaps(() => actions.push('audio'));
  taps.tap('center', 100, 100, () => actions.push('settings'));
  t.mock.timers.tick(READER_DOUBLE_TAP_MS - 1);
  assert.equal(actions.length, 0);
  taps.tap('center', 106, 104, () => actions.push('settings'));
  assert.deepEqual(actions, ['settings']);
  t.mock.timers.tick(READER_DOUBLE_TAP_MS);
  assert.deepEqual(actions, ['settings']);
  taps.tap('center', 100, 100, () => actions.push('settings'));
  taps.tap('center', 100, 100, () => actions.push('settings'));
  assert.deepEqual(actions, ['settings', 'settings']);
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
