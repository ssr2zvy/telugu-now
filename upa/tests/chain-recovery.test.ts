import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { chainActivity } from '../server/src/parsing/chain-activity';
import { chainWord, targetUnicode } from '../frontend/src/settings/parser-display';
import type { TargetDiagnostic } from '../shared/parsing-diagnostics';

test('saved chain words survive missing in-memory parser patterns',()=>{
  const target={forms:[],pattern:null,example:'పిల్లలు'} as unknown as TargetDiagnostic;
  assert.equal(chainWord('నగరాలవలన',target),'నగరాలవలన');
  assert.deepEqual(targetUnicode(target),['పిల్లలు']);
  assert.equal(chainWord(null,undefined),'No saved word');
});
test('search snapshot preserves queue order, restart history and profile isolation',()=>{
  const db=new Database(':memory:');
  db.exec(`CREATE TABLE live_cycles(id TEXT,profile_code TEXT,core INTEGER,started_at INTEGER,ended_at INTEGER,end_reason TEXT);
    CREATE TABLE live_searches(id TEXT,cycle_id TEXT,target_id TEXT,started_at INTEGER,ended_at INTEGER,checked INTEGER,outcome TEXT);
    CREATE TABLE queue_items(profile_code TEXT,observation_id TEXT,queue_position INTEGER);
    CREATE TABLE observations(id TEXT,status TEXT,preparation_error TEXT);
    CREATE TABLE observation_acquisitions(profile_code TEXT,observation_id TEXT,selection_snapshot_json TEXT,acquisition_number INTEGER);
    CREATE TABLE selection_attempts(observation_id TEXT,target_id TEXT);
    INSERT INTO live_cycles VALUES('old','a',1,1,2,'process-restarted'),('new','a',1,3,NULL,NULL),('other','b',1,4,NULL,NULL);
    INSERT INTO live_searches VALUES('s1','old','plural',1,2,4,'process-restarted'),('s2','new','plural',3,NULL,8,NULL),('s3','other','x',4,NULL,99,NULL);
    INSERT INTO observations VALUES('second','pending',NULL),('first','ready',NULL);
    INSERT INTO queue_items VALUES('a','second',2),('a','first',1);
    INSERT INTO selection_attempts VALUES('second','t2'),('first','t1');`);
  for(const [id,word,n] of [['first','నేను',1],['second','ఇది',2]] as const) db.prepare('INSERT INTO observation_acquisitions VALUES(?,?,?,?)').run('a',id,JSON.stringify({cycleId:'new',word}),n);
  const result=chainActivity(db,'a');
  assert.deepEqual(result.upcoming.map(row=>row.word),['నేను','ఇది']);
  assert.equal(result.activeSearch?.id,'s2');
  assert.deepEqual(result.searchTotals,{total:2,checked:12,matched:0,exhausted:0,interrupted:1});
  assert.deepEqual(result.recentCycles.map(c=>c.id),['new','old']);
  assert.deepEqual(result.recentCycles[0]?.words,['నేను','ఇది']);
  assert.equal(result.recentCycles[1]?.endReason,'process-restarted');
  db.close();
});
