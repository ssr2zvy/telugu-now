import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { REPOSITORY_CONTENT_LIMIT, REPOSITORY_NAME_LIMIT, type RepositoryEntry, type RepositoryFile, type RepositoryKind } from '../../../shared/repository';

export class RepositoryError extends Error {
  constructor(public status: 400 | 404 | 409, message: string) { super(message); }
}
const columns = 'id, parent_id AS parentId, kind, name, revision, updated_at AS updatedAt';
export function repositoryStore(db: Database.Database) {
  db.exec(`CREATE TABLE IF NOT EXISTS repository_entries (
    profile_code TEXT NOT NULL REFERENCES profiles(code) ON DELETE CASCADE,
    id TEXT NOT NULL, parent_id TEXT, kind TEXT NOT NULL CHECK(kind IN ('file','folder')),
    name TEXT NOT NULL, content TEXT NOT NULL DEFAULT '', revision INTEGER NOT NULL DEFAULT 1,
    updated_at INTEGER NOT NULL, PRIMARY KEY(profile_code,id),
    FOREIGN KEY(profile_code,parent_id) REFERENCES repository_entries(profile_code,id) ON DELETE CASCADE
  );
  CREATE UNIQUE INDEX IF NOT EXISTS repository_sibling_names ON repository_entries(profile_code,COALESCE(parent_id,''),name);
  CREATE INDEX IF NOT EXISTS repository_children ON repository_entries(profile_code,parent_id);`);
  const nameOf = (input: unknown) => {
    if (typeof input !== 'string') throw new RepositoryError(400, 'invalid-name');
    const name = input.trim().normalize('NFC');
    if (!name || name.length > REPOSITORY_NAME_LIMIT || /[\u0000-\u001f\u007f/\\]/u.test(name)) throw new RepositoryError(400, 'invalid-name');
    return name;
  };
  const get = (profile: string, id: string): RepositoryFile => {
    const row = db.prepare(`SELECT ${columns}, content FROM repository_entries WHERE profile_code=? AND id=?`).get(profile, id) as RepositoryFile | undefined;
    if (!row) throw new RepositoryError(404, 'not-found');
    return row;
  };
  const directory = (profile: string, parentId: string | null) => {
    if (parentId !== null && get(profile, parentId).kind !== 'folder') throw new RepositoryError(400, 'not-folder');
  };
  const unique = <T>(run: () => T): T => {
    try { return run(); } catch (error) {
      if ((error as {code?: string}).code === 'SQLITE_CONSTRAINT_UNIQUE') throw new RepositoryError(409, 'duplicate-name');
      throw error;
    }
  };
  const revisionOf = (input: unknown) => {
    if (!Number.isSafeInteger(input) || (input as number) < 1) throw new RepositoryError(400, 'invalid-revision');
    return input as number;
  };
  return {
    get,
    list(profile: string, parentId: string | null): RepositoryEntry[] {
      directory(profile, parentId);
      return db.prepare(`SELECT ${columns} FROM repository_entries WHERE profile_code=? AND parent_id IS ? ORDER BY kind DESC,name,id`).all(profile, parentId) as RepositoryEntry[];
    },
    create: db.transaction((profile: string, input: {name: unknown; kind: unknown; parentId: unknown}) => {
      const name = nameOf(input.name);
      if (input.kind !== 'file' && input.kind !== 'folder') throw new RepositoryError(400, 'invalid-kind');
      if (input.parentId !== null && typeof input.parentId !== 'string') throw new RepositoryError(400, 'invalid-parent');
      const parentId = input.parentId as string | null; directory(profile, parentId);
      let ancestor = parentId; let depth = 0;
      while (ancestor !== null) { if (++depth > 64) throw new RepositoryError(400, 'depth-limit'); ancestor = get(profile, ancestor).parentId; }
      const id = randomUUID();
      unique(() => db.prepare('INSERT INTO repository_entries(profile_code,id,parent_id,kind,name,updated_at) VALUES(?,?,?,?,?,?)').run(profile,id,parentId,input.kind as RepositoryKind,name,Date.now()));
      return get(profile,id);
    }),
    update: db.transaction((profile: string, id: string, input: {revision: unknown; name?: unknown; content?: unknown; parentId?: unknown}) => {
      const row = get(profile,id); const revision = revisionOf(input.revision);
      if (row.revision !== revision) throw new RepositoryError(409,'stale-revision');
      if (input.name === undefined && input.content === undefined && input.parentId === undefined) throw new RepositoryError(400,'empty-update');
      const name = input.name === undefined ? row.name : nameOf(input.name);
      if (input.content !== undefined && (row.kind !== 'file' || typeof input.content !== 'string' || Buffer.byteLength(input.content,'utf8') > REPOSITORY_CONTENT_LIMIT)) throw new RepositoryError(400,'invalid-content');
      let parentId = row.parentId;
      if (input.parentId !== undefined) {
        if (input.parentId !== null && typeof input.parentId !== 'string') throw new RepositoryError(400,'invalid-parent');
        parentId = input.parentId as string | null;
        directory(profile,parentId);
        let ancestor = parentId; let depth = 0;
        while (ancestor !== null) {
          if (ancestor === id) throw new RepositoryError(400,'invalid-move');
          if (++depth > 64) throw new RepositoryError(400,'depth-limit');
          ancestor = get(profile,ancestor).parentId;
        }
        // Include the entire moved subtree when checking the existing depth limit.
        const subtree = db.prepare(`WITH RECURSIVE tree(id,depth) AS (
          SELECT id,0 FROM repository_entries WHERE profile_code=? AND id=?
          UNION ALL SELECT child.id,tree.depth+1 FROM repository_entries child
          JOIN tree ON child.parent_id=tree.id WHERE child.profile_code=?
        ) SELECT MAX(depth) AS height FROM tree`).get(profile,id,profile) as {height:number};
        if (depth + subtree.height > 64) throw new RepositoryError(400,'depth-limit');
      }
      unique(() => db.prepare('UPDATE repository_entries SET name=?,content=?,parent_id=?,revision=revision+1,updated_at=? WHERE profile_code=? AND id=?').run(name,input.content ?? row.content,parentId,Date.now(),profile,id));
      return get(profile,id);
    }),
    remove: db.transaction((profile: string, id: string, revision: unknown) => {
      const row = get(profile,id);
      if (row.revision !== revisionOf(revision)) throw new RepositoryError(409,'stale-revision');
      db.prepare('DELETE FROM repository_entries WHERE profile_code=? AND id=?').run(profile,id);
    }),
  };
}
