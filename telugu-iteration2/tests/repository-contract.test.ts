import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('Iteration 2 controller is control.sh with no stale control-project.sh surface', () => {
  const control = path.join(root, 'control.sh');
  assert.equal(fs.existsSync(control), true);
  assert.equal(fs.existsSync(path.join(root, 'control-project.sh')), false);
  assert.ok((fs.statSync(control).mode & 0o111) !== 0, 'control.sh should remain executable');

  const syntax = spawnSync('bash', ['-n', control], { encoding: 'utf8' });
  assert.equal(syntax.status, 0, syntax.stderr);

  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  assert.equal(readme.includes('control-project.sh'), false);
  assert.ok(readme.includes('./control.sh'));
  assert.equal(fs.existsSync(path.join(root, 'VALIDATION.md')), false);
  assert.equal(readme.includes('VALIDATION.md'), false);
});
