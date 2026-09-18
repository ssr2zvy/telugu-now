import assert from 'node:assert/strict';
import test from 'node:test';
import { createObservationFontDeck } from '../frontend/src/observation/useObservationFontQueue';
import type { ObservationFontFamily } from '../frontend/src/presentation';

const fonts = ['Noto Sans Telugu', 'Noto Serif Telugu', 'NTR'] as const satisfies readonly ObservationFontFamily[];
const entry = (id: string) => ({ id, text: id });

test('each observation occurrence cycles its own shuffled font order only when revisited', () => {
  let randomCalls = 0;
  const deck = createObservationFontDeck(fonts, () => { randomCalls += 1; return 0; });

  const first = deck.assignments([entry('a'), entry('b')], 'a');
  assert.equal(first[0]!.fontFamily, 'Noto Serif Telugu');
  assert.equal(randomCalls, 4);

  const poll = deck.assignments([entry('a'), entry('b')], 'a');
  assert.equal(poll[0]!.fontFamily, first[0]!.fontFamily);
  assert.equal(randomCalls, 4);

  const away = deck.assignments([entry('b'), entry('a')], 'b');
  assert.equal(away[1]!.fontFamily, 'NTR');
  assert.equal(deck.assignments([entry('a'), entry('b')], 'a')[0]!.fontFamily, 'NTR');
  deck.assignments([entry('b'), entry('a')], 'b');
  assert.equal(deck.assignments([entry('a'), entry('b')], 'a')[0]!.fontFamily, 'Noto Sans Telugu');
  deck.assignments([entry('b'), entry('a')], 'b');
  assert.equal(deck.assignments([entry('a'), entry('b')], 'a')[0]!.fontFamily, 'Noto Serif Telugu');

  deck.assignments([entry('c'), entry('a')], 'c');
  assert.equal(randomCalls, 6);
});