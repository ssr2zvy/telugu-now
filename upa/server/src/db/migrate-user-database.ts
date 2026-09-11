import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';

export function migrateUserDatabase(
  dataDirectory: string,
  databasePath: string,
  explicitDatabasePath = process.env.DATABASE_PATH !== undefined,
): boolean {
  const target = path.resolve(dataDirectory, 'user/users.sqlite');
  const legacyPath = path.resolve(dataDirectory, 'users.sqlite');
  if (explicitDatabasePath || path.resolve(databasePath) !== target || fs.existsSync(target)
    || !fs.existsSync(legacyPath)) return false;
  if (fs.existsSync(`${target}-wal`) || fs.existsSync(`${target}-shm`)) {
    throw new Error('Refusing user database migration: target SQLite sidecars already exist.');
  }

  fs.mkdirSync(path.dirname(target), { recursive: true });
  const snapshotPath = path.join(path.dirname(target), `.users-migration-${randomUUID()}.sqlite`);
  const source = new Database(legacyPath, { readonly: true, fileMustExist: true });
  try {
    source.pragma('busy_timeout = 5000');
    // SQLite reads the committed WAL too; copying/renaming the main file alone loses data.
    source.prepare('VACUUM INTO ?').run(snapshotPath);
    const snapshot = new Database(snapshotPath, { readonly: true, fileMustExist: true });
    try {
      if (snapshot.pragma('integrity_check', { simple: true }) !== 'ok') {
        throw new Error('User database migration failed SQLite integrity verification.');
      }
    } finally {
      snapshot.close();
    }
    const descriptor = fs.openSync(snapshotPath, 'r');
    try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
    try {
      // Exclusive, atomic publication: a concurrent startup must never replace the winner.
      fs.linkSync(snapshotPath, target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
      throw error;
    }
    const directoryDescriptor = fs.openSync(path.dirname(target), 'r');
    try { fs.fsyncSync(directoryDescriptor); } finally { fs.closeSync(directoryDescriptor); }
    return true;
  } finally {
    source.close();
    fs.rmSync(snapshotPath, { force: true });
  }
}
