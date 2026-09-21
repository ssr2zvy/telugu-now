import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import test from 'node:test';
import Database from 'better-sqlite3';
import { refreshAvailability, openAvailability, type AvailabilityOptions } from '../server/src/services/corpus-availability';
import { PreparedCorpusStore } from '../server/src/sources/prepared-corpus/prepared-corpus-store';
import { PreparedCorpusDataSource } from '../server/src/sources/prepared-corpus/prepared-corpus-data-source';
import { SourceRegistry } from '../server/src/services/source-registry';
import { SelectionEngine } from '../server/src/services/selection-engine';
import type { ProfileSelectionSettings } from '../shared/contracts';
import { CorpusObjectStore, type CorpusObject, type CorpusS3Client } from '../server/src/services/corpus-object-store';
import { AudioValidationStore, audioStorageIdentity } from '../server/src/services/audio-validation-store';

function fixture(t: { after: (fn: () => void) => void }): AvailabilityOptions {
  const root = path.join(process.cwd(), 'test-results', `availability-${randomUUID()}`);
  fs.mkdirSync(path.join(root, 'objects'), { recursive: true });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const options: AvailabilityOptions = {
    corpusDatabasePath: path.join(root, 'corpus.sqlite'),
    corpusAvailabilityPath: path.join(root, 'availability.sqlite'),
    corpusObjectsPath: path.join(root, 'objects'),
    corpusBackend: 'local', corpusObjectsPrefix: 'corpus/objects/',
  };
  const db = new Database(options.corpusDatabasePath);
  db.exec(`
    CREATE TABLE sources (
      source_id TEXT PRIMARY KEY, display_name TEXT, provider TEXT, license TEXT, upstream_url TEXT,
      catalog_version INTEGER, accepted_rows INTEGER, rejected_rows INTEGER, complexity_metric TEXT, status TEXT
    );
    INSERT INTO sources VALUES ('fleurs-te', 'FLEURS', 'test', 'test', NULL, 1, 4, 0, 'grapheme-count', 'ready');
    CREATE TABLE source_rows (
      source_id TEXT, source_key TEXT, grapheme_count INTEGER, audio_object_key TEXT, text TEXT,
      audio_sha256 TEXT, audio_mime_type TEXT, duration_seconds REAL, PRIMARY KEY (source_id, source_key)
    );
  `);
  const insert = db.prepare("INSERT INTO source_rows VALUES ('fleurs-te', ?, ?, ?, 'తెలుగు', 'sha', 'audio/wav', 1)");
  insert.run('a', 2, 'a.wav');
  insert.run('b', 2, 'b.wav');
  insert.run('c', 5, 'c.wav');
  // Distinct canonical rows referencing identical audio remain distinct selections.
  insert.run('d', 2, 'a.wav');
  db.close();
  fs.writeFileSync(path.join(options.corpusObjectsPath, 'a.wav'), 'a');
  fs.writeFileSync(path.join(options.corpusObjectsPath, 'b.wav'), '');
  return options;
}

async function* inventory(entries: CorpusObject[]): AsyncIterable<CorpusObject> { yield* entries; }

function engine(store: PreparedCorpusStore, random = () => 0.5): SelectionEngine {
  const registry = new SourceRegistry({ includePreparedSources: false });
  registry.register(new PreparedCorpusDataSource('fleurs-te', store));
  return new SelectionEngine(registry, random);
}

const settings: ProfileSelectionSettings = {
  sourceWeights: { source1: 0, source2: 0, source3: 0, 'fleurs-te': 1 },
  complexityReferenceVersion: 2, complexityPercentileTarget: 0.5, complexityPercentileSpread: 0.25,
};

test('local availability indexes only nonempty audio, densely, without mutating canonical content', async t => {
  const options = fixture(t);
  const original = fs.readFileSync(options.corpusDatabasePath);
  await refreshAvailability(options);
  const store = new PreparedCorpusStore(options.corpusDatabasePath, options);
  t.after(() => store.close());
  assert.equal(store.rowCount('fleurs-te'), 2);
  assert.equal(store.sourceInfo('fleurs-te').acceptedRows, 2);
  assert.deepEqual(store.complexityClasses('fleurs-te'), [{ complexityValue: 2, rowCount: 2 }]);
  assert.equal(store.sourceKeyAt('fleurs-te', 2, 0), 'a');
  assert.equal(store.sourceKeyAt('fleurs-te', 2, 1), 'd');
  assert.throws(() => store.sourceKeyAt('fleurs-te', 2, 2), /KEY_MISSING/);
  assert.equal(store.row('fleurs-te', 'c').text, 'తెలుగు');
  assert.deepEqual(fs.readFileSync(options.corpusDatabasePath), original);
});

test('persistent quarantine removes every row sharing invalid audio and updates generation, counts and exact probabilities', async t => {
  const options = fixture(t);
  fs.writeFileSync(path.join(options.corpusObjectsPath, 'b.wav'), 'b');
  fs.writeFileSync(path.join(options.corpusObjectsPath, 'c.wav'), 'c');
  await refreshAvailability(options);
  const original = fs.readFileSync(options.corpusDatabasePath);
  const report = new AudioValidationStore(path.join(path.dirname(options.corpusAvailabilityPath), 'audio-validation.sqlite'), audioStorageIdentity(options));
  const store = new PreparedCorpusStore(options.corpusDatabasePath, options);
  const selector = engine(store);
  const generation = store.generation;
  const before = selector.describeReference().totalRows;
  assert.equal(store.rowCount('fleurs-te'), 4);
  report.quarantine('a.wav', 'audio-conversion-failed');
  assert.notEqual(store.generation, generation);
  assert.equal(store.rowCount('fleurs-te'), 2);
  assert.equal(store.sourceInfo('fleurs-te').acceptedRows, 2);
  assert.equal(selector.describeReference().totalRows, before - 2);
  assert.equal(store.sourceKeyAt('fleurs-te', 2, 0), 'b');
  assert.throws(() => store.sourceKeyAt('fleurs-te', 2, 1), /KEY_MISSING/);
  let totalProbability = 0;
  for (const random of [0, 1 - Number.EPSILON]) {
    const selected = engine(store, () => random).select(settings);
    assert.equal(selected.snapshot.sourceRowCount, 2);
    assert.ok(['b', 'c'].includes(selected.sourceKey));
    totalProbability += selected.snapshot.overallProbability;
  }
  assert.ok(Math.abs(totalProbability - 1) < 1e-12);
  await refreshAvailability(options);
  store.reloadAvailability();
  assert.equal(store.rowCount('fleurs-te'), 2);
  store.close();
  report.close();
  const restarted = new PreparedCorpusStore(options.corpusDatabasePath, options);
  assert.equal(restarted.rowCount('fleurs-te'), 2);
  assert.equal(restarted.sourceKeyAt('fleurs-te', 2, 0), 'b');
  restarted.close();
  assert.deepEqual(fs.readFileSync(options.corpusDatabasePath), original);
});

test('Tigris paginated uploaded inventory and local files feed identical selection and complexity algorithms', async t => {
  const local = fixture(t);
  const remote = { ...local, corpusBackend: 'tigris', bucketName: 'test', corpusAvailabilityPath: `${local.corpusAvailabilityPath}.remote` };
  fs.writeFileSync(path.join(local.corpusObjectsPath, 'c.wav'), 'c');
  let calls = 0;
  const s3 = new CorpusObjectStore(remote, { send: async () => {
    calls += 1;
    return calls === 1
      ? { Contents: [{ Key: 'corpus/objects/a.wav', Size: 1 }, { Key: 'corpus/objects/b.wav', Size: 0 }], IsTruncated: true, NextContinuationToken: 'next' }
      : { Contents: [{ Key: 'corpus/objects/c.wav', Size: 1 }], IsTruncated: false };
  } } as unknown as CorpusS3Client);
  await refreshAvailability(local);
  await refreshAvailability(remote, s3.inventory());
  const localStore = new PreparedCorpusStore(local.corpusDatabasePath, local);
  const remoteStore = new PreparedCorpusStore(remote.corpusDatabasePath, remote);
  t.after(() => { localStore.close(); remoteStore.close(); });
  const left = engine(localStore), right = engine(remoteStore);
  assert.equal(calls, 2);
  assert.equal(remoteStore.rowCount('fleurs-te'), 3);
  assert.deepEqual(left.describeReference(), right.describeReference());
  assert.deepEqual(left.select(settings), right.select(settings));
  for (const random of [0, 0.1, 0.5, 0.9, 1 - Number.EPSILON]) {
    assert.deepEqual(engine(localStore, () => random).select(settings), engine(remoteStore, () => random).select(settings));
  }
});

test('incremental publication preserves old readers and invalidates selection references at generation boundaries', async t => {
  const options = fixture(t);
  await refreshAvailability(options);
  const store = new PreparedCorpusStore(options.corpusDatabasePath, options);
  t.after(() => store.close());
  const selector = engine(store);
  const before = selector.describeReference().totalRows;
  const generation = store.generation;
  const unchangedBytes = fs.readFileSync(options.corpusAvailabilityPath);
  assert.equal(await refreshAvailability(options), generation);
  assert.deepEqual(fs.readFileSync(options.corpusAvailabilityPath), unchangedBytes);
  fs.writeFileSync(path.join(options.corpusObjectsPath, 'c.wav'), 'c');
  await refreshAvailability(options);
  assert.equal(store.generation, generation);
  assert.equal(store.rowCount('fleurs-te'), 2);
  assert.equal(selector.describeReference().totalRows, before);
  store.reloadAvailability();
  assert.notEqual(store.generation, generation);
  assert.equal(store.rowCount('fleurs-te'), 3);
  assert.equal(selector.describeReference().totalRows, before + 1);
  assert.ok(['a', 'c', 'd'].includes(selector.select(settings).sourceKey));
  fs.unlinkSync(path.join(options.corpusObjectsPath, 'a.wav'));
  await refreshAvailability(options);
  store.reloadAvailability();
  assert.equal(store.rowCount('fleurs-te'), 1);
  assert.equal(store.sourceKeyAt('fleurs-te', 5, 0), 'c');
  assert.equal(selector.select(settings).sourceKey, 'c');
});

test('partial remote inventories, malformed duplicates and local scan failures never replace a good snapshot', async t => {
  const options = fixture(t);
  await refreshAvailability(options);
  const before = fs.readFileSync(options.corpusAvailabilityPath);
  async function* failing(): AsyncIterable<CorpusObject> {
    yield { key: 'c.wav', size: 10 };
    assert.deepEqual(fs.readFileSync(options.corpusAvailabilityPath), before);
    throw new Error('page failed');
  }
  await assert.rejects(refreshAvailability(options, failing()), /page failed/);
  await assert.rejects(refreshAvailability(options, inventory([{ key: 'a.wav', size: 1 }, { key: 'a.wav', size: 1 }])), /UNIQUE/);
  await assert.rejects(refreshAvailability(options, inventory([{ key: '../escape', size: 1 }])), /Invalid/);
  fs.renameSync(options.corpusObjectsPath, `${options.corpusObjectsPath}.away`);
  await assert.rejects(refreshAvailability(options), /ENOENT/);
  assert.deepEqual(fs.readFileSync(options.corpusAvailabilityPath), before);
  assert.equal(fs.readdirSync(path.dirname(options.corpusAvailabilityPath)).some(file => file.includes('.pending')), false);
});

test('missing or backend-mismatched availability never falls back to canonical selection indexes', async t => {
  const options = fixture(t);
  const missing = new PreparedCorpusStore(options.corpusDatabasePath, options);
  assert.equal(missing.rowCount('fleurs-te'), 0);
  missing.close();
  await refreshAvailability(options);
  assert.equal(openAvailability({ ...options, corpusBackend: 'tigris', bucketName: 'test' }), null);
});

test('failed index construction preserves the published snapshot and existing reader', async t => {
  const options = fixture(t);
  await refreshAvailability(options);
  const before = fs.readFileSync(options.corpusAvailabilityPath);
  const store = new PreparedCorpusStore(options.corpusDatabasePath, options);
  t.after(() => store.close());
  const fixtureDatabase = new Database(options.corpusDatabasePath);
  fixtureDatabase.exec("UPDATE source_rows SET grapheme_count = 0 WHERE source_key = 'a'");
  fixtureDatabase.close();
  await assert.rejects(refreshAvailability(options), /CHECK constraint/);
  assert.deepEqual(fs.readFileSync(options.corpusAvailabilityPath), before);
  assert.equal(store.rowCount('fleurs-te'), 2);
  assert.equal(store.sourceKeyAt('fleurs-te', 2, 0), 'a');
  assert.equal(fs.readdirSync(path.dirname(options.corpusAvailabilityPath)).some(file => file.includes('.pending')), false);
});

test('local inventory excludes symlinks escaping the audio root', async t => {
  const options = fixture(t);
  fs.writeFileSync(path.join(path.dirname(options.corpusDatabasePath), 'outside.wav'), 'outside');
  fs.symlinkSync('../outside.wav', path.join(options.corpusObjectsPath, 'c.wav'));
  await refreshAvailability(options);
  const store = new PreparedCorpusStore(options.corpusDatabasePath, options);
  assert.equal(store.rowCount('fleurs-te'), 2);
  store.close();
});

for (const backend of ['local', 'tigris'] as const) {
for (const mode of ['reuse', 'missing', 'invalid', 'incompatible', 'rebuild'] as const) {
test(`${backend} startup availability lifecycle: ${mode}`, { timeout: 20_000 }, async t => {
  const rebuildOnStartup = mode === 'rebuild';
  const failsStartup = mode === 'missing' || mode === 'invalid' || mode === 'incompatible';
  const options = fixture(t);
  const canonical = new Database(options.corpusDatabasePath);
  for (const id of ['shrutilipi-te', 'indicvoices-te']) {
    canonical.prepare("INSERT INTO sources SELECT ?, ?, provider, license, upstream_url, catalog_version, 1, 0, complexity_metric, status FROM sources WHERE source_id = 'fleurs-te'").run(id, id);
    canonical.prepare("INSERT INTO source_rows SELECT ?, source_key, grapheme_count, audio_object_key, text, audio_sha256, audio_mime_type, duration_seconds FROM source_rows WHERE source_id = 'fleurs-te' AND source_key = 'a'").run(id);
  }
  canonical.close();
  let endpoint = '';
  let uploaded = false;
  let inventoryFails = false;
  let inventoryRequests = 0;
  if (backend === 'tigris') {
    const server = createServer((_request, response) => {
      inventoryRequests += 1;
      if (inventoryFails) {
        response.writeHead(503).end();
        return;
      }
      const keys = uploaded ? ['a.wav', 'c.wav'] : ['a.wav'];
      response.setHeader('Content-Type', 'application/xml');
      response.end(`<ListBucketResult><IsTruncated>false</IsTruncated>${keys.map(key =>
        `<Contents><Key>corpus/objects/${key}</Key><Size>1</Size></Contents>`,
      ).join('')}</ListBucketResult>`);
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
      server.closeAllConnections();
    }));
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    endpoint = `http://127.0.0.1:${address.port}`;
  }
  Object.assign(options, {
    corpusBackend: backend,
    ...(backend === 'tigris' ? { bucketName: 'test', awsEndpointUrlS3: endpoint } : {}),
  });
  fs.writeFileSync(path.join(options.corpusObjectsPath, 'c.wav'), 'audio');
  await refreshAvailability(options, inventory([{ key: 'a.wav', size: 1 }, { key: 'c.wav', size: 1 }]));
  fs.unlinkSync(path.join(options.corpusObjectsPath, 'c.wav'));
  if (mode === 'missing') fs.unlinkSync(options.corpusAvailabilityPath);
  if (mode === 'invalid') fs.writeFileSync(options.corpusAvailabilityPath, 'not sqlite');
  if (mode === 'incompatible') {
    const snapshot = new Database(options.corpusAvailabilityPath);
    snapshot.prepare('UPDATE metadata SET identity = ?').run('outdated');
    snapshot.close();
  }
  const originalSnapshot = fs.existsSync(options.corpusAvailabilityPath)
    ? fs.readFileSync(options.corpusAvailabilityPath) : null;
  const entry = process.env.STARTUP_TEST_ENTRY ?? 'server/src/index.ts';
  const production = entry.endsWith('.js');
  const child = spawn(process.execPath, [...(production ? [] : ['--import', 'tsx']), entry], {
    cwd: process.cwd(),
    env: {
      ...process.env, NODE_ENV: production ? 'production' : 'test',
      DATA_DIRECTORY: path.dirname(options.corpusDatabasePath),
      DATABASE_PATH: path.join(path.dirname(options.corpusDatabasePath), 'user/users.sqlite'),
      CORPUS_DATABASE_PATH: options.corpusDatabasePath,
      CORPUS_AVAILABILITY_PATH: options.corpusAvailabilityPath,
      CORPUS_OBJECTS_PATH: options.corpusObjectsPath,
      CORPUS_BACKEND: backend,
      CORPUS_AVAILABILITY_REBUILD_ON_STARTUP: String(rebuildOnStartup),
      ...(backend === 'tigris' ? {
        AWS_ENDPOINT_URL_S3: endpoint, AWS_REGION: 'us-east-1', BUCKET_NAME: 'test',
        CORPUS_OBJECTS_PREFIX: 'corpus/objects/',
        AWS_ACCESS_KEY_ID: 'test', AWS_SECRET_ACCESS_KEY: 'test', AWS_MAX_ATTEMPTS: '1',
      } : {}),
      PORT: '0', API_DEV_PORT: '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const exited = once(child, 'exit');
  let output = '';
  child.stdout.on('data', data => { output += String(data); });
  child.stderr.on('data', data => { output += String(data); });
  async function until(check: () => boolean | Promise<boolean>): Promise<void> {
    for (let attempt = 0; attempt < 150; attempt += 1) {
      if (await check()) return;
      assert.equal(child.exitCode, null, output);
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.fail(`Server condition timed out: ${output}`);
  }
  try {
    if (failsStartup) {
      const [code] = await exited;
      assert.notEqual(code, 0, output);
      assert.match(output, /Snapshot-only startup requires an existing compatible availability.sqlite/);
      assert.equal(output.includes('Server listening on'), false);
      assert.equal(inventoryRequests, 0);
      if (originalSnapshot) assert.deepEqual(fs.readFileSync(options.corpusAvailabilityPath), originalSnapshot);
      else assert.equal(fs.existsSync(options.corpusAvailabilityPath), false);
      return;
    }
    await until(() => output.includes('Server listening on'));
    const url = output.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
    assert.ok(url);
    assert.equal((await fetch(`${url}/api/health`)).status, 200);
    if (production) {
      const frontend = await fetch(url);
      assert.equal(frontend.status, 200);
      assert.match(frontend.headers.get('content-type') ?? '', /text\/html/);
      assert.match(await frontend.text(), /id="root"/);
      assert.equal((await fetch(`${url}/fonts/noto-sans-telugu.woff2`, { method: 'HEAD' })).status, 200);
    }
    async function count(): Promise<number> {
      const response = await fetch(`${url}/api/data-sources`);
      const body = await response.json() as { sources: Array<{ sourceId: string; acceptedRows: number }> };
      return body.sources.find(source => source.sourceId === 'fleurs-te')!.acceptedRows;
    }
    const initialCount = mode === 'reuse' ? 3 : 2;
    await until(async () => await count() === initialCount);
    if (mode === 'reuse') {
      assert.deepEqual(fs.readFileSync(options.corpusAvailabilityPath), originalSnapshot);
      assert.equal(inventoryRequests, 0);
    }
    const snapshot = fs.readFileSync(options.corpusAvailabilityPath);
    const requestsAfterStartup = inventoryRequests;
    fs.writeFileSync(path.join(options.corpusObjectsPath, 'c.wav'), 'audio');
    uploaded = true;
    await new Promise(resolve => setTimeout(resolve, 500));
    assert.equal(await count(), initialCount);
    fs.renameSync(options.corpusObjectsPath, `${options.corpusObjectsPath}.away`);
    inventoryFails = true;
    await new Promise(resolve => setTimeout(resolve, 500));
    assert.equal(await count(), initialCount);
    assert.equal(output.includes('retaining the last complete snapshot'), false);
    assert.deepEqual(fs.readFileSync(options.corpusAvailabilityPath), snapshot);
    assert.equal(inventoryRequests, requestsAfterStartup);
    assert.equal((await fetch(`${url}/api/health`)).status, 200);
  } finally {
    child.kill('SIGTERM');
    await exited;
  }
});
}
}
