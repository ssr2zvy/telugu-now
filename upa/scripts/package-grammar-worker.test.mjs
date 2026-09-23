import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

const script = new URL('./package-grammar-worker.mjs', import.meta.url);
const assets = [
  'graph.json',
  'context_reviews.json',
  'parser/data/lexicon.json',
  'parser/data/modifier_definitions.json',
  'parser/data/contrast_families.json',
  'parser/core_parser/vendor/grammar.json',
];
function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'parser-packaging-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const cwd = path.join(root, 'upa');
  const source = path.join(root, 'data-transform/scripts/parse-core');
  const destination = path.join(cwd, 'dist/server/parse-core');
  mkdirSync(cwd, { recursive: true });
  mkdirSync(path.join(root, 'data-transform/scripts/build-grammar'), { recursive: true });
  for (const asset of [...assets, 'build.py', 'parser/core_parser/__init__.py', 'parser/core_parser/__pycache__/cached.pyc']) {
    const file = path.join(source, asset);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, asset.endsWith('.json') ? '{"fixture":true}' : '# fixture');
  }
  const run = () => spawnSync(process.execPath, [script.pathname], { cwd, encoding: 'utf8' });
  return { cwd, source, destination, run };
}

test('packages dictionaries and worker code, excluding Python caches and stale output', t => {
  const { source, destination, run } = fixture(t);
  mkdirSync(destination, { recursive: true });
  writeFileSync(path.join(destination, 'stale.py'), '# obsolete');
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  for (const asset of [...assets, 'build.py', 'parser/core_parser/__init__.py']) {
    assert.equal(readFileSync(path.join(destination, asset), 'utf8'), readFileSync(path.join(source, asset), 'utf8'));
  }
  assert.equal(existsSync(path.join(destination, 'parser/core_parser/__pycache__')), false);
  assert.equal(existsSync(path.join(destination, 'stale.py')), false);
});

test('fails the build if any required parser JSON is missing, even with stale dist assets', async t => {
  for (const asset of assets) {
    await t.test(asset, t => {
      const { source, destination, run } = fixture(t);
      mkdirSync(path.dirname(destination), { recursive: true });
      cpSync(source, destination, { recursive: true });
      rmSync(path.join(source, asset));
      const result = run();
      assert.notEqual(result.status, 0);
      assert.ok(result.stderr.includes('Missing or invalid parser asset:'));
      assert.ok(result.stderr.includes(asset));
    });
  }
});

test('fails the build for invalid dictionary JSON', t => {
  const { source, run } = fixture(t);
  writeFileSync(path.join(source, 'parser/data/lexicon.json'), '{broken');
  const result = run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Missing or invalid parser asset:.*lexicon.json/);
});
