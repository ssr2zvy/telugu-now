import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { getTeluguGradientCacheSnapshot, paddedAlphaBounds } from '../frontend/src/observation/telugu-gradient-renderer';
import { teluguHighlightRuns, teluguModificationRanges } from '../frontend/src/observation/telugu-highlighting';
import { TeluguWordText } from '../frontend/src/observation/TeluguGradientText';

const highlighted = (text: string) => teluguModificationRanges(text).map(range => text.slice(range.start, range.end));

test('finds Telugu dependent vowel signs without including base consonants', () => {
  assert.deepEqual(highlighted('క కా కి కు కై కో'), ['ా', 'ి', 'ు', 'ై', 'ో']);
});

test('finds vattulu as virama and their dependent consonants', () => {
  assert.deepEqual(highlighted('అమ్మ క్క న్క'), ['్మ', '్క', '్క']);
  assert.deepEqual(highlighted(`క్\u200dక`), [`్\u200dక`]);
});

test('ignores unmodified Telugu letters and unrelated scripts', () => {
  assert.deepEqual(teluguModificationRanges('అ ఆ క abc'), []);
});

test('pads raster ink bounds without clipping at canvas edges', () => {
  const alpha = new Uint8Array(10 * 8);
  alpha[2 * 10 + 3] = 255;
  alpha[5 * 10 + 7] = 255;
  assert.deepEqual(paddedAlphaBounds(alpha, 10, 8, 1), { left: 2, top: 1, width: 7, height: 6 });
  alpha[0] = 255;
  alpha[7 * 10 + 9] = 255;
  assert.deepEqual(paddedAlphaBounds(alpha, 10, 8, 3), { left: 0, top: 0, width: 10, height: 8 });
  assert.equal(paddedAlphaBounds(new Uint8Array(12), 4, 3, 2), null);
});

test('reports immutable renderer cache status for every bundled font', () => {
  const snapshot = getTeluguGradientCacheSnapshot();
  assert.equal(snapshot.models.length, 10);
  assert.ok(snapshot.models.every(model => model.state === 'not-started'));
  assert.deepEqual(snapshot.textures, { total: 0, pending: 0, loaded: 0, failed: 0 });
  assert.deepEqual(snapshot.simpleAlignments, { total: 0, prepared: 0 });
  snapshot.models.pop();
  assert.equal(getTeluguGradientCacheSnapshot().models.length, 10);
});

test('maps every locked font to a content-addressed static model', () => {
  const manifest = JSON.parse(readFileSync(new URL('../frontend/src/generated/telugu-font-model-manifest.json', import.meta.url), 'utf8'));
  const lock = JSON.parse(readFileSync(new URL('../frontend/public/fonts/font-assets.lock.json', import.meta.url), 'utf8'));
  assert.equal(manifest.version, 2);
  assert.equal(manifest.simpleFormCount, 525);
  assert.equal(Object.keys(manifest.fonts).length, lock.fonts.length);
  for (const font of lock.fonts) {
    const entry = manifest.fonts[font.family];
    assert.equal(entry?.fontSha256, font.fontSha256);
    assert.match(entry?.url ?? '', /^\/font-models\/[a-f0-9]{64}\.json$/);
    const artifact = JSON.parse(readFileSync(new URL(`../frontend/public${entry.url}`, import.meta.url), 'utf8'));
    assert.equal(artifact.fontFamily, font.family);
    assert.equal(Object.keys(artifact.bases ?? {}).length, 35);
    assert.equal(Object.keys(artifact.alignments ?? {}).length, manifest.simpleFormCount);
  }
  const server = readFileSync(new URL('../server/src/app.ts', import.meta.url), 'utf8');
  assert.match(server, /app\.use\('\/font-models\/\*'[\s\S]*Cache-Control', 'public, max-age=31536000, immutable'/);
});

test('builds selectable raster runs while preserving the original text', () => {
  const text = 'అమ్మకు';
  const runs = teluguHighlightRuns(text);
  assert.equal(runs.map(run => run.text).join(''), text);
  assert.deepEqual(runs.filter(run => run.highlighted).map(run => run.text), ['మ్మ', 'కు']);
  const css = readFileSync(new URL('../frontend/src/styles/observation-layout.css', import.meta.url), 'utf8');
  const renderer = readFileSync(new URL('../frontend/src/observation/telugu-gradient-renderer.ts', import.meta.url), 'utf8');
  const runtimeFontModel = renderer.slice(renderer.indexOf('async function fontModel'), renderer.indexOf('function principalBase'));
  assert.match(css, /\.telugu-gradient-text\.is-ready::before[\s\S]*background: var\(--telugu-gradient-image\)/);
  assert.match(css, /\.telugu-gradient-text[^{]*\{[^}]*display: inline-block[^}]*vertical-align: baseline[^}]*line-height: inherit[^}]*overflow: visible/);
  assert.match(renderer, /const modelCache = new Map<string, Promise<FontModel>>/);
  assert.match(renderer, /const ANALYSIS_SCALE = 2/);
  assert.match(renderer, /const RENDER_SCALE = 1/);
  assert.match(renderer, /async function generateBaseMasks[\s\S]*alphaMask\(downsample\(\s*overlapBase\(principalBase\(entry, profile\), checkmarkBase\(entry, consonant\)\),\s*ANALYSIS_SCALE \/ RENDER_SCALE,\s*\)\)/);
  assert.match(renderer, /const bases = artifactBases\(artifact\);[\s\S]*if \(bases\.size !== CONSONANTS\.length\) throw/);
  assert.doesNotMatch(runtimeFontModel, /trainProfile|principalBase|checkmarkBase|overlapBase|rasterize\(consonant/);
  assert.match(renderer, /Math\.max\(metrics\.width, metrics\.actualBoundingBoxRight\)/);
  assert.match(renderer, /canvasContext\(painted\.width, painted\.height\)/);
  assert.match(renderer, /Math\.pow\(Math\.min\(1,[\s\S]*\.925\)[\s\S]*\.42\)/);
  assert.match(renderer, /const SIMPLE_FORMS = CONSONANTS\.flatMap/);
  assert.match(renderer, /fetch\(entry\.url, \{ cache: 'force-cache' \}\)/);
  assert.match(renderer, /generateTeluguFontModelArtifact\([\s\S]*alignments\[text\] = \[dx, dy\]/);
  assert.match(renderer, /adjustedBase\(target, base, alignment\)/);
});

test('keeps every highlighted word in one unbreakable wrapper', () => {
  const text = 'అమ్మకు తెలుగు';
  const markup = renderToStaticMarkup(TeluguWordText({ text, runs: teluguHighlightRuns(text), textures: null }));
  assert.equal(markup.match(/class="telugu-word"/g)?.length, 2);
  assert.match(markup, /class="telugu-word">అ<span class="telugu-gradient-text">మ్మ<\/span><span class="telugu-gradient-text">కు<\/span><\/span> <span class="telugu-word">/);
  const css = readFileSync(new URL('../frontend/src/styles/observation-layout.css', import.meta.url), 'utf8');
  assert.match(css, /\.telugu-word \{ display: inline-block; white-space: nowrap; \}/);
});