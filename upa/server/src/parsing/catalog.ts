import fs from 'node:fs';
import Database from 'better-sqlite3';
import { db } from '../db/database';
import { config } from '../config/config';
import { audioStorageIdentity, audioValidationStore } from '../services/audio-validation-store';
import { coreProgress, graph, system, parserFingerprint, type CoreTarget } from './state';

export const corpusStamp = () => JSON.stringify([config.corpusDatabasePath, ...['', '-wal'].map(suffix => {
  try { const s = fs.statSync(config.corpusDatabasePath + suffix); return [s.size, s.mtimeMs]; } catch { return null; }
})]);
export interface CoreRow { id: number; source_id: string; source_key: string; text_hash: string; length: number; audio_key: string; text: string; }
export class ParsingCatalog {
  readonly db: Database.Database;
  readonly identity: { schema: number; inventoryId: string; parserVersion: string; parserHash: string; corpusHash: string };
  constructor(readonly filename: string) {
    this.db = new Database(filename, { readonly: true, fileMustExist: true });
    try {
      if (this.meta('complete') !== true) throw new Error('Corpus parsing is not complete');
      this.identity = this.meta('identity');
      if (this.identity.schema !== 1) throw new Error('Unsupported parsing database schema');
      if (this.identity.parserHash !== parserFingerprint()) throw new Error('Parser changed; parse the corpus again');
      this.db.prepare('ATTACH DATABASE ? AS corpus').run(config.corpusDatabasePath);
      this.db.prepare('ATTACH DATABASE ? AS availability').run(config.corpusAvailabilityPath);
      void audioValidationStore.revision;
      this.db.prepare('ATTACH DATABASE ? AS validation').run(config.audioValidationPath);
    } catch (error) { this.db.close(); throw error; }
  }
  meta<T = any>(key: string): T {
    const row = this.db.prepare('SELECT value FROM metadata WHERE key=?').get(key) as { value: string } | undefined;
    return row ? JSON.parse(row.value) as T : null as T;
  }
  close() { this.db.close(); }
  shortest(target: string, excludedHashes: string[], blocked: string[], excludedRow?: number): CoreRow | undefined {
    return this.db.prepare(`SELECT r.*,c.text FROM members m JOIN rows r ON r.id=m.row_id
      JOIN corpus.source_rows c ON c.source_id=r.source_id AND c.source_key=r.source_key
      WHERE m.target_id=? AND r.audio_key<>'' AND r.id<>?
      AND r.text_hash NOT IN(SELECT value FROM json_each(?))
      AND c.text NOT IN(SELECT value FROM json_each(?))
      AND EXISTS(SELECT 1 FROM availability.source_complexity_members e WHERE e.source_id=r.source_id AND e.source_key=r.source_key)
      AND NOT EXISTS(SELECT 1 FROM validation.audio_validation v WHERE v.storage_identity=? AND v.object_key=r.audio_key AND v.status='invalid')
      ORDER BY m.length,r.id LIMIT 1`).get(target, excludedRow ?? -1, JSON.stringify(excludedHashes), JSON.stringify(blocked), audioStorageIdentity(config)) as CoreRow | undefined;
  }
  evidence(row: CoreRow, target: string) {
    const m = this.db.prepare('SELECT * FROM matches WHERE row_id=? AND target_id=? ORDER BY token_index,start_cp LIMIT 1').get(row.id, target) as { surface: string; start_cp: number; end_cp: number; token_index: number; reason: string };
    const result = this.db.prepare('SELECT analysis_json FROM words WHERE surface=?').get(m.surface) as { analysis_json: string } | undefined;
    return { occurrence: { ...m, word: m.surface, token_surface: Array.from(row.text).slice(m.start_cp, m.end_cp).join('') }, parser: result ? JSON.parse(result.analysis_json) : null };
  }
}
let cached: ParsingCatalog | undefined;
export function getParsingCatalog(): ParsingCatalog {
  const s = system();
  if (!s.catalog_path || s.corpus_stamp !== corpusStamp()) throw new Error('Parse the current corpus before turning on Core mode');
  if (!cached || cached.filename !== s.catalog_path) { cached?.close(); cached = new ParsingCatalog(s.catalog_path); }
  return cached;
}
export function selectionContext(profile: string, core: number) {
  const used = db.prepare('SELECT text_hash FROM core_used WHERE profile_code=? AND core=?').all(profile, core) as Array<{ text_hash: string }>;
  const reserved = db.prepare(`SELECT a.text_hash FROM selection_attempts a JOIN core_batches b ON b.id=a.batch_id WHERE a.profile_code=? AND a.core=? AND a.displayed_at IS NULL AND b.applied=0`).all(profile, core) as Array<{ text_hash: string }>;
  const blocked = db.prepare('SELECT text FROM profile_blacklisted_sentences WHERE profile_code=?').all(profile) as Array<{ text: string }>;
  return { excluded: [...new Set([...used, ...reserved].map(r => r.text_hash))], blocked: blocked.map(r => r.text) };
}
export interface CoreSelection { target: CoreTarget; row: CoreRow; transition: 'seed' | 'neighbor'; }
export function draftCoreBatch(profile: string, random = Math.random): { choices: CoreSelection[]; core: number; inventoryId: string; endReason: string } {
  const catalog = getParsingCatalog(), p = coreProgress(profile, catalog.identity.inventoryId);
  if (p.core === 4) return { choices: [], core: 4, inventoryId: catalog.identity.inventoryId, endReason: 'completed' };
  const { excluded, blocked } = selectionContext(profile, p.core);
  const targets = Object.values(graph().nodes).filter(n => n.core === p.core);
  const pick = (options: CoreTarget[]) => {
    const candidates = options.flatMap(target => { const row = catalog.shortest(target.id, excluded, blocked); return row ? [{ target, row }] : []; });
    return candidates[Math.floor(random() * candidates.length)];
  };
  const choices: CoreSelection[] = [];
  let next = pick(targets.filter(t => (p.streaks[t.id] ?? 0) < 3));
  while (next && choices.length < 10) {
    choices.push({ ...next, transition: choices.length ? 'neighbor' : 'seed' });
    excluded.push(next.row.text_hash);
    const neighbors = new Set(next.target.neighbors);
    next = pick(targets.filter(t => neighbors.has(t.id)));
  }
  return { choices, core: p.core, inventoryId: catalog.identity.inventoryId,
    endReason: choices.length === 10 ? 'batch-full' : choices.length ? 'no-unused-neighbor' : 'no-unused-unmastered-target' };
}
