import assert from 'node:assert/strict';
import test from 'node:test';
import { initialNavigationFeedback as initial, synchronizeNavigationFeedback as sync, finishNavigationFeedback as finish } from '../frontend/src/observation/navigation-feedback';
const next = (sequence: number) => ({ sequence, direction: 'next' as const });

test('parent expiry does not dismiss an arrow while loading', () => {
  const loading = sync(initial, 'a', next(1), false);
  assert.equal(sync(loading, 'a', null, false), loading);
  assert.equal(finish(loading, loading.generation), loading);
  const ready = sync(loading, 'a', null, true);
  assert.equal(ready.finished, false);
  assert.equal(finish(ready, ready.generation).finished, true);
});
test('fast navigation invalidates the previous animation and fallback', () => {
  let state = sync(initial, 'a', next(1), true);
  const firstGeneration = state.generation;
  for (let sequence = 2; sequence <= 30; sequence++) {
    const oldGeneration = state.generation;
    state = sync(state, 'a', next(sequence), true);
    assert.equal(finish(state, oldGeneration), state);
    assert.equal(state.finished, false);
  }
  assert.equal(finish(state, firstGeneration), state);
  assert.equal(finish(state, state.generation).finished, true);
});
test('readiness interruption restarts the full animation generation', () => {
  const ready = sync(initial, 'a', next(1), true);
  const loading = sync(ready, 'a', null, false);
  const resumed = sync(loading, 'a', null, true);
  assert.equal(finish(resumed, ready.generation), resumed);
  assert.equal(resumed.finished, false);
  assert.equal(finish(resumed, resumed.generation).finished, true);
});
test('completion does not replay an event still retained by the parent', () => {
  const state = sync(initial, 'a', next(1), true);
  const done = finish(state, state.generation);
  assert.equal(sync(done, 'a', next(1), true), done);
  assert.equal(sync(done, 'a', null, true), done);
});
test('profile switch discards the old arrow and ignores stale completion', () => {
  const old = sync(initial, 'a', next(1), true);
  const fresh = sync(old, 'b', null, true);
  assert.equal(fresh.event, null);
  assert.equal(fresh.finished, true);
  assert.equal(finish(fresh, old.generation), fresh);
});
