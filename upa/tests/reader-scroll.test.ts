import assert from 'node:assert/strict';
import test from 'node:test';
import { ReaderScroll, scrollControlsVisible } from '../frontend/src/observation/reader-scroll';
import { parseAppearance } from '../shared/appearance';

test('scroll mode defaults on for new and legacy appearance settings and preserves opt-out', () => {
  for (const value of [null, {}, { fontScale: 60 }, { scrollMode: 'false' }, { scrollMode: 0 }]) {
    assert.equal(parseAppearance(value).scrollMode, true);
  }
  assert.equal(parseAppearance({ scrollMode: false }).scrollMode, false);
  assert.equal(parseAppearance({ scrollMode: true }).scrollMode, true);
});

test('every horizontal swipe toggles the audio bar regardless of direction', () => {
  assert.equal(scrollControlsVisible(false), true);
  assert.equal(scrollControlsVisible(true), false);
});

test('horizontal swipes fire once, suppress their click, and leave the next intentional tap alone', () => {
  const scroll = new ReaderScroll();
  scroll.begin(1, 100, 100);
  assert.deepEqual(scroll.move(1, 104, 102), { moved: false, handled: false, direction: null });
  assert.deepEqual(scroll.move(1, 120, 102), { moved: true, handled: true, direction: null });
  assert.deepEqual(scroll.move(1, 160, 102), { moved: true, handled: true, direction: 1 });
  assert.equal(scroll.move(1, 200, 102).direction, null);
  assert.equal(scroll.move(1, 20, 102).direction, null);
  scroll.end(1);
  assert.equal(scroll.consumeClick(), true);
  assert.equal(scroll.consumeClick(), false);
  scroll.begin(2, 200, 100);
  assert.equal(scroll.move(2, 100, 100).direction, -1);
  scroll.end(2);
  scroll.newPointer();
  scroll.begin(3, 100, 100);
  scroll.end(3);
  assert.equal(scroll.consumeClick(), false);
});

test('vertical touch swipes reveal audio without changing horizontal desktop gestures', () => {
  const scroll = new ReaderScroll();
  scroll.begin(1, 100, 100);
  assert.deepEqual(scroll.move(1, 104, 120, 'vertical'), { moved: true, handled: true, direction: null });
  assert.deepEqual(scroll.move(1, 104, 160, 'vertical'), { moved: true, handled: true, direction: 1 });
  scroll.end(1);
  scroll.newPointer();
  scroll.begin(2, 100, 200);
  assert.equal(scroll.move(2, 100, 140, 'vertical').direction, -1);
});

test('off-axis drags, cancellation, other pointers, and tiny movements never reveal audio', () => {
  const scroll = new ReaderScroll();
  scroll.begin(1, 100, 100);
  assert.equal(scroll.move(2, 200, 100).direction, null);
  assert.deepEqual(scroll.move(1, 104, 130), { moved: true, handled: false, direction: null });
  assert.equal(scroll.move(1, 250, 130).direction, null);
  scroll.end(1);
  assert.equal(scroll.move(1, 300, 130).direction, null);
  assert.equal(scroll.consumeClick(), true);
  scroll.newPointer();
  scroll.begin(2, 100, 100);
  scroll.move(2, 108, 102);
  scroll.end(2);
  assert.equal(scroll.consumeClick(), false);
  scroll.reset();
  assert.equal(scroll.move(2, 300, 100).direction, null);
});

test('horizontal wheel bursts accumulate intent and momentum cannot reopen a hidden bar', () => {
  const scroll = new ReaderScroll();
  assert.equal(scroll.wheel(20, 0, 0), null);
  assert.equal(scroll.wheel(30, 0, 10), 1);
  assert.equal(scroll.wheel(100, 0, 20), null);
  assert.equal(scroll.wheel(-5, 0, 30), null);
  assert.equal(scroll.wheel(-50, 0, 40), -1);
  assert.equal(scroll.wheel(-100, 0, 50), null);
  assert.equal(scroll.wheel(-50, 0, 300), -1);
  scroll.reset();
  assert.equal(scroll.wheel(60, 0, 310), 1);
});

test('vertical wheel scrolling and invalid deltas do not accumulate horizontal intent', () => {
  const scroll = new ReaderScroll();
  assert.equal(scroll.wheel(30, 0, 0), null);
  assert.equal(scroll.wheel(10, 80, 1), null);
  assert.equal(scroll.wheel(30, 0, 2), null);
  assert.equal(scroll.wheel(NaN, 0, 3), null);
  assert.equal(scroll.wheel(Infinity, 0, 4), null);
  assert.equal(scroll.wheel(30, 0, 5), null);
});
