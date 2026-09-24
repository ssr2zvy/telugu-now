import test from 'node:test';
import assert from 'node:assert/strict';
import {withRequestDeadline} from '../frontend/src/request-deadline';
import {navigate, getProfileState, updateQuestionAudio} from '../frontend/src/api';

test('deadline settles even when the underlying task ignores abort; late results cannot replace the outcome', async () => {
  let signal!: AbortSignal;
  let finish!: (value: string) => void;
  let locked = true;
  const task = withRequestDeadline(s => { signal = s; return new Promise<string>(resolve => {finish=resolve;}); }, 10, 'Timed out')
    .finally(() => {locked=false;});
  await assert.rejects(task, /Timed out/);
  assert.equal(signal.aborted,true); assert.equal(locked,false);
  finish('late');
  await assert.rejects(task,/Timed out/);
  assert.equal(await withRequestDeadline(async ()=>'retry',100,'Timed out'),'retry');
});

test('success and server errors settle immediately without converting errors to timeouts', async () => {
  assert.equal(await withRequestDeadline(async () => 3,100,'timeout'),3);
  await assert.rejects(withRequestDeadline(async () => {throw new Error('server error');},100,'timeout'),/server error/);
});

test('navigation, polling and recording uploads bound hung body reads and network operations', async context => {
  context.mock.timers.enable({apis:['setTimeout']});
  let lastSignal: AbortSignal | undefined;
  context.mock.method(globalThis,'fetch',async (_url: string | URL | Request, options?: RequestInit) => {
    lastSignal=options?.signal as AbortSignal;
    return {ok: true, json:()=>new Promise(()=>{})} as Response;
  });
  const moving=navigate('001','next',{visible:false});
  const movingFailed=assert.rejects(moving,/Navigation timed out/);
  await Promise.resolve(); await Promise.resolve();
  context.mock.timers.tick(15000); await movingFailed;
  assert.equal(lastSignal?.aborted,true);
  const polling=getProfileState('001',false);
  const pollingFailed=assert.rejects(polling,/Refreshing.*timed out/);
  context.mock.timers.tick(15000); await pollingFailed;
  context.mock.method(globalThis,'fetch',(_url: string | URL | Request, options?: RequestInit) => {lastSignal=options?.signal as AbortSignal;return new Promise<Response>(()=>{});});
  const saving=updateQuestionAudio('001','obs',new Blob(['audio'],{type:'audio/mp4'}));
  const savingFailed=assert.rejects(saving,/Recording save timed out/);
  context.mock.timers.tick(45000); await savingFailed;
  assert.equal(lastSignal?.aborted,true);
});
