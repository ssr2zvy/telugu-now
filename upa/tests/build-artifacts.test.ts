import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const appDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repositoryDirectory = path.dirname(appDirectory);

test('artifact script builds from its own repository and propagates build failures', t => {
  const root = path.join(appDirectory, 'test-results', `artifact-script-${randomUUID()}`);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const directory of ['ci-cd', 'upa', 'bin', 'unrelated']) {
    fs.mkdirSync(path.join(root, directory), { recursive: true });
  }
  const source = path.join(repositoryDirectory, 'ci-cd/make-artifacts.sh');
  assert.ok(fs.statSync(source).mode & 0o111);
  const script = path.join(root, 'ci-cd/make-artifacts.sh');
  fs.copyFileSync(source, script);
  fs.writeFileSync(path.join(root, 'bin/npm'), [
    '#!/usr/bin/env bash',
    'printf "%s\\n" "$PWD" "$*"',
    'exit "${ARTIFACT_TEST_EXIT_CODE:-0}"',
    '',
  ].join('\n'), { mode: 0o755 });
  for (const exitCode of [0, 23]) {
    const result = spawnSync('bash', [script], {
      cwd: path.join(root, 'unrelated'),
      env: {
        ...process.env,
        PATH: `${path.join(root, 'bin')}:${process.env.PATH}`,
        ARTIFACT_TEST_EXIT_CODE: String(exitCode),
      },
      encoding: 'utf8',
    });
    assert.equal(result.status, exitCode, result.stderr);
    assert.deepEqual(result.stdout.trim().split('\n'), [path.join(root, 'upa'), 'run build']);
    assert.equal(fs.existsSync(path.join(root, 'upa/node_modules')), false);
  }
});
