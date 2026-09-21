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

test('artifact metadata preserves independent source versions and rejects invalid requests', t => {
  const root = path.join(appDirectory, 'test-results', `artifact-versions-${randomUUID()}`);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  const script = path.join(root, 'scripts/write-artifact-versions.mjs');
  fs.copyFileSync(path.join(appDirectory, 'scripts/write-artifact-versions.mjs'), script);
  const artifacts = [
    { name: 'frontend', version: '1.2.3', source: 'frontend/version.json', output: 'dist/client/version.json' },
    { name: 'backend', version: '4.5.6', source: 'server/version.json', output: 'dist/server/version.json' },
  ];
  for (const artifact of artifacts) {
    fs.mkdirSync(path.dirname(path.join(root, artifact.source)), { recursive: true });
    fs.mkdirSync(path.dirname(path.join(root, artifact.output)), { recursive: true });
    fs.writeFileSync(path.join(root, artifact.source), JSON.stringify({
      artifact: artifact.name, version: artifact.version,
    }));
  }
  const run = (...args: string[]) => spawnSync(process.execPath, [script, ...args], {
    cwd: repositoryDirectory, encoding: 'utf8',
  });
  const result = run('frontend', 'backend');
  assert.equal(result.status, 0, result.stderr);
  for (const artifact of artifacts) {
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, artifact.output), 'utf8')), {
      artifact: artifact.name, version: artifact.version,
    });
  }

  fs.unlinkSync(path.join(root, 'dist/client/version.json'));
  const unknown = run('frontend', 'unknown');
  assert.notEqual(unknown.status, 0);
  assert.match(unknown.stderr, /Unknown artifact: unknown/);
  assert.equal(fs.existsSync(path.join(root, 'dist/client/version.json')), false);
  assert.notEqual(run().status, 0);

  const frontendOnly = run('frontend');
  assert.equal(frontendOnly.status, 0, frontendOnly.stderr);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'dist/server/version.json'), 'utf8')).version, '4.5.6');
  fs.unlinkSync(path.join(root, 'frontend/version.json'));
  const missingSource = run('frontend');
  assert.notEqual(missingSource.status, 0);
  assert.match(missingSource.stderr, /ENOENT/);
});
