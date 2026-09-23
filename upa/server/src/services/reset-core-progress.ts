import type Database from 'better-sqlite3';

/** Reset mastery, retaining immutable answer and diagnostic history. Retire
 * pending batches so historical answers cannot reapply pre-reset progress. */
export function resetCoreProgress(db: Database.Database, profile: string, scope: 'core' | 'all'): number {
  const row = db.prepare('SELECT core FROM core_progress WHERE profile_code=?').get(profile) as { core: number } | undefined;
  const core = scope === 'all' ? 1 : Math.min(3, row?.core ?? 1);
  if (scope === 'all') {
    db.prepare('DELETE FROM core_streaks WHERE profile_code=?').run(profile);
    db.prepare('DELETE FROM core_used WHERE profile_code=?').run(profile);
  } else {
    db.prepare('DELETE FROM core_streaks WHERE profile_code=? AND core=?').run(profile, core);
    db.prepare('DELETE FROM core_used WHERE profile_code=? AND core=?').run(profile, core);
  }
  db.prepare('UPDATE core_progress SET core=? WHERE profile_code=?').run(core, profile);
  db.prepare('UPDATE core_batches SET applied=1 WHERE profile_code=? AND applied=0').run(profile);
  return core;
}
