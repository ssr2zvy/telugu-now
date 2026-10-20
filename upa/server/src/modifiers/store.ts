import { randomInt } from 'node:crypto';
import type Database from 'better-sqlite3';
import { availableModifiers, modifierById, type ModifierDraw, type ModifierState } from '../../../shared/modifiers';

export function modifierStore(db: Database.Database) {
  db.exec(`CREATE TABLE IF NOT EXISTS modifier_progress (
    profile_code TEXT NOT NULL REFERENCES profiles(code) ON DELETE CASCADE,
    entry_id TEXT NOT NULL, excluded INTEGER NOT NULL DEFAULT 0 CHECK(excluded IN (0,1)),
    seen_at INTEGER NOT NULL, PRIMARY KEY(profile_code, entry_id)
  )`);
  const state = (profile: string): ModifierState => ({ progress:
    (db.prepare('SELECT entry_id AS id, excluded, seen_at AS seenAt FROM modifier_progress WHERE profile_code=? ORDER BY entry_id')
      .all(profile) as {id: string; excluded: number; seenAt: number}[])
      .filter(row => modifierById.has(row.id)).map(row => ({...row, excluded: Boolean(row.excluded)})),
  });
  return {
    state,
    draw: db.transaction((profile: string, current: string | null): ModifierDraw => {
      const candidates = availableModifiers(state(profile), current);
      const entry = candidates.length ? candidates[randomInt(candidates.length)]! : null;
      if (entry) db.prepare('INSERT INTO modifier_progress(profile_code,entry_id,seen_at) VALUES(?,?,?) ON CONFLICT(profile_code,entry_id) DO NOTHING')
        .run(profile, entry.id, Date.now());
      return { ...state(profile), entryId: entry?.id ?? null };
    }),
    setExcluded: db.transaction((profile: string, id: string, excluded: boolean): ModifierState => {
      if (!modifierById.has(id)) throw new Error('unknown-modifier');
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
