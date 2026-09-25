import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('grammar units count grammatical components and preserve canonical chain sharing', () => {
  const script = fileURLToPath(new URL('./grammar-target-policy.py', import.meta.url));
  const result = spawnSync(process.env.GRAMMAR_PYTHON ?? 'python3', [script], {encoding:'utf8', timeout:30000});
  assert.equal(result.status, 0, `${result.error ?? ''}\n${result.stdout}\n${result.stderr}`);
});
