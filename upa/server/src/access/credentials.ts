import type Database from 'better-sqlite3';

export interface AccessCredentials { hash: string; secret: string }
export type CredentialState = {status: 'missing'} | {status: 'invalid'} | {status: 'ready'; credentials: AccessCredentials};
export function validCredentials(value: AccessCredentials): boolean {
  return /^scrypt-v1\$[a-f0-9]{32}\$[a-f0-9]{128}$/.test(value.hash)
    && /^[a-f0-9]{64,}$/.test(value.secret);
}

// The application's existing user database is on the persistent volume.
// A singleton row is the ownership claim. Never replace, reset or delete it.
export function accessCredentials(database: Database.Database) {
  database.exec(`CREATE TABLE IF NOT EXISTS access_credentials (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    hash TEXT NOT NULL,
    secret TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`);
  const read = (): CredentialState => {
    const row = database.prepare('SELECT hash, secret FROM access_credentials WHERE id=1').get() as AccessCredentials | undefined;
    if (!row) return {status: 'missing'};
    return validCredentials(row) ? {status: 'ready', credentials: row} : {status: 'invalid'};
  };
  const initialize = (credentials: AccessCredentials): boolean => {
    if (!validCredentials(credentials)) throw new Error('Invalid access credentials');
    return database.prepare('INSERT OR IGNORE INTO access_credentials (id,hash,secret,created_at) VALUES (1,?,?,?)')
      .run(credentials.hash, credentials.secret, Date.now()).changes === 1;
  };
  const resolve = (): CredentialState => {
    const stored = read();
    if (stored.status !== 'missing') return stored;
    // Preserve an already-configured deployment and its sessions without asking
    // the owner to disclose or reset the old passphrase. Volume takes precedence.
    const legacy = {hash: process.env.ACCESS_PASSPHRASE_HASH ?? '', secret: process.env.ACCESS_SESSION_SECRET ?? ''};
    if (!legacy.hash && !legacy.secret) return stored;
    if (!validCredentials(legacy)) return {status: 'invalid'};
    initialize(legacy);
    return read();
  };
  return {read, initialize, resolve};
}
