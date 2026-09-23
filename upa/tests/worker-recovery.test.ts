import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('stopping a stalled worker releases pending searches and allows a clean restart',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'parser-restart-'));
  const executable=path.join(dir,'worker.py');
  fs.writeFileSync(executable,`#!/usr/bin/env python3
import sys,json,time
print(json.dumps({'ready':True,'stats':{'total':1,'checked':0,'parsed':0,'rejected':0,'tokens':1,'matches':{},'parserVersion':'test','patterns':{}}}),flush=True)
for line in sys.stdin:
 r=json.loads(line)
 if r.get('stall'): time.sleep(60)
 else: print(json.dumps({'id':r['id'],'result':{'row':None,'pending':False,'stats':{'checked':1}}}),flush=True)
`);fs.chmodSync(executable,0o700);
  Object.assign(process.env,{DATA_DIRECTORY:dir,DATABASE_PATH:path.join(dir,'users.sqlite'),CORPUS_BACKEND:'local',PROFILE_CODES:'001',GRAMMAR_PYTHON:executable,GRAMMAR_STARTUP_TIMEOUT_MS:'10000',GRAMMAR_SEARCH_TIMEOUT_MS:'500'});
  const worker=await import('../server/src/parsing/live-worker');
  try {
    await worker.ensureWordWorker();
    await assert.rejects(worker.findWord({stall:true}),/timed out/);
    assert.equal(worker.workerPhase,'failed');
    const result=await worker.findWord({});assert.equal(result.pending,false);assert.equal(worker.workerPhase,'ready');
    const pending=worker.findWord({stall:true});const rejected=assert.rejects(pending,/restarted/);
    await new Promise(resolve=>setTimeout(resolve,50));worker.stopWordWorker();await rejected;
    const retried=await worker.findWord({});assert.equal(retried.pending,false);
  } finally {worker.stopWordWorker();fs.rmSync(dir,{recursive:true,force:true});}
});
