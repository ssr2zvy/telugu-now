import { randomInt } from 'node:crypto';
import type Database from 'better-sqlite3';
import { availableModifiers, modifierEntries, type ModifierEntry, type ModifierDraw, type ModifierState } from '../../../shared/modifiers';

export function modifierStore(db: Database.Database) {
  db.exec(`CREATE TABLE IF NOT EXISTS modifier_progress (
    profile_code TEXT NOT NULL REFERENCES profiles(code) ON DELETE CASCADE,
    entry_id TEXT NOT NULL, excluded INTEGER NOT NULL DEFAULT 0 CHECK(excluded IN (0,1)),
    seen_at INTEGER NOT NULL, PRIMARY KEY(profile_code, entry_id)
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS modifier_catalogs (
    profile_code TEXT PRIMARY KEY REFERENCES profiles(code) ON DELETE CASCADE, entries_json TEXT NOT NULL
  ); CREATE TABLE IF NOT EXISTS modifier_omissions (
    profile_code TEXT NOT NULL REFERENCES profiles(code) ON DELETE CASCADE,
    entry_id TEXT NOT NULL, PRIMARY KEY(profile_code, entry_id)
  )`);
  const catalog = (profile: string): ModifierEntry[] | undefined => {
    const row = db.prepare('SELECT entries_json FROM modifier_catalogs WHERE profile_code=?').get(profile) as {entries_json: string} | undefined;
    return row ? JSON.parse(row.entries_json) : undefined;
  };
  const has = (profile: string, id: string) => (catalog(profile) ?? modifierEntries).some(e => e.id === id);
  const state = (profile: string): ModifierState => {
    const entries = catalog(profile);
    const ids = new Set((entries ?? modifierEntries).map(e => e.id));
    return { progress:
    (db.prepare('SELECT entry_id AS id, excluded, seen_at AS seenAt FROM modifier_progress WHERE profile_code=? ORDER BY entry_id')
      .all(profile) as {id: string; excluded: number; seenAt: number}[])
      .filter(row => ids.has(row.id)).map(row => ({...row, excluded: Boolean(row.excluded)})),
    ...(entries ? {entries} : {}),
    omitted: (db.prepare('SELECT entry_id FROM modifier_omissions WHERE profile_code=?').all(profile) as {entry_id:string}[]).map(r => r.entry_id),
  }; };
  return {
    has,
    importCatalog: db.transaction((profile: string, entries: ModifierEntry[]): ModifierState => {
      db.prepare('INSERT INTO modifier_catalogs VALUES(?,?) ON CONFLICT(profile_code) DO UPDATE SET entries_json=excluded.entries_json').run(profile, JSON.stringify(entries));
      // Stable grammar IDs preserve omissions even across temporary removal/reimport.
      db.prepare('DELETE FROM modifier_progress WHERE profile_code=?').run(profile);
      return state(profile);
    }),
    setOmitted(profile: string, id: string, omitted: boolean): ModifierState {
      if (!has(profile,id) && omitted) throw new Error('unknown-modifier');
      if (omitted) db.prepare('INSERT OR IGNORE INTO modifier_omissions VALUES(?,?)').run(profile,id);
      else {
        db.prepare('DELETE FROM modifier_omissions WHERE profile_code=? AND entry_id=?').run(profile,id);
        db.prepare('UPDATE modifier_progress SET excluded=0 WHERE profile_code=? AND entry_id=?').run(profile,id);
      }
      return state(profile);
    },
    state,
    draw: db.transaction((profile: string, current: string | null): ModifierDraw => {
      const candidates = availableModifiers(state(profile), current);
      const entry = candidates.length ? candidates[randomInt(candidates.length)]! : null;
      if (entry) db.prepare('INSERT INTO modifier_progress(profile_code,entry_id,seen_at) VALUES(?,?,?) ON CONFLICT(profile_code,entry_id) DO NOTHING')
        .run(profile, entry.id, Date.now());
      return { ...state(profile), entryId: entry?.id ?? null };
    }),
    setExcluded: db.transaction((profile: string, id: string, excluded: boolean): ModifierState => {
      if (!has(profile,id)) throw new Error('unknown-modifier');
      db.prepare(`INSERT INTO modifier_progress(profile_code,entry_id,excluded,seen_at) VALUES(?,?,?,?)
        ON CONFLICT(profile_code,entry_id) DO UPDATE SET excluded=excluded.excluded`).run(profile,id,Number(excluded),Date.now());
      return state(profile);
    }),
    reset(profile: string): ModifierState {
      db.prepare('DELETE FROM modifier_progress WHERE profile_code=?').run(profile);
      return state(profile);
    },
  };
}
