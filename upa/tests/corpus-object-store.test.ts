import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import Database from 'better-sqlite3';
import { GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { CorpusObjectStore, type CorpusS3Client, isSafeObjectKey } from '../server/src/services/corpus-object-store';

function storeWith(send: (command: any) => Promise<any>) {
  return new CorpusObjectStore({
    bucketName: 'test-bucket', corpusObjectsPrefix: 'corpus/objects/',
  }, { send } as CorpusS3Client);
}

async function fixture(run: (directory: string) => Promise<void>) {
  const directory = path.resolve(`.test-corpus-object-store-${randomUUID()}`);
  await mkdir(directory);
  try { await run(directory); } finally { await rm(directory, { recursive: true, force: true }); }
}

function createCanonical(database: Database.Database): void {
  database.exec(`
    CREATE TABLE sources (
      source_id TEXT, display_name TEXT, provider TEXT, license TEXT, upstream_url TEXT,
      catalog_version INTEGER, accepted_rows INTEGER, rejected_rows INTEGER, complexity_metric TEXT, status TEXT
    );
    CREATE TABLE source_rows (
      source_id TEXT, source_key TEXT, text TEXT, grapheme_count INTEGER, audio_sha256 TEXT,
      audio_object_key TEXT, audio_mime_type TEXT, duration_seconds REAL
    );
  `);
}

test('inventory validates and streams all pages as relative keys', async () => {
  const commands: ListObjectsV2Command[] = [];
  const store = storeWith(async command => {
    assert.ok(command instanceof ListObjectsV2Command);
    commands.push(command);
    if (!command.input.ContinuationToken) return {
      Contents: [{ Key: 'corpus/objects/media/a.wav', Size: 12 }, { Key: 'corpus/objects/', Size: 0 }],
      IsTruncated: true, NextContinuationToken: 'next',
    };
    return { Contents: [{ Key: 'corpus/objects/media/b.flac', Size: 32 }], IsTruncated: false };
  });
  const objects = [];
  for await (const object of store.inventory()) objects.push(object);
  assert.deepEqual(objects, [{ key: 'media/a.wav', size: 12 }, { key: 'media/b.flac', size: 32 }]);
  assert.equal(commands.length, 2);
  assert.equal(commands[0]!.input.Bucket, 'test-bucket');
  assert.equal(commands[0]!.input.Prefix, 'corpus/objects/');
  assert.equal(commands[1]!.input.ContinuationToken, 'next');
});

test('inventory rejects malformed pages before yielding them', async () => {
  for (const page of [
    {}, { IsTruncated: true }, { IsTruncated: true, NextContinuationToken: '' },
    { IsTruncated: false, Contents: [{ Key: 'outside/a', Size: 1 }] },
    { IsTruncated: false, Contents: [{ Key: 'corpus/objects/a', Size: -1 }] },
    { IsTruncated: false, Contents: [{ Key: 'corpus/objects/a', Size: 1.5 }] },
    { IsTruncated: false, Contents: [{ Key: 'corpus/objects/a' }] },
    { IsTruncated: false, Contents: [{ Key: 'corpus/objects/../a', Size: 1 }] },
    { IsTruncated: false, Contents: [{ Key: 'corpus/objects/a', Size: 1 }, { Size: 2 }] },
  ]) {
    await assert.rejects(storeWith(async () => page).inventory()[Symbol.asyncIterator]().next());
  }
});

test('inventory rejects repeated continuation tokens and propagates late listing failures', async () => {
  let calls = 0;
  const repeated = storeWith(async () => ({
    Contents: [{ Key: `corpus/objects/${calls++}.wav`, Size: 1 }],
    IsTruncated: true, NextContinuationToken: 'same',
  })).inventory()[Symbol.asyncIterator]();
  assert.equal((await repeated.next()).value.key, '0.wav');
  await assert.rejects(repeated.next(), /continuation token/);
  const failed = storeWith(async command => {
    if (command.input.ContinuationToken) throw new Error('listing unavailable');
    return { Contents: [{ Key: 'corpus/objects/a.wav', Size: 1 }], IsTruncated: true, NextContinuationToken: 'next' };
  }).inventory()[Symbol.asyncIterator]();
  await failed.next();
  await assert.rejects(failed.next(), /listing unavailable/);
});

test('object keys and prefixes reject traversal, encoded separators and control characters', () => {
  for (const key of ['', '/a', 'a/', '../a', 'a/../b', 'a//b', 'a\\b', 'a\0b', 'a%2fb', 'a%5cb', '%252e%252e/a']) {
    assert.equal(isSafeObjectKey(key), false, key);
  }
  assert.equal(isSafeObjectKey('media/a b.wav'), true);
  assert.throws(() => new CorpusObjectStore({ bucketName: 'bucket', corpusObjectsPrefix: '../objects/' }, {} as CorpusS3Client));
});

test('bootstrap downloads canonical key, validates SQLite and preserves existing cache', async () => {
  await fixture(async directory => {
    const source = path.join(directory, 'source.sqlite');
    const db = new Database(source);
    db.pragma('journal_mode = WAL');
    createCanonical(db);
    db.close();
    const bytes = await readFile(source);
    let calls = 0;
    const store = storeWith(async command => {
      assert.ok(command instanceof GetObjectCommand);
      assert.equal(command.input.Key, 'corpus/corpus.sqlite');
      calls++;
      return { Body: Readable.from([bytes.subarray(0, 50), bytes.subarray(50)]), ContentLength: bytes.length };
    });
    const target = path.join(directory, 'cache', 'corpus.sqlite');
    assert.equal(await store.ensureCorpusDatabase(target), true);
    assert.deepEqual(await readFile(target), bytes);
    assert.equal(await store.ensureCorpusDatabase(target), false);
    assert.equal(calls, 1);
    assert.deepEqual(await readdir(path.dirname(target)), ['corpus.sqlite']);
  });
});

test('bootstrap cleans staged files after invalid SQLite, short download and streaming failure', async () => {
  await fixture(async directory => {
    for (const result of [
      { Body: Readable.from(['not SQLite']) },
      { Body: Readable.from(['SQLite format 3\0']) },
      { Body: Readable.from(['short']), ContentLength: 99 },
      { Body: Readable.from((async function* () { yield Buffer.from('partial'); throw new Error('stream failed'); })()) },
      {},
    ]) {
      const target = path.join(directory, 'corpus.sqlite');
      await assert.rejects(storeWith(async () => result).ensureCorpusDatabase(target));
      assert.deepEqual(await readdir(directory), []);
    }
  });
});

test('bootstrap never overwrites a cache created during download', async () => {
  await fixture(async directory => {
    const source = path.join(directory, 'source.sqlite');
    const db = new Database(source);
    createCanonical(db);
    db.close();
    const bytes = await readFile(source);
    const target = path.join(directory, 'corpus.sqlite');
    const store = storeWith(async () => {
      await writeFile(target, 'other process cache');
      return { Body: Readable.from([bytes]), ContentLength: bytes.length };
    });

    assert.equal(await store.ensureCorpusDatabase(target), false);
    assert.equal(await readFile(target, 'utf8'), 'other process cache');
    assert.deepEqual((await readdir(directory)).sort(), ['corpus.sqlite', 'source.sqlite']);
  });
});

test('bootstrap rejects a valid SQLite file with the wrong corpus schema before publishing', async () => {
  await fixture(async directory => {
    const source = path.join(directory, 'wrong.sqlite');
    const database = new Database(source);
    database.exec('CREATE TABLE unrelated (id TEXT)');
    database.close();
    const bytes = await readFile(source);
    await assert.rejects(storeWith(async () => ({ Body: Readable.from([bytes]) })).ensureCorpusDatabase(path.join(directory, 'corpus.sqlite')));
    assert.deepEqual(await readdir(directory), ['wrong.sqlite']);
  });
});
