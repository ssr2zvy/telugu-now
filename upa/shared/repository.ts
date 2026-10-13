export type RepositoryKind = 'file' | 'folder';
export interface RepositoryEntry {
  id: string; parentId: string | null; kind: RepositoryKind; name: string;
  revision: number; updatedAt: number;
}
export interface RepositoryFile extends RepositoryEntry { content: string }
export const REPOSITORY_CONTENT_LIMIT = 1_000_000;
export const REPOSITORY_NAME_LIMIT = 200;
