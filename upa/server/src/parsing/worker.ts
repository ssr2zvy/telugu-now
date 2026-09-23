import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { db } from '../db/database';
import { config } from '../config/config';
import { logger } from '../services/logger';
import { corpusStamp, ParsingCatalog } from './catalog';
import { parsingDirectory, parsingAssets, system } from './state';

export interface ParseJob { phase?: string; id?: string; file?: string; error?: string; processed?: number; total?: number; tokens?: number; uniqueWords?: number; [key: string]: unknown }
const lockFile = path.join(parsingDirectory, 'worker.lock');
let running = false;
function processIdentity(pid: number): string | null {
  try { return fs.readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1]?.split(' ')[19] ?? null; } catch { return null; }
}
export function job(): ParseJob { return JSON.parse(system().job_json) as ParseJob; }
function save(next: ParseJob): void {
  const previous = job();
  const saved = { ...previous, ...next, updatedAt: Date.now() };
  db.prepare('UPDATE parsing_system SET job_json=? WHERE id=1').run(JSON.stringify(saved));
  // A successful status GET does not report failures in the background worker.
  if (saved.phase === 'failed' && (previous.phase !== 'failed' || previous.error !== saved.error)) {
    logger.error('parsing_job_failed', {
      jobId: saved.id,
      previousPhase: previous.phase,
      error: saved.error,
      processed: saved.processed,
      total: saved.total,
    });
  }
}
export function recoverWorker(): boolean {
  if (running) return true;
  if (!fs.existsSync(lockFile)) {
    if (job().phase && !['ready', 'failed', 'interrupted'].includes(job().phase!)) save({ phase: 'interrupted', error: 'Parsing was interrupted. Resume the committed checkpoint.' });
    return false;
  }
  try {
    const owner = JSON.parse(fs.readFileSync(lockFile, 'utf8')) as { pid: number; started: string };
    if (owner.started && processIdentity(owner.pid) === owner.started) return true;
  } catch { /* Interrupted lock creation. */ }
  fs.rmSync(lockFile, { force: true });
  save({ phase: 'interrupted', error: 'Parsing was interrupted. Resume the committed checkpoint.' });
  return false;
}
export function startParsing(): void {
  fs.mkdirSync(parsingDirectory, { recursive: true });
  if (recoverWorker()) throw new Error('Corpus parsing is already running');
  const fd = fs.openSync(lockFile, 'wx');
  running = true;
  fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, started: processIdentity(process.pid) })); fs.closeSync(fd);
  const prior = job();
  const resume = ['failed', 'interrupted'].includes(prior.phase ?? '') && prior.file && fs.existsSync(prior.file) && !prior.error?.includes('STALE_INPUT');
  const id = resume ? prior.id! : randomUUID();
  const file = resume ? prior.file! : path.join(parsingDirectory, `${id}.building.sqlite`);
  const stamp = corpusStamp();
  save({ phase: 'starting', id, file, error: '', ...(!resume ? { processed: 0, total: 0, tokens: 0, uniqueWords: 0 } : {}) });
  const child = spawn(process.env.GRAMMAR_PYTHON ?? 'python3', [path.join(parsingAssets, 'build.py'), '--corpus', config.corpusDatabasePath, '--output', file], { stdio: ['ignore', 'pipe', 'pipe'] });
  if (child.pid) fs.writeFileSync(lockFile, JSON.stringify({ pid: child.pid, started: processIdentity(child.pid) }));
  let stderr = '';
  child.stderr.on('data', (b: Buffer) => { stderr = (stderr + b.toString()).slice(-2000); });
  const lines = createInterface({ input: child.stdout });
  lines.on('line', line => { try { const data = JSON.parse(line) as ParseJob; save({ ...data, phase: data.phase === 'complete' ? 'validating' : (data.phase ?? 'parsing') }); } catch { /* Keep worker diagnostics out of state. */ } });
  let failed = false;
  child.on('error', error => { failed = true; save({ phase: 'failed', error: error.message }); });
  child.on('close', code => {
    try {
      if (failed || code !== 0) throw new Error(job().error || `Corpus parsing failed (${code}): ${stderr}`);
      if (corpusStamp() !== stamp) throw new Error('STALE_INPUT: corpus changed during build');
      const checked = new ParsingCatalog(file);
      const identity = checked.identity;
      checked.close();
      const final = path.join(parsingDirectory, `parsing-${id}.sqlite`);
      fs.renameSync(file, final);
      db.transaction(() => {
        db.prepare('UPDATE parsing_system SET catalog_path=?,inventory_id=?,corpus_stamp=? WHERE id=1').run(final, identity.inventoryId, stamp);
        save({ phase: 'ready', file: final, error: '' });
      }).immediate();
    } catch (error) { save({ phase: 'failed', error: error instanceof Error ? error.message : 'Parsing failed' }); }
    finally { running = false; fs.rmSync(lockFile, { force: true }); }
  });
}
