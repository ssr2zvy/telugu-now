import assert from 'node:assert/strict';
import test from 'node:test';
import { consumeDismissalGesture } from '../frontend/src/observation/audio/dismissal-gesture';

function pointer(type: string, pointerId = 1): Event {
  return Object.assign(new Event(type), { pointerId });
}

test('dismissal consumes a mobile click delayed beyond pointerup without hiding main controls', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const document = new EventTarget();
  consumeDismissalGesture(document, 1);
  document.dispatchEvent(pointer('pointerup'));
  t.mock.timers.tick(300);
  let parentClicks = 0;
  document.addEventListener('click', () => parentClicks++);
  const delayedClick = new Event('click', { cancelable: true });
  document.dispatchEvent(delayedClick);
  assert.equal(delayedClick.defaultPrevented, true);
  assert.equal(parentClicks, 0);
  document.dispatchEvent(pointer('pointerdown'));
  document.dispatchEvent(new Event('click'));
  assert.equal(parentClicks, 1);
});

test('when the browser suppresses dismissal click, the next intentional tap works', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const document = new EventTarget();
  consumeDismissalGesture(document, 1);
  document.dispatchEvent(pointer('pointerup'));
  document.dispatchEvent(pointer('pointerdown', 2));
  document.dispatchEvent(pointer('pointerup', 2));
  const click = new Event('click', { cancelable: true });
  document.dispatchEvent(click);
  assert.equal(click.defaultPrevented, false);
});

test('unrelated pointers do not release the guard and cancellation and expiry clean it up', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const document = new EventTarget();
  consumeDismissalGesture(document, 1);
  document.dispatchEvent(pointer('pointerup', 2));
  const unrelatedClick = new Event('click', { cancelable: true });
  document.dispatchEvent(unrelatedClick);
  assert.equal(unrelatedClick.defaultPrevented, false);
  document.dispatchEvent(pointer('pointercancel', 1));
  document.dispatchEvent(pointer('pointerup', 1));
  const cancelledClick = new Event('click', { cancelable: true });
  document.dispatchEvent(cancelledClick);
  assert.equal(cancelledClick.defaultPrevented, false);

  consumeDismissalGesture(document, 3);
  document.dispatchEvent(pointer('pointerup', 3));
  t.mock.timers.tick(1500);
  const expiredClick = new Event('click', { cancelable: true });
  document.dispatchEvent(expiredClick);
  assert.equal(expiredClick.defaultPrevented, false);
});
