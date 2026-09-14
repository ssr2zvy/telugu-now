import assert from 'node:assert/strict';
import test from 'node:test';
import { ReaderTaps, READER_DOUBLE_TAP_MS, readerTapRegions } from '../frontend/src/observation/reader-taps';

test('a run resolves only once it ends, so a double is never mistaken for a triple', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const actions: string[] = [];
  const taps = new ReaderTaps(() => actions.push('audio'));
  taps.tap('center', 100, 100, { onDouble: () => actions.push('settings') });
  t.mock.timers.tick(READER_DOUBLE_TAP_MS - 1);
  assert.equal(actions.length, 0);
  taps.tap('center', 106, 104, { onDouble: () => actions.push('settings') });
  // Still nothing: a third tap could arrive and make this a triple instead.
  assert.equal(actions.length, 0);
  t.mock.timers.tick(READER_DOUBLE_TAP_MS);
  assert.deepEqual(actions, ['settings']);
});

test('three nearby taps run the triple action instead of the double action', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const actions: string[] = [];
  const taps = new ReaderTaps(() => actions.push('audio'));
  const handlers = { onDouble: () => actions.push('double'), onTriple: () => actions.push('settings') };
  taps.tap('center', 100, 100, handlers);
  taps.tap('center', 102, 101, handlers);
  taps.tap('center', 101, 103, handlers);
  t.mock.timers.tick(READER_DOUBLE_TAP_MS);
  assert.deepEqual(actions, ['settings']);
});

test('a lone tap falls back to the constructor single action and cancelling suppresses it', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let singles = 0;
  const taps = new ReaderTaps(() => singles++);
  taps.tap('center', 100, 100, { onDouble: () => assert.fail('Not a double tap') });
  t.mock.timers.tick(READER_DOUBLE_TAP_MS);
  assert.equal(singles, 1);
  taps.tap('center', 100, 100, { onDouble: () => assert.fail('Cancelled taps never resolve') });
  taps.cancel();
  t.mock.timers.tick(READER_DOUBLE_TAP_MS);
  assert.equal(singles, 1);
});

test('a per-tap single action overrides the constructor fallback', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const actions: string[] = [];
  const taps = new ReaderTaps(() => actions.push('audio'));
  taps.tap('center', 300, 550, { onSingle: () => actions.push('controls') });
  t.mock.timers.tick(READER_DOUBLE_TAP_MS);
  assert.deepEqual(actions, ['controls']);
});

test('distant taps start a new run rather than pairing', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const actions: string[] = [];
  const taps = new ReaderTaps(() => actions.push('audio'));
  taps.tap('back', 10, 100, { onDouble: () => actions.push('back') });
  taps.tap('back', 200, 100, { onDouble: () => assert.fail('Too far to pair') });
  t.mock.timers.tick(READER_DOUBLE_TAP_MS);
  // Only the second run survives; the first was superseded before it resolved.
  assert.deepEqual(actions, ['audio']);
});

test('matches only reports taps in the same region and within the pairing distance', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const taps = new ReaderTaps();
  taps.tap('back', 10, 100, { onDouble: () => {} });
  assert.equal(taps.matches('back', 12, 103), true);
  assert.equal(taps.matches('next', 12, 103), false);
  assert.equal(taps.matches('back', 10, 200), false);
  taps.cancel();
  assert.equal(taps.matches('back', 10, 100), false);
});

test('a run keeps the region it started in even when later taps are labelled differently', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const taps = new ReaderTaps();
  taps.tap('back', 298, 100, { onDouble: () => {} });
  taps.tap('word:example', 302, 100, { onDouble: () => {} });
  assert.equal(taps.matches('back', 302, 100), true);
  taps.cancel();
});

test('later handlers in a run merge over earlier ones', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const actions: string[] = [];
  const taps = new ReaderTaps();
  taps.tap('center', 300, 100, { onDouble: () => actions.push('settings') });
  taps.tap('word:example', 303, 100, { onDouble: () => actions.push('image') });
  t.mock.timers.tick(READER_DOUBLE_TAP_MS);
  assert.deepEqual(actions, ['image']);
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
