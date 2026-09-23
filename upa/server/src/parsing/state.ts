import { coreEvent, initializeCoreDiagnostics } from './audit';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { db } from '../db/database';
import { config } from '../config/config';

export type SelectionMode = 'weighted' | 'core' | 'random';
export const parsingDirectory = path.join(config.dataDirectory, 'corpus', 'parsing');
const devAssets = path.resolve('../data-transform/scripts/parse-core');
export const parsingAssets = process.env.PARSING_ASSETS_DIRECTORY ?? (fs.existsSync(devAssets) ? devAssets : path.resolve('dist/server/parse-core'));
export interface CoreTarget { id: string; core: number; kind: 'vocabulary' | 'chain'; label: string; example?: string; forms?: string[]; chain?: string[]; chain_alternatives?: string[][]; neighbors: string[]; }
export interface CoreGraph { nodes: Record<string, CoreTarget>; edges: Array<{ left: string; right: string; core: number }>; }
let loadedGraph: CoreGraph | undefined;
export function graph(): CoreGraph { return loadedGraph ??= JSON.parse(fs.readFileSync(path.join(parsingAssets, 'graph.json'), 'utf8')) as CoreGraph; }
let loadedFingerprint: string | undefined;
export function parserFingerprint(): string {
  if (loadedFingerprint) return loadedFingerprint;
  const files: string[] = [];
  const visit = (directory: string) => { for (const e of fs.readdirSync(directory, { withFileTypes: true })) {
    if (e.name === '__pycache__') continue;
    const file = path.join(directory, e.name);
    if (e.isDirectory()) visit(file); else if (/\.(py|json)$/u.test(file)) files.push(file);
  } };
  visit(parsingAssets);
  const hash = createHash('sha256');
  for (const file of files.sort()) { hash.update(path.relative(parsingAssets, file).split(path.sep).join('/')); hash.update(fs.readFileSync(file)); }
  return loadedFingerprint = hash.digest('hex');
}
export const textHash = (text: string) => createHash('sha256').update(text.normalize('NFC').trim().replace(/\s+/gu, ' ')).digest('hex');

db.exec(`
CREATE TABLE IF NOT EXISTS parsing_system(id INTEGER PRIMARY KEY CHECK(id=1),catalog_path TEXT,inventory_id TEXT,corpus_stamp TEXT,job_json TEXT NOT NULL DEFAULT '{}');
INSERT OR IGNORE INTO parsing_system(id) VALUES(1);
CREATE TABLE IF NOT EXISTS selection_modes(profile_code TEXT PRIMARY KEY REFERENCES profiles(code) ON DELETE CASCADE,mode TEXT NOT NULL DEFAULT 'weighted' CHECK(mode IN('weighted','core','random')));
CREATE TABLE IF NOT EXISTS parked_queues(profile_code TEXT NOT NULL REFERENCES profiles(code) ON DELETE CASCADE,mode TEXT NOT NULL,queue_position INTEGER NOT NULL,observation_id TEXT NOT NULL UNIQUE REFERENCES observations(id) ON DELETE CASCADE,PRIMARY KEY(profile_code,mode,queue_position));
CREATE TABLE IF NOT EXISTS core_progress(profile_code TEXT PRIMARY KEY REFERENCES profiles(code) ON DELETE CASCADE,inventory_id TEXT NOT NULL,core INTEGER NOT NULL DEFAULT 1 CHECK(core BETWEEN 1 AND 4));
CREATE TABLE IF NOT EXISTS core_streaks(profile_code TEXT NOT NULL REFERENCES profiles(code) ON DELETE CASCADE,inventory_id TEXT NOT NULL,core INTEGER NOT NULL,target_id TEXT NOT NULL,streak INTEGER NOT NULL CHECK(streak BETWEEN 0 AND 3),PRIMARY KEY(profile_code,inventory_id,target_id));
CREATE TABLE IF NOT EXISTS core_used(profile_code TEXT NOT NULL REFERENCES profiles(code) ON DELETE CASCADE,core INTEGER NOT NULL,text_hash TEXT NOT NULL,first_observation_id TEXT NOT NULL,displayed_at INTEGER NOT NULL,PRIMARY KEY(profile_code,core,text_hash));
CREATE TABLE IF NOT EXISTS core_batches(id TEXT PRIMARY KEY,profile_code TEXT NOT NULL REFERENCES profiles(code) ON DELETE CASCADE,inventory_id TEXT NOT NULL,core INTEGER NOT NULL,size INTEGER NOT NULL DEFAULT 0,applied INTEGER NOT NULL DEFAULT 0,snapshot_json TEXT NOT NULL,end_reason TEXT);
CREATE TABLE IF NOT EXISTS selection_attempts(observation_id TEXT PRIMARY KEY REFERENCES observations(id) ON DELETE CASCADE,profile_code TEXT NOT NULL REFERENCES profiles(code) ON DELETE CASCADE,mode TEXT NOT NULL,batch_id TEXT REFERENCES core_batches(id) ON DELETE CASCADE,slot INTEGER,target_id TEXT,core INTEGER,text_hash TEXT,result INTEGER CHECK(result IN(0,1)),displayed_at INTEGER,answered_at INTEGER,UNIQUE(batch_id,slot));
CREATE INDEX IF NOT EXISTS attempts_for_batch ON selection_attempts(batch_id,slot);
CREATE INDEX IF NOT EXISTS attempts_for_profile_core ON selection_attempts(profile_code,core,displayed_at);
`);

initializeCoreDiagnostics();

export interface ParsingSystem { catalog_path: string | null; inventory_id: string | null; corpus_stamp: string | null; job_json: string }
export const system = () => db.prepare('SELECT * FROM parsing_system WHERE id=1').get() as ParsingSystem;
export const selectionMode = (_profile: string): SelectionMode => 'core';
let cachedInventoryId:string|undefined;
export function inventoryId(): string {
  if(cachedInventoryId)return cachedInventoryId;
  const stable = (value: any): any => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(k => [k, stable(value[k])])) : value;
  return cachedInventoryId=createHash('sha256').update(JSON.stringify(stable(graph()))).digest('hex');
}
db.exec(`CREATE TABLE IF NOT EXISTS live_profile_install(profile_code TEXT PRIMARY KEY REFERENCES profiles(code) ON DELETE CASCADE, installed_at INTEGER NOT NULL)`);
export function initializeMode(profile: string): void {
  if(db.prepare('SELECT 1 FROM live_profile_install WHERE profile_code=?').get(profile))return;
  db.transaction(()=>{
    // Preserve displayed history and streaks; retire old undisplayed reservations.
    db.prepare('DELETE FROM queue_items WHERE profile_code=?').run(profile);
    db.prepare('UPDATE core_batches SET applied=1 WHERE profile_code=? AND applied=0').run(profile);
    db.prepare("INSERT INTO selection_modes(profile_code,mode) VALUES(?,'core') ON CONFLICT(profile_code) DO UPDATE SET mode='core'").run(profile);
    db.prepare('INSERT INTO live_profile_install VALUES(?,?)').run(profile,Date.now());
    coreEvent(profile,'live-mode-installed',{}, {policy:'frequency-word-cache-v1'});
  })();
}
export function switchMode(profile: string, mode: SelectionMode): void {
  if(mode!=='core')throw new Error('Only live parsing is supported on this branch');
  initializeMode(profile);
}

export function coreProgress(profile: string, inventory = inventoryId()) {
  if (!inventory) return { core: 1, inventoryId: null, streaks: {} as Record<string, number> };
  const saved = db.prepare('SELECT inventory_id,core FROM core_progress WHERE profile_code=?').get(profile) as { inventory_id: string; core: number } | undefined;
  if (saved && saved.inventory_id !== inventory) throw new Error('Core catalogue changed; explicit progress migration is required');
  db.prepare('INSERT OR IGNORE INTO core_progress(profile_code,inventory_id) VALUES(?,?)').run(profile, inventory);
  const rows = db.prepare('SELECT target_id,streak FROM core_streaks WHERE profile_code=? AND inventory_id=?').all(profile, inventory) as Array<{ target_id: string; streak: number }>;
  return { core: saved?.core ?? 1, inventoryId: inventory, streaks: Object.fromEntries(rows.map(r => [r.target_id, r.streak])) };
}

export function questionChoice(profile: string, random = Math.random) {
  const row=db.prepare('SELECT audio_given_question_probability AS p FROM profile_selection_settings WHERE profile_code=?').get(profile) as {p:number}|undefined;
  const audioGiven=row?.p??0.6,draw=random();
  const mode = draw<audioGiven ? 'audio-given' as const : 'text-given' as const;
  return {policy:'user-question-type-v1',mode,draw,audioGiven,textGiven:1-audioGiven,
    selectedProbability:mode==='audio-given'?audioGiven:1-audioGiven};
}

export interface SelectionAttempt { observation_id: string; profile_code: string; mode: SelectionMode; batch_id: string | null; slot: number | null; target_id: string | null; core: number | null; text_hash: string | null; result: number | null; displayed_at: number | null; }
export const attempt = (id: string, profile: string) => db.prepare('SELECT * FROM selection_attempts WHERE observation_id=? AND profile_code=?').get(id, profile) as SelectionAttempt | undefined;
export function recordAttempt(id: string, profile: string, mode: SelectionMode, core?: { batch: string; slot: number; target: string; core: number; textHash: string }) {
  db.prepare('INSERT INTO selection_attempts(observation_id,profile_code,mode,batch_id,slot,target_id,core,text_hash) VALUES(?,?,?,?,?,?,?,?)')
    .run(id, profile, mode, core?.batch ?? null, core?.slot ?? null, core?.target ?? null, core?.core ?? null, core?.textHash ?? null);
}
export function markDisplayed(profile: string, id: string): void {
  const a = attempt(id, profile);
  if (!a || a.displayed_at !== null) return;
  const now = Date.now();
  // Repeated observations are allowed; do not maintain a used-observation set.
  db.prepare('UPDATE selection_attempts SET displayed_at=? WHERE observation_id=?').run(now, id);
  if (a.mode === 'core') coreEvent(profile, 'observation-displayed', { core:a.core,batchId:a.batch_id,observationId:id,targetId:a.target_id,slot:a.slot }, { displayedAt:now }, `displayed:${id}`);
}

export function applyFinishedBatch(batchId: string): void {
  const batch = db.prepare('SELECT * FROM core_batches WHERE id=?').get(batchId) as { profile_code: string; inventory_id: string; core: number; size: number; applied: number };
  if (batch.applied) return;
  const rows = db.prepare('SELECT target_id,result,observation_id,slot FROM selection_attempts WHERE batch_id=? ORDER BY slot').all(batchId) as Array<{ target_id: string; result: number | null; observation_id:string; slot:number }>;
  if (rows.length !== batch.size || rows.some(r => r.result === null)) return;
  const p = coreProgress(batch.profile_code, batch.inventory_id);
  if (p.core !== batch.core) throw new Error('Core batch is out of sequence');
  for (const r of rows) {
    const before = p.streaks[r.target_id] ?? 0;
    const streak = before === 3 ? 3 : r.result === 1 ? Math.min(3, (p.streaks[r.target_id] ?? 0) + 1) : 0;
    p.streaks[r.target_id] = streak;
    coreEvent(batch.profile_code, 'progress-applied', { inventoryId:batch.inventory_id,core:batch.core,batchId,observationId:r.observation_id,targetId:r.target_id,slot:r.slot }, { result:r.result===1,before,after:streak,masteredBefore:before===3,masteredAfter:streak===3 }, `progress:${r.observation_id}`);
    db.prepare('INSERT INTO core_streaks VALUES(?,?,?,?,?) ON CONFLICT(profile_code,inventory_id,target_id) DO UPDATE SET streak=excluded.streak')
      .run(batch.profile_code, batch.inventory_id, batch.core, r.target_id, streak);
  }
  const targets = Object.values(graph().nodes).filter(n => n.core === p.core);
  if (targets.length && targets.every(t => (p.streaks[t.id] ?? 0) >= 3)) {
    db.prepare('UPDATE core_progress SET core=core+1 WHERE profile_code=?').run(batch.profile_code);
    coreEvent(batch.profile_code, 'core-advanced', { inventoryId:batch.inventory_id,core:batch.core,batchId }, { from:batch.core,to:batch.core+1 }, `advance:${batchId}`);
  }
  db.prepare('UPDATE core_batches SET applied=1 WHERE id=?').run(batchId);
  coreEvent(batch.profile_code, 'batch-applied', { inventoryId:batch.inventory_id,core:batch.core,batchId }, { answers:rows.length,streaks:p.streaks }, `applied:${batchId}`);
}

export function evaluate(profile: string, id: string, result: boolean): void {
  db.transaction(() => {
    const a = attempt(id, profile);
    if (!a) throw new Error('Question missing');
    if (a.result !== null) {
      if (a.result !== Number(result)) throw new Error('Evaluation is final');
      return;
    }
    const visible = db.prepare(`SELECT h.presentation_state_json FROM profiles p JOIN history_entries h ON h.profile_code=p.code AND h.history_position=p.current_position WHERE p.code=? AND h.observation_id=?`).get(profile, id) as { presentation_state_json: string } | undefined;
    if (!visible || !['comparison','observation'].includes(JSON.parse(visible.presentation_state_json).questionPhase)) throw new Error('Open the comparison page first');
    markDisplayed(profile, id);
    db.prepare('UPDATE selection_attempts SET result=?,answered_at=? WHERE observation_id=?').run(Number(result), Date.now(), id);
    if (a.mode === 'core') coreEvent(profile, 'answer-recorded', { core:a.core,batchId:a.batch_id,observationId:id,targetId:a.target_id,slot:a.slot }, { result,applied:false }, `answer:${id}`);
    if (a.batch_id) applyFinishedBatch(a.batch_id);
  }).immediate();
}
