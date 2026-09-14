import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const appDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repositoryDirectory = path.dirname(appDirectory);

test('deployment commands fail safely, use the root context, and preserve command failures', t => {
  const root = path.join(appDirectory, 'test-results', `deploy-${randomUUID()}`);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const directory of ['ci-cd', 'bin', 'unrelated']) {
    fs.mkdirSync(path.join(root, directory), { recursive: true });
  }
  const script = path.join(root, 'ci-cd/deploy.sh');
  assert.ok(fs.statSync(path.join(repositoryDirectory, 'ci-cd/deploy.sh')).mode & 0o111);
  fs.copyFileSync(path.join(repositoryDirectory, 'ci-cd/deploy.sh'), script);
  fs.writeFileSync(path.join(root, 'fly.toml'), 'app = "telugu-now"\n');
  fs.writeFileSync(path.join(root, 'ci-cd/Containerfile'), 'FROM scratch\n');
  fs.writeFileSync(path.join(root, 'bin/flyctl'), `#!/usr/bin/env bash
printf '%s|%s\\n' "$PWD" "$*" >> "$CALL_LOG"
case "$1 $2" in
  "status --config") exit "\${STATUS_EXIT:-0}" ;;
  "machine list") printf '%s\\n' "$MACHINES"; exit "\${LIST_EXIT:-0}" ;;
  *) exit "\${ACTION_EXIT:-0}" ;;
esac
`, { mode: 0o755 });
  fs.writeFileSync(path.join(root, 'bin/gh'), `#!/usr/bin/env bash
printf '%s|%s\\n' "$PWD" "$*" >> "$CALL_LOG"
if [[ "$1" == api ]]; then
  printf '%s\\t%s\\t%s\\n' "$RUN_PATH" "$RUN_BRANCH" "$RUN_STATUS"
  exit "\${STATUS_EXIT:-0}"
fi
exit "\${ACTION_EXIT:-0}"
`, { mode: 0o755 });
  const log = path.join(root, 'calls');
  const run = (args: string[], env: Record<string, string> = {}) => {
    fs.writeFileSync(log, '');
    const result = spawnSync('bash', [script, ...args], {
      cwd: path.join(root, 'unrelated'),
      env: {
        ...process.env,
        PATH: `${path.join(root, 'bin')}:${process.env.PATH}`,
        FLY_API_TOKEN: 'fake-token-for-test',
        CALL_LOG: log,
        MACHINES: '[{"id":"abc123","state":"started"},{"id":"def456","state":"stopped"}]',
        RUN_PATH: '.github/workflows/deploy.yml',
        RUN_BRANCH: 'main',
        RUN_STATUS: 'in_progress',
        STATUS_EXIT: '0',
        LIST_EXIT: '0',
        ACTION_EXIT: '0',
        ...env,
      },
      encoding: 'utf8',
    });
    assert.doesNotMatch(result.stdout + result.stderr, /fake-token-for-test/);
    return { ...result, calls: fs.readFileSync(log, 'utf8') };
  };

  for (const args of [['help'], ['invalid'], ['deploy', 'extra'], ['cancel'], ['cancel', 'bad']]) {
    const result = run(args);
    assert.equal(result.status, args[0] === 'help' ? 0 : 1);
    assert.equal(result.calls, '');
  }
  for (const action of ['deploy', 'stop']) {
    const missing = run([action], { FLY_API_TOKEN: '' });
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /FLY_API_TOKEN is missing/);
    assert.equal(missing.calls, '');
    const denied = run([action], { STATUS_EXIT: '9' });
    assert.equal(denied.status, 1);
    assert.equal(denied.calls.trim(), `${root}|status --config fly.toml --json`);
  }

  for (const code of [0, 23]) {
    const result = run(['deploy'], { ACTION_EXIT: String(code) });
    assert.equal(result.status, code, result.stderr);
    const calls = result.calls.trim().split('\n');
    assert.equal(calls[0], `${root}|status --config fly.toml --json`);
    // The build is stamped with the revision it came from, for the Version page.
    assert.equal(
      calls[1]?.replace(/ --build-arg .*/, ''),
      `${root}|deploy . --config fly.toml --remote-only --ha=false --wait-timeout 5m`,
    );
    for (const argument of ['GIT_COMMIT', 'GIT_COMMIT_SUBJECT', 'GIT_BRANCH', 'BUILD_TIME']) {
      assert.match(calls[1] ?? '', new RegExp(`--build-arg ${argument}=`));
    }
  }
  const stop = run(['stop']);
  assert.equal(stop.status, 0, stop.stderr);
  assert.match(stop.calls, /machine stop abc123 def456 --config fly.toml --wait-timeout 5m/);
  assert.equal(run(['stop'], { ACTION_EXIT: '17' }).status, 17);
  for (const machines of ['[]', '[{"id":"abc123","state":"destroyed"}]']) {
    const empty = run(['stop'], { MACHINES: machines });
    assert.equal(empty.status, 0, empty.stderr);
    assert.match(empty.stdout, /No Machines to stop/);
    assert.doesNotMatch(empty.calls, /machine stop/);
  }
  for (const env of [{ MACHINES: '{}' }, { MACHINES: 'invalid' }, { MACHINES: '[{"id":"--all"}]' }, { LIST_EXIT: '7' }]) {
    const result = run(['stop'], env);
    assert.equal(result.status, 1);
    assert.doesNotMatch(result.calls, /machine stop/);
  }
  for (const env of [{ RUN_PATH: 'other.yml' }, { RUN_BRANCH: 'feature' }, { RUN_STATUS: 'completed' }, { STATUS_EXIT: '4' }]) {
    const result = run(['cancel', '123'], env);
    assert.equal(result.status, 1);
    assert.doesNotMatch(result.calls, /run cancel/);
  }
  const cancel = run(['cancel', '123'], { FLY_API_TOKEN: '' });
  assert.equal(cancel.status, 0, cancel.stderr);
  assert.match(cancel.calls, /run cancel 123 --repo ssr2zvy\/telugu-now/);
  assert.equal(run(['cancel', '123'], { ACTION_EXIT: '19' }).status, 19);
  fs.unlinkSync(path.join(root, 'ci-cd/Containerfile'));
  assert.equal(run(['deploy']).calls, '');
  fs.unlinkSync(path.join(root, 'bin/flyctl'));
  const missingTool = run(['deploy'], { PATH: '/usr/bin:/bin' });
  assert.match(missingTool.stderr, /Required command not found: flyctl/);
});

test('Fly configuration uses shared deployment paths and keeps workflow scaffolding inactive', () => {
  const read = (file: string) => fs.readFileSync(path.join(repositoryDirectory, file), 'utf8');
  assert.match(read('fly.toml'), /dockerfile = "ci-cd\/Containerfile"/);
  assert.match(read('.dockerignore'), /^!ci-cd\/Containerfile$/m);
  assert.equal(fs.existsSync(path.join(repositoryDirectory, 'ci-cd/Dockerfile')), false);
  assert.match(read('ci-cd/Containerfile'), /COPY ci-cd\/make-artifacts.sh/);
  assert.match(read('ci-cd/Containerfile'), /COPY ci-cd\/container-scripts\/entrypoint.sh/);
  const workflow = read('.github/workflows/deploy.yml');
  assert.match(workflow, /^\s+if: \$\{\{ false \}\}$/m);
  assert.match(workflow, /^\s+workflow_dispatch:/m);
  assert.doesNotMatch(workflow, /^\s+(push|pull_request|pull_request_target|schedule|workflow_run):/m);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /contents: read/);
  // The Actions secret is stored under the label API_TOKEN and mapped onto the
  // FLY_API_TOKEN variable that ci-cd/deploy.sh actually reads.
  assert.match(workflow, /FLY_API_TOKEN: \$\{\{ secrets.API_TOKEN \}\}/);
  assert.match(workflow, /run: bash ci-cd\/deploy.sh "\$DEPLOY_ACTION"/);
  assert.match(read('ci-cd/deploy.sh'), /Codespaces secret/);
});
