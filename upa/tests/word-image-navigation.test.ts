import assert from 'node:assert/strict';
import test from 'node:test';
import { insertOrderedWordImage, navigateWordImages, orderedWordImages, type WordImageMetadata } from '../frontend/src/observation/word/word-images';

function image(id: string, method: 'generation' | 'source', createdAt: number,
  batchCreatedAt?: number, batchIndex?: number): WordImageMetadata {
  return {
    id, method, createdAt, mimeType: 'image/png', vendor: method === 'generation' ? 'Pollinations' : 'Serper',
    ...(batchCreatedAt === undefined ? {} : { batchCreatedAt }),
    ...(batchIndex === undefined ? {} : { batchIndex }),
  };
}

test('word image navigation loops through one action slot in either direction', () => {
  assert.deepEqual(navigateWordImages({ pane: 'image', index: 2 }, 3, 1), { pane: 'action' });
  assert.deepEqual(navigateWordImages({ pane: 'action' }, 3, 1), { pane: 'image', index: 0 });
  assert.deepEqual(navigateWordImages({ pane: 'image', index: 0 }, 3, -1), { pane: 'action' });
  assert.deepEqual(navigateWordImages({ pane: 'action' }, 3, -1), { pane: 'image', index: 2 });
  assert.deepEqual(navigateWordImages({ pane: 'image', index: 0 }, 1, 1), { pane: 'action' });
  assert.deepEqual(navigateWordImages({ pane: 'action' }, 1, -1), { pane: 'image', index: 0 });
  assert.deepEqual(navigateWordImages({ pane: 'action' }, 0, 1), { pane: 'action' });
});

test('client gallery ordering keeps generations first and searches in batch result order', () => {
  const values = [
    image('search-two', 'source', 31, 30, 2),
    image('generation-two', 'generation', 20),
    image('search-one', 'source', 32, 30, 1),
    image('generation-one', 'generation', 10),
    image('later-batch', 'source', 41, 40, 0),
  ];
  assert.deepEqual(orderedWordImages(values).map(value => value.id), [
    'generation-one', 'generation-two', 'search-one', 'search-two', 'later-batch',
  ]);
  assert.deepEqual(insertOrderedWordImage(values.slice(0, 2), values[2]!).map(value => value.id), [
    'generation-two', 'search-one', 'search-two',
  ]);
  assert.equal(insertOrderedWordImage(values, values[0]!).length, values.length);
});
