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
  'CORPUS_AVAILABILITY_PATH', 'CORPUS_BACKEND', 'CORPUS_OBJECTS_PREFIX',
  'BUCKET_NAME', 'AWS_ENDPOINT_URL_S3', 'AWS_REGION', 'CORPUS_AVAILABILITY_REFRESH_MS',
  'CORPUS_AVAILABILITY_WORKER_ENABLED', 'CORPUS_AVAILABILITY_REBUILD_ON_STARTUP',
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
  const root = path.join(repositoryDirectory, 'data');
  assert.equal(config.dataDirectory, root);
  assert.equal(config.databasePath, path.join(root, 'user/users.sqlite'));
  assert.equal(config.corpusDatabasePath, path.join(root, 'corpus/corpus.sqlite'));
  assert.equal(config.corpusAvailabilityPath, path.join(root, 'corpus/availability.sqlite'));
  assert.equal(config.corpusObjectsPath, path.join(root, 'corpus/objects'));
  assert.equal(config.corpusBackend, 'local');
  assert.equal(config.corpusObjectsPrefix, 'corpus/objects/');
  assert.equal(config.awsRegion, 'auto');
  assert.equal(config.corpusAvailabilityRefreshMs, 7_200_000);
  assert.equal(config.corpusAvailabilityWorkerEnabled, false);
  assert.equal(config.corpusAvailabilityRebuildOnStartup, false);
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

test('explicit external data mount and backend overrides do not require control.sh', () => {
  const root = path.join(appDirectory, 'test-results/config-external-mount');
  const result = readConfig({
    DATA_DIRECTORY: root,
    DATABASE_PATH: path.join(root, 'custom-users.sqlite'),
    CORPUS_DATABASE_PATH: path.join(root, 'catalog.sqlite'),
    CORPUS_AVAILABILITY_PATH: path.join(root, 'available.sqlite'),
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

test('controller requires local prepared data but never generates a corpus for Tigris', (t) => {
  const scratch = path.join(appDirectory, 'test-results', `controller-${randomUUID()}`);
  fs.mkdirSync(scratch, { recursive: true });
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const npmStub = path.join(scratch, 'npm');
  fs.writeFileSync(npmStub, '#!/usr/bin/env bash\nprintf "npm %s\\n" "$*"\n', { mode: 0o755 });
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of environmentKeys) delete env[key];
  Object.assign(env, { DATA_DIRECTORY: path.join(scratch, 'mount'), PATH: `${scratch}:${process.env.PATH}` });
  fs.mkdirSync(path.join(scratch, 'upa'));
  const controller = path.join(scratch, 'control.sh');
  fs.copyFileSync(path.join(repositoryDirectory, 'control.sh'), controller);
  const args = [controller, 'dev', '--option', 'start'];
  const local = spawnSync('bash', args, { env, encoding: 'utf8' });
  assert.notEqual(local.status, 0);
  assert.match(local.stderr, /CORPUS_NOT_PREPARED/);
  const remote = spawnSync('bash', args, { env: { ...env, CORPUS_BACKEND: 'tigris' }, encoding: 'utf8' });
  assert.equal(remote.status, 0, remote.stderr);
  assert.match(remote.stdout, /^npm run dev$/m);
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
});
