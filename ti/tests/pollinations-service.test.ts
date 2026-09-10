import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { generatePollinationsImage, readPollinationsKey, MAX_IMAGE_BYTES } from '../server/src/services/pollinations-service';
import { IMAGE_MODEL, renderImagePrompt, validImagePrompt } from '../shared/image-settings';

test('image prompt requires the placeholder and replaces every occurrence literally', () => {
  for (const value of ['', 'Draw a word', null, '<core word>'.repeat(201)]) assert.equal(validImagePrompt(value), false);
  assert.equal(renderImagePrompt('Draw <core word>, not the text <core word>.', 'అవును'), 'Draw అవును, not the text అవును.');
});

test('root env key supports dotenv syntax and can change without restarting', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'image-env-'));
  const envPath = path.join(directory, 'env');
  try {
    assert.equal(readPollinationsKey(envPath), '');
    await writeFile(envPath, 'pollinations_api_key="fixture-key" # local only\n');
    assert.equal(readPollinationsKey(envPath), 'fixture-key');
    await writeFile(envPath, 'pollinations_api_key=updated-fixture\n');
    assert.equal(readPollinationsKey(envPath), 'updated-fixture');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('Pollinations uses the exact model and keeps the key out of the URL', async () => {
  const request: typeof fetch = async (input, options) => {
    const url = new URL(String(input));
    assert.equal(url.origin, 'https://gen.pollinations.ai');
    assert.equal(decodeURIComponent(url.pathname), '/image/Draw అవును.');
    assert.equal(url.searchParams.get('model'), IMAGE_MODEL);
    assert.equal(url.toString().includes('fixture-secret'), false);
    assert.equal(new Headers(options?.headers).get('authorization'), 'Bearer fixture-secret');
    assert.equal(options?.redirect, 'error');
    return new Response(new Uint8Array([1, 2, 3]));
  };
  assert.deepEqual(await generatePollinationsImage('Draw అవును.', 'fixture-secret', request), Buffer.from([1, 2, 3]));
});

test('provider failures never expose credentials or upstream response bodies', async () => {
  for (const status of [401, 402, 403, 429, 500]) {
    await assert.rejects(generatePollinationsImage('word', 'fixture-secret', async () => new Response('fixture-secret', { status })), error => {
      assert.equal(String(error).includes('fixture-secret'), false);
      return true;
    });
  }
  await assert.rejects(generatePollinationsImage('word', ''), /root env file/);
  await assert.rejects(generatePollinationsImage('word', 'fixture-secret', async () => { throw new Error('fixture-secret'); }), /could not be reached/);
  await assert.rejects(generatePollinationsImage('word', 'fixture-secret', async () => new Response('large', { headers: { 'content-length': String(MAX_IMAGE_BYTES + 1) } })), /oversized/);
});