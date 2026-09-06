import assert from 'node:assert/strict';
import test from 'node:test';
import {
  OBSERVATION_FONT_ASSETS,
  createPlaceholderEmbeddedObservationFontBundle,
  loadObservationFontBundle,
  observationFontFaceCss,
  toEmbeddedObservationFontBundle,
} from '../frontend/src/font-assets';
import { OBSERVATION_FONTS } from '../frontend/src/presentation';
test('font asset manifest exactly covers the curated observation font pool with local files', () => {
  assert.deepEqual(
    OBSERVATION_FONT_ASSETS.map((asset) => asset.family),
    [...OBSERVATION_FONTS],
  );
  assert.equal(OBSERVATION_FONT_ASSETS.length, 10);
  for (const asset of OBSERVATION_FONT_ASSETS) {
    assert.match(asset.fileName, /^[a-z0-9-]+\.woff2$/);
    assert.match(asset.licenseFileName, /^[a-z0-9-]+-OFL\.txt$/);
  }
});
test('font-face CSS can target the same families with embedded data URLs', () => {
  const bundle = createPlaceholderEmbeddedObservationFontBundle();
  const css = observationFontFaceCss(
    bundle.fonts.map((font) => ({
      family: font.family,
      source: font.dataUrl,
    })),
  );
  assert.equal((css.match(/@font-face/g) ?? []).length, 10);
  for (const family of OBSERVATION_FONTS) {
    assert.ok(css.includes(`font-family:"${family}"`));
  }
  assert.equal(/https?:\/\//.test(css), false);
});
test('binary font bundle loader reads every font and license from local application paths', async () => {
  const requested: string[] = [];
  const fakeFetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    requested.push(url);
    if (url.includes('/licenses/')) {
      return new Response('SIL OPEN FONT LICENSE TEST', { status: 200 });
    }
    return new Response(new Uint8Array([1, 2, 3, 4]), { status: 200 });
  }) as typeof fetch;
  const bundle = await loadObservationFontBundle(fakeFetch);
  assert.equal(bundle.fonts.length, 10);
  assert.equal(requested.length, 20);
  assert.ok(requested.every((url) => url.startsWith('/fonts/')));
  for (const font of bundle.fonts) {
    assert.deepEqual([...font.bytes], [1, 2, 3, 4]);
    assert.equal(font.licenseText, 'SIL OPEN FONT LICENSE TEST');
    assert.match(font.fileName, /\.woff2$/);
    assert.match(font.licenseFileName, /-OFL\.txt$/);
  }
  const embedded = toEmbeddedObservationFontBundle(bundle);
  for (const font of embedded.fonts) {
    assert.match(font.dataUrl, /^data:font\/woff2;base64,/);
    assert.equal(font.licenseText, 'SIL OPEN FONT LICENSE TEST');
  }
});
