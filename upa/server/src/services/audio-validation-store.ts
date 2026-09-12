import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { config } from '../config/config';

interface StorageOptions {
  corpusBackend: string;
  corpusObjectsPath: string;
  corpusObjectsPrefix: string;
  bucketName?: string | undefined;
  awsEndpointUrlS3?: string | undefined;
}

export function audioStorageIdentity(options: StorageOptions): string {
  return JSON.stringify(options.corpusBackend === 'local'
    ? ['local', path.resolve(options.corpusObjectsPath)]
    : ['tigris', options.awsEndpointUrlS3 ?? '', options.bucketName, options.corpusObjectsPrefix]);
}

// A separate, volume-backed report: never modify the read-only canonical corpus.
export class AudioValidationStore {
  private connection: Database.Database | undefined;

  constructor(private readonly filename: string, private readonly scope: string) {}

  private get db(): Database.Database {
    if (!this.connection) {
      fs.mkdirSync(path.dirname(this.filename), { recursive: true });
      this.connection = new Database(this.filename);
      this.connection.pragma('journal_mode = WAL');
      this.connection.pragma('busy_timeout = 5000');
      this.connection.exec(`
        CREATE TABLE IF NOT EXISTS audio_validation (
          storage_identity TEXT NOT NULL, object_key TEXT NOT NULL,
          object_identity TEXT, status TEXT NOT NULL CHECK (status IN ('valid', 'invalid')),
          reason TEXT NOT NULL, checked_at INTEGER NOT NULL,
          PRIMARY KEY (storage_identity, object_key)
        ) WITHOUT ROWID;
        CREATE INDEX IF NOT EXISTS idx_audio_validation_status
          ON audio_validation(storage_identity, status);
        CREATE TABLE IF NOT EXISTS validation_revision (
          storage_identity TEXT PRIMARY KEY, revision INTEGER NOT NULL
        ) WITHOUT ROWID;
      `);
    }
    return this.connection;
  }

  get revision(): number {
    return (this.db.prepare('SELECT revision FROM validation_revision WHERE storage_identity = ?')
      .get(this.scope) as { revision: number } | undefined)?.revision ?? 0;
  }

  invalidKeys(): string[] {
    return (this.db.prepare("SELECT object_key FROM audio_validation WHERE storage_identity = ? AND status = 'invalid'")
      .all(this.scope) as Array<{ object_key: string }>).map(row => row.object_key);
  }

  invalidReason(key: string): string | null {
    return (this.db.prepare("SELECT reason FROM audio_validation WHERE storage_identity = ? AND object_key = ? AND status = 'invalid'")
      .get(this.scope, key) as { reason: string } | undefined)?.reason ?? null;
  }

  isValid(key: string, identity: string): boolean {
    return !!this.db.prepare("SELECT 1 FROM audio_validation WHERE storage_identity = ? AND object_key = ? AND object_identity = ? AND status = 'valid'")
      .get(this.scope, key, identity);
  }

  recordValid(key: string, identity: string): void {
    this.db.prepare(`
      INSERT INTO audio_validation VALUES (?, ?, ?, 'valid', 'decoded', ?)
      ON CONFLICT(storage_identity, object_key) DO UPDATE SET
        object_identity = excluded.object_identity, checked_at = excluded.checked_at
      WHERE audio_validation.status = 'valid'
    `).run(this.scope, key, identity, Date.now());
  }

  quarantine(key: string, reason: string): void {
    this.db.transaction(() => {
      const changed = this.db.prepare(`
        INSERT INTO audio_validation VALUES (?, ?, NULL, 'invalid', ?, ?)
        ON CONFLICT(storage_identity, object_key) DO UPDATE SET
          status = 'invalid', reason = excluded.reason, checked_at = excluded.checked_at
        WHERE audio_validation.status != 'invalid'
      `).run(this.scope, key, reason, Date.now());
      if (changed.changes) this.db.prepare(`
        INSERT INTO validation_revision VALUES (?, 1)
        ON CONFLICT(storage_identity) DO UPDATE SET revision = revision + 1
      `).run(this.scope);
    })();
  }

  close(): void {
    this.connection?.close();
    this.connection = undefined;
  }
}

export const audioValidationStore = new AudioValidationStore(config.audioValidationPath, audioStorageIdentity(config));
