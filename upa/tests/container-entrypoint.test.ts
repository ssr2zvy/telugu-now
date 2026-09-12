import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test, { type TestContext } from 'node:test';

const appDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function fixture(t: TestContext) {
  const root = path.join(appDirectory, 'test-results', `entrypoint-${randomUUID()}`);
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const script = path.join(root, 'entrypoint.sh');
  fs.copyFileSync(path.join(appDirectory, '../container-scripts/entrypoint.sh'), script);
  const trace = path.join(root, 'ownership.log');
  const data = path.join(root, 'data directory');
  fs.writeFileSync(path.join(bin, 'id'), '#!/bin/sh\nprintf "%s\\n" "${TEST_UID:-0}"\n', { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'chown'), [
    '#!/bin/sh',
    'printf "%s\\n" "$*" >> "$TEST_TRACE"',
    'exit "${TEST_CHOWN_EXIT:-0}"',
    '',
  ].join('\n'), { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'gosu'), [
    '#!/bin/sh',
    '[ "$1" = "node" ] || exit 99',
    'shift',
    'export TEST_UID=1000',
    'exec "$@"',
    '',
  ].join('\n'), { mode: 0o755 });
  const run = (
    overrides: Record<string, string> = {},
    command = [process.execPath, '-e', 'console.log(process.env.TEST_UID)'],
  ) => spawnSync('sh', [script, ...command], {
    cwd: root,
    env: {
      ...process.env, DATA_DIRECTORY: data,
      PATH: `${bin}:${process.env.PATH}`,
      TEST_TRACE: trace, TEST_UID: '0', TEST_CHOWN_EXIT: '0', ...overrides,
    },
    encoding: 'utf8',
  });
  return { root, data, trace, run };
}

test('entrypoint prepares only managed directories and drops privileges before executing the command', t => {
  const { data, trace, run } = fixture(t);
  fs.mkdirSync(path.join(data, 'corpus/nested'), { recursive: true });
  const existing = path.join(data, 'corpus/nested/existing.sqlite');
  fs.writeFileSync(existing, 'preserve existing data');
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), '1000');
  assert.deepEqual(fs.readFileSync(trace, 'utf8').trim().split('\n'),
    ['', '/corpus', '/user', '/word-images'].map(suffix => `-h node:node -- ${data}${suffix}`));
  assert.equal(fs.readFileSync(existing, 'utf8'), 'preserve existing data');
  for (const directory of ['corpus', 'user', 'word-images']) {
    assert.ok(fs.statSync(path.join(data, directory)).isDirectory());
  }
  const failedCommand = run({}, [process.execPath, '-e', 'process.exit(23)']);
  assert.equal(failedCommand.status, 23);
});

test('entrypoint supports non-root starts and relative data roots without changing ownership', t => {
  const { root, trace, run } = fixture(t);
  const result = run({ TEST_UID: '1000', DATA_DIRECTORY: './relative/../volume' }, [
    process.execPath, '-e', 'console.log(process.env.DATA_DIRECTORY)',
  ]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), path.join(root, 'volume'));
  assert.equal(fs.existsSync(trace), false);
});

test('entrypoint rejects unsafe roots and missing commands before initialization', t => {
  const { trace, run } = fixture(t);
  for (const directory of ['', '/', '/data/..']) {
    const result = run({ DATA_DIRECTORY: directory });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Container initialization failed/);
  }
  const missingCommand = run({}, []);
  assert.notEqual(missingCommand.status, 0);
  assert.match(missingCommand.stderr, /No application command/);
  assert.equal(fs.existsSync(trace), false);
});

test('entrypoint rejects symbolic links and files before changing any ownership', t => {
  const { root, data, trace, run } = fixture(t);
  fs.mkdirSync(data);
  const outside = path.join(root, 'outside');
  fs.mkdirSync(outside);
  fs.symlinkSync(outside, path.join(data, 'user'));
  const symlink = run();
  assert.notEqual(symlink.status, 0);
  assert.match(symlink.stderr, /must not be symbolic links/);
  assert.equal(fs.existsSync(trace), false);
  fs.unlinkSync(path.join(data, 'user'));
  fs.writeFileSync(path.join(data, 'user'), 'not a directory');
  const file = run();
  assert.notEqual(file.status, 0);
  assert.match(file.stderr, /Expected a data directory/);
  fs.symlinkSync(data, path.join(root, 'linked-root'));
  assert.match(run({ DATA_DIRECTORY: path.join(root, 'linked-root') }).stderr, /must not contain symbolic links/);
  assert.equal(fs.existsSync(trace), false);
});

test('entrypoint stops on ownership errors without starting the application', t => {
  const { run } = fixture(t);
  const result = run({ TEST_CHOWN_EXIT: '42' });
  assert.equal(result.status, 42);
  assert.equal(result.stdout, '');
});
