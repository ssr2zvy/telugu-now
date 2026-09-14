import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generatePollinationsImage, readPollinationsKey, MAX_IMAGE_BYTES } from '../server/src/services/pollinations-service';
import { IMAGE_MODEL, renderImagePrompt, validImagePrompt } from '../shared/image-settings';

let originalEnvironmentKey: string | undefined;
test.beforeEach(() => {
  originalEnvironmentKey = process.env.pollinations_api_key;
  delete process.env.pollinations_api_key;
});
test.afterEach(() => {
  if (originalEnvironmentKey === undefined) delete process.env.pollinations_api_key;
  else process.env.pollinations_api_key = originalEnvironmentKey;
});

test('image prompts only have to be non-empty, and replace every placeholder occurrence literally', () => {
  // Both placeholders are optional now, so a plain prompt is valid.
  for (const value of ['', '   ', null, '<core word>'.repeat(201)]) assert.equal(validImagePrompt(value), false);
  for (const value of ['Draw a word', 'Draw <core word>', 'Draw <sentence>']) assert.equal(validImagePrompt(value), true);
  assert.equal(renderImagePrompt('Draw <core word>, not the text <core word>.', 'అవును'), 'Draw అవును, not the text అవును.');
  assert.equal(
    renderImagePrompt('<core word> in <sentence>, and again <sentence>.', 'అవును', ' అవును కదా '),
    'అవును in అవును కదా, and again అవును కదా.',
  );
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

test('local key discovery uses the renamed controller as its repository marker', t => {
  const controller = fileURLToPath(new URL('../../local-machine/control_local.sh', import.meta.url));
  const envPath = fileURLToPath(new URL('../../env', import.meta.url));
  t.mock.method(fs, 'existsSync', (file: fs.PathLike) =>
    String(file) === controller);
  t.mock.method(fs, 'readFileSync', (file: fs.PathOrFileDescriptor) => {
    assert.equal(String(file), envPath);
    return 'pollinations_api_key=discovered-fixture\n';
  });
  assert.equal(readPollinationsKey(), 'discovered-fixture');
});

test('environment key takes precedence and does not require a readable local file', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'image-env-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const envPath = path.join(directory, 'env');
  await writeFile(envPath, 'pollinations_api_key=local-fixture\n');
  process.env.pollinations_api_key = '  deployment-fixture  ';
  assert.equal(readPollinationsKey(envPath), 'deployment-fixture');
  assert.equal(readPollinationsKey(path.join(directory, 'missing')), 'deployment-fixture');
  assert.equal(readPollinationsKey(directory), 'deployment-fixture');
  assert.equal(readPollinationsKey(), 'deployment-fixture');
  process.env.pollinations_api_key = 'updated-deployment-fixture';
  assert.equal(readPollinationsKey(envPath), 'updated-deployment-fixture');
});

test('empty environment keys use the local fallback and file errors remain explicit', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'image-env-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const envPath = path.join(directory, 'env');
  await writeFile(envPath, 'pollinations_api_key=local-fixture\n');
  for (const value of ['', '   ']) {
    process.env.pollinations_api_key = value;
    assert.equal(readPollinationsKey(envPath), 'local-fixture');
    assert.equal(readPollinationsKey(path.join(directory, 'missing')), '');
    assert.throws(() => readPollinationsKey(directory), /Could not read the image generation configuration/);
  }
});

test('Pollinations uses the exact model and keeps the key out of the URL', async () => {
  const request: typeof fetch = async (input, options) => {
    const url = new URL(String(input));
    assert.equal(url.origin, 'https://gen.pollinations.ai');
    assert.equal(decodeURIComponent(url.pathname), '/image/Draw అవును.');
    assert.equal(url.searchParams.get('model'), IMAGE_MODEL);
    assert.match(url.searchParams.get('seed') ?? '', /^\d+$/);
    assert.ok(Number(url.searchParams.get('seed')) < 2147483647);
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
  await assert.rejects(generatePollinationsImage('word', ''), /server environment \(Fly secret\) or the local root env file/);
  await assert.rejects(generatePollinationsImage('word', 'fixture-secret', async () => { throw new Error('fixture-secret'); }), /could not be reached/);
  await assert.rejects(generatePollinationsImage('word', 'fixture-secret', async () => new Response('large', { headers: { 'content-length': String(MAX_IMAGE_BYTES + 1) } })), /oversized/);
});