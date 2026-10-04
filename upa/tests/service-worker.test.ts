import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('service worker retires offline caches and unregisters itself', () => {
  const worker = readFileSync(new URL('../frontend/public/service-worker.js', import.meta.url), 'utf8');
  const gate = readFileSync(new URL('../server/src/access/gate.ts', import.meta.url), 'utf8');
  assert.match(worker, /self\.addEventListener\('install',\(\)=>self\.skipWaiting\(\)\);/);
  assert.match(worker, /self\.addEventListener\('activate',event=>event\.waitUntil\(caches\.keys\(\)\.then\(keys=>Promise\.all\(keys\.filter\(k=>k\.startsWith\('telugu-now-'\)\)\.map\(k=>caches\.delete\(k\)\)\)\)\.then\(\(\)=>self\.clients\.claim\(\)\)\.then\(\(\)=>self\.registration\.unregister\(\)\)\)\);/);
  assert.doesNotMatch(worker, /cache\.put|caches\.open\(|response\.clone\(/);
  assert.match(gate, /export const retireOfflineCache = `self\.addEventListener\('install',\(\)=>self\.skipWaiting\(\)\);/);
  assert.match(gate, /retireOfflineCache/);
});
