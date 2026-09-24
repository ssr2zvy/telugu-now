import type Database from 'better-sqlite3';
import {validCredentials, type AccessCredentials} from './credentials';

// Stable across restarts/redeployments: this patch authorizes ONE replacement.
const RECOVERY_ID = 'owner-requested-recovery-20260924-v1';
export function oneTimeRecovery(database: Database.Database) {
  database.exec('CREATE TABLE IF NOT EXISTS access_recovery (id TEXT PRIMARY KEY, completed_at INTEGER NOT NULL)');
  const pending = () => !database.prepare('SELECT 1 FROM access_recovery WHERE id=?').get(RECOVERY_ID);
  const replace = database.transaction((credentials: AccessCredentials): boolean => {
    if (!validCredentials(credentials)) throw new Error('Invalid access credentials');
    const claimed = database.prepare('INSERT OR IGNORE INTO access_recovery VALUES (?,?)').run(RECOVERY_ID,Date.now());
    if (!claimed.changes) return false;
    database.prepare(`INSERT INTO access_credentials (id,hash,secret,created_at) VALUES (1,?,?,?)
      ON CONFLICT(id) DO UPDATE SET hash=excluded.hash, secret=excluded.secret, created_at=excluded.created_at`)
      .run(credentials.hash,credentials.secret,Date.now());
    return true;
  });
  return {pending, replace};
}
