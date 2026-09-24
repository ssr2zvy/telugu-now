import assert from 'node:assert/strict';
import test from 'node:test';
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

test('image prompt requires the placeholder and replaces every occurrence literally', () => {
  for (const value of ['', 'Draw a word', null, '<core word>'.repeat(201)]) assert.equal(validImagePrompt(value), false);
  assert.equal(renderImagePrompt('Draw <core word>, not the text <core word>.', 'అవును'), 'Draw అవును, not the text అవును.');
});

test('image key comes only from the server environment and trims whitespace', () => {
  process.env.pollinations_api_key = '  deployment-fixture  ';
  assert.equal(readPollinationsKey(), 'deployment-fixture');
  process.env.pollinations_api_key = 'updated-fixture';
  assert.equal(readPollinationsKey(), 'updated-fixture');
});

test('Vite refuses to serve the local secrets file', async () => {
  const { createServer, isFileServingAllowed } = await import('vite');
  const server = await createServer({
    configFile: fileURLToPath(new URL('../frontend/vite.config.ts', import.meta.url)),
    server: { watch: null },
  });
  try {
    const secretsPath = fileURLToPath(new URL('../../local-machine/dev-secrets.env', import.meta.url));
    assert.equal(isFileServingAllowed(`/@fs${secretsPath}`, server), false);
  } finally {
    await server.close();
  }
});

test('missing or blank image keys stay empty without a local file fallback', () => {
  assert.equal(readPollinationsKey(), '');
  for (const value of ['', '   ']) {
    process.env.pollinations_api_key = value;
    assert.equal(readPollinationsKey(), '');
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
  await assert.rejects(generatePollinationsImage('word', ''), /server environment \(Fly secret\).*export it in local-machine\/dev-secrets\.env/);
  await assert.rejects(generatePollinationsImage('word', 'fixture-secret', async () => { throw new Error('fixture-secret'); }), /could not be reached/);
  await assert.rejects(generatePollinationsImage('word', 'fixture-secret', async () => new Response('large', { headers: { 'content-length': String(MAX_IMAGE_BYTES + 1) } })), /oversized/);
});
test('sentence placeholder expands literally without recursively replacing sentence text', () => {
  assert.equal(renderImagePrompt('Draw <core word> in <sentence>. Again: <sentence>', 'అవును', 'అవును $& <core word>'),
    'Draw అవును in అవును $& <core word>. Again: అవును $& <core word>');
  assert.throws(() => renderImagePrompt('<core word> in <sentence>', 'అవును'), /current sentence/);
});


test('complete surface words fill new and legacy placeholders; sentence remains opt-in', () => {
  for (const word of ['చెట్లలో', 'పుస్తకాలలో', 'ఇంటికి', 'పిల్లలతో', 'అమ్మకు', 'నగరంలో', 'బట్టలు']) {
    assert.equal(renderImagePrompt('Draw <word>', word, 'This must not be appended'), `Draw ${word}`);
    assert.equal(renderImagePrompt('Draw <core word>', word), `Draw ${word}`);
    assert.equal(renderImagePrompt('<word> / <core word> in <sentence>', word, 'the sentence'), `${word} / ${word} in the sentence`);
  }
  assert.equal(validImagePrompt('Draw <word>'), true);
  assert.equal(validImagePrompt('Draw <sentence>'), false);
});
