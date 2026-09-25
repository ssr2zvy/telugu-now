import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { resetCoreProgress } from '../server/src/services/reset-core-progress';

test('core resets isolate the profile and core while retiring pending progress', () => {
  const db = new Database(':memory:');
  try {
    db.exec(`CREATE TABLE core_progress(profile_code TEXT,core INTEGER);
      CREATE TABLE core_streaks(profile_code TEXT,core INTEGER,streak INTEGER);
      CREATE TABLE core_used(profile_code TEXT,core INTEGER);
      CREATE TABLE core_batches(profile_code TEXT,applied INTEGER);
      INSERT INTO core_progress VALUES('a',2),('b',1);
      INSERT INTO core_streaks VALUES('a',1,3),('a',2,2),('a',3,1),('b',2,3);
      INSERT INTO core_used VALUES('a',1),('a',2),('b',2);
      INSERT INTO core_batches VALUES('a',0),('a',1),('b',0);`);
    assert.equal(resetCoreProgress(db,'a','core'),2);
    assert.deepEqual(db.prepare('SELECT core FROM core_streaks WHERE profile_code=? ORDER BY core').all('a'),[{core:1},{core:3}]);
    assert.equal((db.prepare("SELECT COUNT(*) n FROM core_batches WHERE profile_code='a' AND applied=0").get() as {n:number}).n,0);
    assert.equal((db.prepare("SELECT applied FROM core_batches WHERE profile_code='b'").get() as {applied:number}).applied,0);
    assert.equal(resetCoreProgress(db,'a','all'),1);
    assert.deepEqual(db.prepare("SELECT * FROM core_streaks WHERE profile_code='a'").all(),[]);
    assert.deepEqual(db.prepare("SELECT * FROM core_used WHERE profile_code='a'").all(),[]);
    assert.equal((db.prepare("SELECT COUNT(*) n FROM core_streaks WHERE profile_code='b'").get() as {n:number}).n,1);
    db.prepare("UPDATE core_progress SET core=4 WHERE profile_code='a'").run();
    assert.equal(resetCoreProgress(db,'a','core'),3,'completed programme restarts its last core');
  } finally { db.close(); }
});
