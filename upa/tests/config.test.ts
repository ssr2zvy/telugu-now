import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

const appDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repositoryDirectory = path.dirname(appDirectory);
const configUrl = new URL('../server/src/config/config.ts', import.meta.url).href;
const environmentKeys = [
  'DATA_DIRECTORY', 'DATABASE_PATH', 'CORPUS_DATABASE_PATH', 'CORPUS_OBJECTS_PATH',
  'CORPUS_AVAILABILITY_PATH', 'CORPUS_FREQUENCY_PATH', 'CORPUS_BACKEND', 'CORPUS_OBJECTS_PREFIX',
  'BUCKET_NAME', 'AWS_ENDPOINT_URL_S3', 'AWS_REGION', 'CORPUS_AVAILABILITY_REFRESH_MS',
  'CORPUS_AVAILABILITY_WORKER_ENABLED', 'CORPUS_AVAILABILITY_REBUILD_ON_STARTUP',
  'CORPUS_FREQUENCY_REBUILD_ON_STARTUP',
];

function readConfig(overrides: Record<string, string> = {}, cwd = appDirectory) {
  const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: 'production' };
  for (const key of environmentKeys) delete env[key];
  return spawnSync(process.execPath, [
    '--import', path.join(appDirectory, 'node_modules/tsx/dist/loader.mjs'),
    '--input-type=module', '-e',
    `const { config } = await import(${JSON.stringify(configUrl)}); console.log(JSON.stringify(config));`,
  ], { cwd, env: { ...env, ...overrides }, encoding: 'utf8' });
}

test('default data layout is repository-relative from unrelated working directories', () => {
  const result = readConfig({}, repositoryDirectory);
  assert.equal(result.status, 0, result.stderr);
  const config = JSON.parse(result.stdout);
  const root = path.join(repositoryDirectory, 'local-machine/data');
  assert.equal(config.dataDirectory, root);
  assert.equal(config.databasePath, path.join(root, 'user/users.sqlite'));
  assert.equal(config.corpusDatabasePath, path.join(root, 'corpus/corpus.sqlite'));
  assert.equal(config.corpusAvailabilityPath, path.join(root, 'corpus/availability.sqlite'));
  assert.equal(config.corpusFrequencyPath, path.join(root, 'corpus/frequency.sqlite'));
  assert.equal(config.corpusObjectsPath, path.join(root, 'corpus/objects'));
  assert.equal(config.corpusBackend, 'local');
  assert.equal(config.corpusObjectsPrefix, 'corpus/objects/');
  assert.equal(config.awsRegion, 'auto');
  assert.equal(config.corpusAvailabilityRefreshMs, 7_200_000);
  assert.equal(config.corpusAvailabilityWorkerEnabled, false);
  assert.equal(config.corpusAvailabilityRebuildOnStartup, false);
  assert.equal(config.corpusFrequencyRebuildOnStartup, false);
});

test('frequency snapshot has an independent rebuild switch', () => {
  for (const value of ['true', 'false']) {
    const result = readConfig({ CORPUS_FREQUENCY_REBUILD_ON_STARTUP: value });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).corpusFrequencyRebuildOnStartup, value === 'true');
  }
  for (const value of ['', '1', 'yes', 'FALSE']) {
    const result = readConfig({ CORPUS_FREQUENCY_REBUILD_ON_STARTUP: value });
    assert.notEqual(result.status, 0);
    assert.ok(result.stderr.includes('CORPUS_FREQUENCY_REBUILD_ON_STARTUP must be true or false'));
  }
});

test('availability switches have backend-independent defaults and explicit boolean overrides', () => {
  for (const backend of ['local', 'tigris']) {
    const defaults = readConfig({ CORPUS_BACKEND: backend });
    assert.equal(defaults.status, 0, defaults.stderr);
    assert.equal(JSON.parse(defaults.stdout).corpusAvailabilityWorkerEnabled, false);
    assert.equal(JSON.parse(defaults.stdout).corpusAvailabilityRebuildOnStartup, false);
    for (const worker of ['true', 'false']) {
      for (const rebuild of ['true', 'false']) {
        const result = readConfig({
          CORPUS_BACKEND: backend,
          CORPUS_AVAILABILITY_WORKER_ENABLED: worker,
          CORPUS_AVAILABILITY_REBUILD_ON_STARTUP: rebuild,
        });
        assert.equal(result.status, 0, result.stderr);
        const config = JSON.parse(result.stdout);
        assert.equal(config.corpusAvailabilityWorkerEnabled, worker === 'true');
        assert.equal(config.corpusAvailabilityRebuildOnStartup, rebuild === 'true');
      }
    }
  }
  for (const key of ['CORPUS_AVAILABILITY_WORKER_ENABLED', 'CORPUS_AVAILABILITY_REBUILD_ON_STARTUP']) {
    for (const value of ['', '1', 'yes', 'FALSE']) {
      const result = readConfig({ [key]: value });
      assert.notEqual(result.status, 0);
      assert.ok(result.stderr.includes(`${key} must be true or false`));
    }
  }
});

test('explicit external data mount and backend overrides do not require control_local.sh', () => {
  const root = path.join(appDirectory, 'test-results/config-external-mount');
  const result = readConfig({
    DATA_DIRECTORY: root,
    DATABASE_PATH: path.join(root, 'custom-users.sqlite'),
    CORPUS_DATABASE_PATH: path.join(root, 'catalog.sqlite'),
    CORPUS_AVAILABILITY_PATH: path.join(root, 'available.sqlite'),
    CORPUS_FREQUENCY_PATH: path.join(root, 'frequency-index.sqlite'),
    CORPUS_OBJECTS_PATH: path.join(root, 'audio'),
    CORPUS_BACKEND: 'tigris',
    CORPUS_OBJECTS_PREFIX: 'published/audio/',
    BUCKET_NAME: 'test-bucket',
    AWS_ENDPOINT_URL_S3: 'http://127.0.0.1:9999',
    AWS_REGION: 'test-region',
    CORPUS_AVAILABILITY_REFRESH_MS: '25',
  });
  assert.equal(result.status, 0, result.stderr);
  const config = JSON.parse(result.stdout);
  assert.equal(config.dataDirectory, root);
  assert.equal(config.databasePath, path.join(root, 'custom-users.sqlite'));
  assert.equal(config.corpusDatabasePath, path.join(root, 'catalog.sqlite'));
  assert.equal(config.corpusAvailabilityPath, path.join(root, 'available.sqlite'));
  assert.equal(config.corpusFrequencyPath, path.join(root, 'frequency-index.sqlite'));
  assert.equal(config.corpusObjectsPath, path.join(root, 'audio'));
  assert.equal(config.corpusBackend, 'tigris');
  assert.equal(config.corpusObjectsPrefix, 'published/audio/');
  assert.equal(config.bucketName, 'test-bucket');
  assert.equal(config.awsEndpointUrlS3, 'http://127.0.0.1:9999');
  assert.equal(config.awsRegion, 'test-region');
  assert.equal(config.corpusAvailabilityRefreshMs, 25);
});

test('configuration rejects invalid backend, refresh interval, root and escaping paths', () => {
  for (const value of ['s3', '', 'LOCAL']) {
    const result = readConfig({ CORPUS_BACKEND: value });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /CORPUS_BACKEND must be local or tigris/);
  }
  for (const value of ['0', '-1', '1.5', 'wat', '', 'Infinity', '2147483648']) {
    const result = readConfig({ CORPUS_AVAILABILITY_REFRESH_MS: value });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /CORPUS_AVAILABILITY_REFRESH_MS/);
  }
  const root = path.join(appDirectory, 'test-results/config-mount');
  for (const databasePath of [root, path.join(root, '../outside.sqlite')]) {
    const result = readConfig({ DATA_DIRECTORY: root, DATABASE_PATH: databasePath });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /must stay under DATA_DIRECTORY/);
  }
  assert.notEqual(readConfig({ DATA_DIRECTORY: '' }).status, 0);
  assert.notEqual(readConfig({ DATA_DIRECTORY: path.join(appDirectory, 'package.json') }).status, 0);
  const collision = readConfig({
    DATA_DIRECTORY: root,
    CORPUS_AVAILABILITY_PATH: path.join(root, 'user/users.sqlite'),
  });
  assert.notEqual(collision.status, 0);
  assert.match(collision.stderr, /must be separate files/);
});

test('default shared word image directory follows DATA_DIRECTORY', () => {
  const root = path.join(appDirectory, 'test-results/image-mount');
  const moduleUrl = new URL('../server/src/services/word-image-store.ts', import.meta.url).href;
  const result = spawnSync(process.execPath, [
    '--import', path.join(appDirectory, 'node_modules/tsx/dist/loader.mjs'),
    '--input-type=module', '-e',
    `const { defaultWordImageDirectory } = await import(${JSON.stringify(moduleUrl)}); console.log(defaultWordImageDirectory());`,
  ], { cwd: appDirectory, env: { ...process.env, DATA_DIRECTORY: root, NODE_ENV: 'test' }, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), path.join(root, 'word-images'));
  assert.equal(fs.existsSync(root), false);
});

test('controller offers Python dependencies independently of npm and propagates installer failures', (t) => {
  const scratch = path.join(appDirectory, 'test-results', `python-deps-${randomUUID()}`);
  const scripts = path.join(scratch, 'bin');
  fs.mkdirSync(scripts, { recursive: true });
  fs.mkdirSync(path.join(scratch, 'upa'));
  fs.mkdirSync(path.join(scratch, 'local-machine'));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const controller = path.join(scratch, 'local-machine/control_local.sh');
  fs.copyFileSync(path.join(repositoryDirectory, 'local-machine/control_local.sh'), controller);
  const calls = path.join(scratch, 'calls');
  const stub = (name: string, body: string) => fs.writeFileSync(path.join(scripts, name), `#!/bin/bash\n${body}\n`, { mode: 0o755 });
  stub('id', 'printf "%s\\n" "$TEST_UID"');
  stub('npm', 'printf "npm %s\\n" "$*" >> "$TEST_CALLS"\n[[ "$*" == "ls --depth=0 --silent" ]]');
  stub('sudo', `printf 'sudo %s\n' "$*" >> "$TEST_CALLS"
[[ "$TEST_SUDO_FAIL" != "yes" ]] || exit 1
[[ "$1" == "-n" ]] || exit 99
shift
exec "$@"`);
  stub('apt-get', `printf 'apt-get %s\n' "$*" >> "$TEST_CALLS"
[[ "$1" != "$TEST_APT_FAIL_STAGE" ]] || exit 23`);
  const run = (overrides: NodeJS.ProcessEnv = {}, interactive = false) => {
    fs.writeFileSync(calls, '');
    return spawnSync('bash', [controller, 'deps', ...(interactive ? [] : ['--option', 'install-python'])], {
      cwd: '/', encoding: 'utf8', input: interactive ? '2\n' : undefined,
      env: { ...process.env, PATH: `${scripts}:${process.env.PATH}`, TEST_CALLS: calls, TEST_UID: '1000',
        TEST_SUDO_FAIL: 'no', TEST_APT_FAIL_STAGE: '', ...overrides },
    });
  };
  const packages = 'apt-get install -y --no-install-recommends python3 python3-numpy python3-scipy python3-soundfile espeak-ng';
  const missing = run();
  assert.equal(missing.status, 0, missing.stderr);
  assert.match(missing.stdout, /1\) install\n2\) install-python\n3\) exit/);
  assert.ok(fs.readFileSync(calls, 'utf8').includes(packages));
  assert.equal(fs.existsSync(path.join(scratch, 'upa/node_modules')), false);
  assert.equal(fs.existsSync(path.join(scratch, 'upa/.control/deps.lock')), false);

  fs.mkdirSync(path.join(scratch, 'upa/node_modules'));
  const installed = run({ TEST_UID: '0' }, true);
  assert.equal(installed.status, 0, installed.stderr);
  assert.match(installed.stdout, /1\) reinstall\n2\) install-python\n3\) exit/);
  assert.ok(fs.readFileSync(calls, 'utf8').includes(packages));
  assert.doesNotMatch(fs.readFileSync(calls, 'utf8'), /sudo|npm ci|npm install/);

  const denied = run({ TEST_SUDO_FAIL: 'yes' });
  assert.equal(denied.status, 1);
  assert.match(denied.stderr, /Run sudo -v in your terminal/);
  assert.doesNotMatch(fs.readFileSync(calls, 'utf8'), /apt-get/);
  assert.equal(fs.existsSync(path.join(scratch, 'upa/.control/deps.lock')), false);

  for (const stage of ['update', 'install']) {
    const failed = run({ TEST_APT_FAIL_STAGE: stage });
    assert.equal(failed.status, 23, failed.stderr);
    assert.doesNotMatch(failed.stdout, /dependencies installed\./);
    assert.equal(fs.existsSync(path.join(scratch, 'upa/.control/deps.lock')), false);
    if (stage === 'update') assert.ok(!fs.readFileSync(calls, 'utf8').includes(packages));
  }

  fs.mkdirSync(path.join(scratch, 'upa/.control/deps.lock'));
  const locked = run();
  assert.equal(locked.status, 1);
  assert.match(locked.stderr, /another control action/);
  assert.doesNotMatch(fs.readFileSync(calls, 'utf8'), /apt-get|sudo/);
});

test('controller requires local prepared data but never generates a corpus for Tigris', (t) => {
  const scratch = path.join(appDirectory, 'test-results', `controller-${randomUUID()}`);
  fs.mkdirSync(scratch, { recursive: true });
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const npmStub = path.join(scratch, 'npm');
  fs.writeFileSync(npmStub, `#!/usr/bin/env node
console.log('npm ' + process.argv.slice(2).join(' '));
console.log('alignment-python:' + process.env.AUDIO_ALIGNMENT_PYTHON);
console.log('dev-config:' + ['CORPUS_BACKEND', 'CORPUS_AVAILABILITY_WORKER_ENABLED', 'CORPUS_AVAILABILITY_REBUILD_ON_STARTUP', 'DATA_DIRECTORY', 'CORPUS_DATABASE_PATH', 'API_DEV_PORT'].map(key => process.env[key]).join('|'));
if (process.env.CHECK_LOCAL_SECRETS === 'true') {
  if (process.env.LOCAL_TEST_SECRET !== 'literal $(echo must-not-run) # value') process.exit(31);
  if (process.env.pollinations_api_key !== process.env.EXPECTED_TEST_KEY) process.exit(32);
  if (process.env.serper_api_key !== 'serper-file-fixture-key') process.exit(33);
  console.log('local-secrets-ok');
}
process.exit(Number(process.env.TEST_NPM_EXIT || 0));
`, { mode: 0o755 });
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of environmentKeys) delete env[key];
  delete env.API_DEV_PORT;
  delete env.AUDIO_ALIGNMENT_PYTHON;
  Object.assign(env, { DATA_DIRECTORY: path.join(scratch, 'mount'), PATH: `${scratch}:${process.env.PATH}` });
  fs.mkdirSync(path.join(scratch, 'upa'));
  fs.mkdirSync(path.join(scratch, 'local-machine'));
  const controller = path.join(scratch, 'local-machine', 'control_local.sh');
  fs.copyFileSync(path.join(repositoryDirectory, 'local-machine', 'control_local.sh'), controller);
  const devEnvironment = path.join(scratch, 'local-machine', 'dev.env');
  fs.copyFileSync(path.join(repositoryDirectory, 'local-machine', 'dev.env'), devEnvironment);
  const args = [controller, 'dev', '--option', 'start'];
  const local = spawnSync('bash', args, { env, encoding: 'utf8' });
  assert.notEqual(local.status, 0);
  assert.match(local.stderr, /CORPUS_NOT_PREPARED/);
  const remote = spawnSync('bash', args, { env: { ...env, CORPUS_BACKEND: 'tigris' }, encoding: 'utf8' });
  assert.equal(remote.status, 0, remote.stderr);
  assert.match(remote.stdout, /^npm run dev$/m);
  assert.match(remote.stdout, /^alignment-python:\/usr\/bin\/python3$/m);
  assert.equal(fs.existsSync(path.join(scratch, 'mount')), false);
  const invalid = spawnSync('bash', args, { env: { ...env, CORPUS_BACKEND: 's3' }, encoding: 'utf8' });
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stderr, /CORPUS_BACKEND must be local or tigris/);
  const corpusPath = path.join(scratch, 'mount', 'custom-corpus');
  fs.mkdirSync(corpusPath, { recursive: true });
  fs.writeFileSync(path.join(corpusPath, 'catalog.sqlite'), '');
  fs.writeFileSync(path.join(corpusPath, 'manifest.json'), '{}');
  const prepared = spawnSync('bash', args, {
    env: { ...env, CORPUS_DATABASE_PATH: path.join(corpusPath, 'catalog.sqlite') }, encoding: 'utf8',
  });
  assert.equal(prepared.status, 0, prepared.stderr);
  assert.match(prepared.stdout, /^npm run dev$/m);
  assert.deepEqual(prepared.stdout.split('\n').find(line => line.startsWith('dev-config:'))?.slice(11).split('|'), [
    'local', 'false', 'true', path.join(scratch, 'mount'), path.join(corpusPath, 'catalog.sqlite'), '8787',
  ]);

  const overridden = spawnSync('bash', args, {
    env: { ...env, CORPUS_BACKEND: 'tigris', CORPUS_AVAILABILITY_REBUILD_ON_STARTUP: 'false', API_DEV_PORT: '9898', AUDIO_ALIGNMENT_PYTHON: '/custom/python' },
    encoding: 'utf8',
  });
  assert.equal(overridden.status, 0, overridden.stderr);
  assert.match(overridden.stdout, /^alignment-python:\/custom\/python$/m);
  assert.deepEqual(overridden.stdout.split('\n').find(line => line.startsWith('dev-config:'))?.slice(11).split('|'), [
    'tigris', 'false', 'false', path.join(scratch, 'mount'), path.join(scratch, 'mount/corpus/corpus.sqlite'), '9898',
  ]);

  const defaultsEnv = { ...env };
  delete defaultsEnv.DATA_DIRECTORY;
  const defaultCorpus = path.join(scratch, 'local-machine/data/corpus');
  fs.mkdirSync(defaultCorpus, { recursive: true });
  fs.writeFileSync(path.join(defaultCorpus, 'corpus.sqlite'), '');
  fs.writeFileSync(path.join(defaultCorpus, 'manifest.json'), '{}');
  const defaults = spawnSync('bash', args, { env: defaultsEnv, cwd: '/', encoding: 'utf8' });
  assert.equal(defaults.status, 0, defaults.stderr);
  assert.deepEqual(defaults.stdout.split('\n').find(line => line.startsWith('dev-config:'))?.slice(11).split('|'), [
    'local', 'false', 'true', path.join(scratch, 'local-machine/data'), path.join(defaultCorpus, 'corpus.sqlite'), '8787',
  ]);

  const secretsFile = path.join(scratch, 'local-machine/dev-secrets.env');
  fs.writeFileSync(secretsFile, `LOCAL_TEST_SECRET='literal $(echo must-not-run) # value'
pollinations_api_key="\${pollinations_api_key-file-fixture-key}"
serper_api_key='serper-file-fixture-key'
CORPUS_BACKEND="\${TEST_SECRET_BACKEND-$CORPUS_BACKEND}"
`);
  const secretsEnv: NodeJS.ProcessEnv = { ...env, CORPUS_BACKEND: 'tigris', CHECK_LOCAL_SECRETS: 'true', EXPECTED_TEST_KEY: 'file-fixture-key' };
  delete secretsEnv.pollinations_api_key;
  delete secretsEnv.LOCAL_TEST_SECRET;
  const fromFile = spawnSync('bash', args, { env: secretsEnv, cwd: '/', encoding: 'utf8' });
  assert.equal(fromFile.status, 0, fromFile.stderr);
  assert.match(fromFile.stdout, /local-secrets-ok/);
  assert.doesNotMatch(fromFile.stdout + fromFile.stderr, /file-fixture-key|literal \$\(/);
  const inherited = spawnSync('bash', args, {
    env: { ...secretsEnv, pollinations_api_key: 'inherited-fixture-key', EXPECTED_TEST_KEY: 'inherited-fixture-key' },
    encoding: 'utf8',
  });
  assert.equal(inherited.status, 0, inherited.stderr);
  assert.match(inherited.stdout, /local-secrets-ok/);
  assert.doesNotMatch(inherited.stdout + inherited.stderr, /inherited-fixture-key|file-fixture-key/);
  const failedNpm = spawnSync('bash', args, { env: { ...secretsEnv, TEST_NPM_EXIT: '19' }, encoding: 'utf8' });
  assert.equal(failedNpm.status, 19);

  const beforeChecks = spawnSync('bash', args, {
    env: { ...secretsEnv, TEST_SECRET_BACKEND: 'invalid' }, encoding: 'utf8',
  });
  assert.notEqual(beforeChecks.status, 0);
  assert.match(beforeChecks.stderr, /CORPUS_BACKEND must be local or tigris/);
  assert.doesNotMatch(beforeChecks.stdout, /^npm run dev$/m);
  fs.writeFileSync(secretsFile, 'return 37\n');
  const failedSource = spawnSync('bash', args, { env: secretsEnv, encoding: 'utf8' });
  assert.equal(failedSource.status, 37);
  assert.doesNotMatch(failedSource.stdout, /^npm run dev$/m);

  fs.unlinkSync(devEnvironment);
  const missing = spawnSync('bash', args, { env, encoding: 'utf8' });
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /dev\.env/);
  assert.doesNotMatch(missing.stdout, /^npm run dev$/m);
  for (const domain of ['dev', 'data', 'test', 'build', 'deps']) {
    const exited = spawnSync('bash', [controller, domain, '--option', 'exit'], { env, encoding: 'utf8' });
    assert.equal(exited.status, 0, exited.stderr);
    assert.doesNotMatch(exited.stderr, /dev\.env/);
  }
});
