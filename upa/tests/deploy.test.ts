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
    assert.deepEqual(result.calls.trim().split('\n'), [
      `${root}|status --config fly.toml --json`,
      `${root}|deploy . --config fly.toml --remote-only --ha=false --wait-timeout 5m`,
    ]);
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
  const taggedCancel = run(['cancel', '123'], { RUN_BRANCH: 'deploy/20260914T120000Z-123456789abc' });
  assert.equal(taggedCancel.status, 0, taggedCancel.stderr);
  assert.match(taggedCancel.calls, /run cancel 123 --repo ssr2zvy\/telugu-now/);
  assert.equal(run(['cancel', '123'], { ACTION_EXIT: '19' }).status, 19);
  fs.unlinkSync(path.join(root, 'ci-cd/Containerfile'));
  assert.equal(run(['deploy']).calls, '');
  fs.unlinkSync(path.join(root, 'bin/flyctl'));
  const missingTool = run(['deploy'], { PATH: '/usr/bin:/bin' });
  assert.match(missingTool.stderr, /Required command not found: flyctl/);
});

test('controller deploy atomically pushes clean main and a pinned deployment tag without gh', t => {
  const root = path.join(appDirectory, 'test-results', `controller-deploy-${randomUUID()}`);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const directory of ['local-machine', 'upa', 'bin', 'unrelated']) {
    fs.mkdirSync(path.join(root, directory), { recursive: true });
  }
  const controller = path.join(root, 'local-machine/control_local.sh');
  fs.copyFileSync(path.join(repositoryDirectory, 'local-machine/control_local.sh'), controller);
  fs.writeFileSync(path.join(root, 'local-machine/dev.env'), 'printf "unexpected-dev-env\\n"\nreturn 42\n');
  fs.writeFileSync(path.join(root, 'local-machine/dev-secrets.env'), 'TEST_LOCAL_SECRET=private-fixture\n');
  fs.writeFileSync(path.join(root, 'bin/git'), `#!/usr/bin/env bash
printf '%s|git %s\\n' "$PWD" "$*" >> "$CALL_LOG"
case "$*" in
  "branch --show-current") printf '%s\\n' "$TEST_BRANCH" ;;
  "status --porcelain") printf '%s' "$TEST_CHANGES" ;;
  "rev-parse --verify HEAD") printf '%s\\n' "$TEST_REVISION" ;;
  "tag --no-sign "*) exit "$TAG_EXIT" ;;
  "push --atomic origin "*) exit "$PUSH_EXIT" ;;
  *) exit 99 ;;
esac
`, { mode: 0o755 });
  fs.writeFileSync(path.join(root, 'bin/gh'), `#!/usr/bin/env bash
[[ -z "\${TEST_LOCAL_SECRET:-}" ]] || exit 98
printf '%s|gh %s\\n' "$PWD" "$*" >> "$CALL_LOG"
exit "\${GH_EXIT:-97}"
`, { mode: 0o755 });
  fs.writeFileSync(path.join(root, 'bin/date'), '#!/usr/bin/env bash\nprintf "20260914T120000123456789Z\\n"\n', { mode: 0o755 });
  const revision = '1234567890abcdef1234567890abcdef12345678';
  const tag = `deploy/20260914T120000123456789Z-${revision.slice(0, 12)}`;
  const log = path.join(root, 'calls');
  const run = (args: string[] = [], env: Record<string, string> = {}) => {
    fs.writeFileSync(log, '');
    const result = spawnSync('bash', [controller, 'deploy', ...args], {
      cwd: path.join(root, 'unrelated'),
      env: {
        ...process.env,
        PATH: `${path.join(root, 'bin')}:${process.env.PATH}`,
        CALL_LOG: log, TEST_BRANCH: 'main', TEST_CHANGES: '', TEST_REVISION: revision, PUSH_EXIT: '0', TAG_EXIT: '0',
        ...env,
      },
      encoding: 'utf8',
    });
    assert.doesNotMatch(result.stdout + result.stderr, /unexpected-dev-env/);
    return { ...result, calls: fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) };
  };

  const success = run();
  assert.equal(success.status, 0, success.stderr);
  assert.deepEqual(success.calls, [
    `${root}|git branch --show-current`,
    `${root}|git status --porcelain`,
    `${root}|git rev-parse --verify HEAD`,
    `${root}|git tag --no-sign ${tag} ${revision}`,
    `${root}|git push --atomic origin ${revision}:refs/heads/main refs/tags/${tag}:refs/tags/${tag}`,
  ]);
  assert.ok(success.stdout.includes(`Deployment requested by tag ${tag}, not yet completed`));
  const stop = run(['--option', 'stop'], { GH_EXIT: '0' });
  assert.equal(stop.status, 0, stop.stderr);
  assert.deepEqual(stop.calls, [
    `${root}|gh workflow run deploy.yml --repo ssr2zvy/telugu-now --ref main -f action=stop`,
  ]);
  assert.match(stop.stdout, /Stop requested through GitHub Actions, not yet completed/);
  const rejectedStop = run(['--option', 'stop'], { GH_EXIT: '24' });
  assert.equal(rejectedStop.status, 24);
  assert.equal(rejectedStop.calls.length, 1);
  assert.doesNotMatch(rejectedStop.stdout, /Stop requested/);
  for (const branch of ['feature', '']) {
    const wrongBranch = run([], { TEST_BRANCH: branch });
    assert.equal(wrongBranch.status, 1);
    assert.match(wrongBranch.stderr, /requires main/);
    assert.equal(wrongBranch.calls.length, 1);
  }
  for (const changes of [' M tracked.ts', 'M  staged.ts', '?? untracked.ts']) {
    const dirty = run([], { TEST_CHANGES: changes });
    assert.equal(dirty.status, 1);
    assert.match(dirty.stderr, /clean working tree/);
    assert.equal(dirty.calls.length, 2);
  }
  const rejectedPush = run([], { PUSH_EXIT: '23' });
  assert.equal(rejectedPush.status, 23);
  assert.equal(rejectedPush.calls.length, 5);
  assert.ok(rejectedPush.stderr.includes(`local tag ${tag} was retained`));
  assert.ok(rejectedPush.stderr.includes(`git push --atomic origin ${revision}:refs/heads/main refs/tags/${tag}:refs/tags/${tag}`));
  assert.doesNotMatch(rejectedPush.stdout, /Deployment requested/);
  const rejectedTag = run([], { TAG_EXIT: '17' });
  assert.equal(rejectedTag.status, 17);
  assert.equal(rejectedTag.calls.length, 4);
  assert.doesNotMatch(rejectedTag.stdout, /Deployment requested/);
  for (const args of [['--help'], ['extra'], ['--option'], ['--option', 'start']]) {
    const result = run(args);
    assert.equal(result.status, args[0] === '--help' ? 0 : 2);
    assert.deepEqual(result.calls, []);
  }
});

test('deployment tags pin the checkout and a rejected atomic push leaves both remote refs unchanged', t => {
  const root = path.join(appDirectory, 'test-results', `deployment-git-${randomUUID()}`);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const checkout = path.join(root, 'checkout');
  const remote = path.join(root, 'remote.git');
  fs.mkdirSync(path.join(checkout, 'local-machine'), { recursive: true });
  fs.mkdirSync(path.join(checkout, 'upa'));
  fs.copyFileSync(path.join(repositoryDirectory, 'local-machine/control_local.sh'), path.join(checkout, 'local-machine/control_local.sh'));
  fs.writeFileSync(path.join(checkout, '.gitignore'), '/upa/.control/\n');
  const git = (args: string[], cwd = checkout) => {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git(['init', '--initial-branch=main']);
  git(['config', 'user.name', 'Deployment test']);
  git(['config', 'user.email', 'deployment@example.test']);
  git(['config', 'commit.gpgSign', 'false']);
  git(['init', '--bare', '--initial-branch=main', remote]);
  git(['remote', 'add', 'origin', remote]);
  git(['add', '.']);
  git(['commit', '-m', 'Initial fixture']);
  const revision = git(['rev-parse', 'HEAD']);
  const deploy = () => spawnSync('bash', ['local-machine/control_local.sh', 'deploy'], { cwd: checkout, encoding: 'utf8' });
  for (const expectedCount of [1, 2]) {
    const result = deploy();
    assert.equal(result.status, 0, result.stderr);
    const tags = git(['tag', '--list', 'deploy/*'], remote).split('\n');
    assert.equal(tags.length, expectedCount);
    assert.equal(git(['rev-parse', 'main'], remote), revision);
    for (const tag of tags) {
      assert.match(tag, /^deploy\/\d{8}T\d{15}Z-[a-f0-9]{12}$/);
      assert.equal(git(['rev-parse', tag], remote), revision);
    }
  }
  const previousTags = git(['tag', '--list'], remote);
  git(['commit', '--allow-empty', '-m', 'Next revision']);
  fs.writeFileSync(path.join(remote, 'hooks/pre-receive'), '#!/usr/bin/env bash\nexit 1\n', { mode: 0o755 });
  const rejected = deploy();
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /local tag .* was retained/);
  assert.equal(git(['rev-parse', 'main'], remote), revision);
  assert.equal(git(['tag', '--list'], remote), previousTags);
  assert.equal(git(['tag', '--list', 'deploy/*']).split('\n').length, 3);
  assert.equal(git(['status', '--porcelain']), '');
});

test('Fly configuration deploys main revisions through deployment tags or manual dispatch', () => {
  const read = (file: string) => fs.readFileSync(path.join(repositoryDirectory, file), 'utf8');
  assert.match(read('fly.toml'), /dockerfile = "ci-cd\/Containerfile"/);
  assert.match(read('.dockerignore'), /^!ci-cd\/Containerfile$/m);
  assert.match(read('.dockerignore'), /^\*\*\/dev-secrets\.env$/m);
  assert.match(read('.gitignore'), /^local-machine\/dev-secrets\.env$/m);
  assert.equal(fs.existsSync(path.join(repositoryDirectory, 'ci-cd/Dockerfile')), false);
  assert.match(read('ci-cd/Containerfile'), /COPY ci-cd\/make-artifacts.sh/);
  assert.match(read('ci-cd/Containerfile'), /COPY ci-cd\/container-scripts\/entrypoint.sh/);
  const workflow = read('.github/workflows/deploy.yml');
  assert.match(workflow, /^\s+push:\s*\n\s+tags: \['deploy\/\*'\]/m);
  assert.match(workflow, /startsWith\(github.ref, 'refs\/tags\/deploy\/'\) && !github.event.deleted/);
  assert.match(workflow, /github.event_name == 'workflow_dispatch' && github.ref == 'refs\/heads\/main' &&\s+\(inputs.action == 'deploy' \|\| inputs.action == 'stop'\)/);
  assert.match(workflow, /options: \[deploy, stop\]/);
  assert.match(workflow, /fetch-depth: 0/);
  assert.match(workflow, /run: git merge-base --is-ancestor HEAD refs\/remotes\/origin\/main/);
  assert.match(workflow, /^\s+workflow_dispatch:/m);
  assert.doesNotMatch(workflow, /^\s+(branches|pull_request|pull_request_target|schedule|workflow_run):/m);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /contents: read/);
  assert.match(workflow, /FLY_API_TOKEN: \$\{\{ secrets.FLY_API_TOKEN \}\}/);
  assert.match(workflow, /DEPLOY_ACTION: \$\{\{ github.event_name == 'push' && 'deploy' \|\| inputs.action \}\}/);
  assert.match(workflow, /run: bash ci-cd\/deploy.sh "\$DEPLOY_ACTION"/);
  assert.match(read('ci-cd/deploy.sh'), /Codespaces secret/);
});
