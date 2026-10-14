import type { RepositoryEntry, RepositoryFile, RepositoryKind } from '../../../shared/repository';
import { withRequestDeadline } from '../request-deadline';
export class RepositoryRequestError extends Error { constructor(public code: string) { super(code); } }
async function request<T>(profile: string, suffix = '', method = 'GET', body?: unknown): Promise<T> {
  return withRequestDeadline(async signal => {
    const response = await fetch(`/api/profiles/${encodeURIComponent(profile)}/repository/entries${suffix}`, {
      method, signal, headers: {'content-type':'application/json'}, ...(body === undefined ? {} : {body:JSON.stringify(body)}),
    });
    if (!response.ok) throw new RepositoryRequestError((await response.json().catch(() => ({}))).error ?? 'request-failed');
    return response.status === 204 ? undefined as T : await response.json() as T;
  }, 12000, 'request-timeout');
}
export const repositoryApi = {
  list: (profile: string, parent: string | null) => request<RepositoryEntry[]>(profile,parent ? `?parent=${encodeURIComponent(parent)}` : ''),
  get: (profile: string, id: string) => request<RepositoryFile>(profile,`/${encodeURIComponent(id)}`),
  create: (profile: string, parentId: string | null, kind: RepositoryKind, name: string) => request<RepositoryFile>(profile,'','POST',{parentId,kind,name}),
  update: (profile: string, id: string, body: {revision: number; name?: string; content?: string; parentId?: string | null}) => request<RepositoryFile>(profile,`/${encodeURIComponent(id)}`,'PUT',body),
  remove: (profile: string, entry: RepositoryEntry) => request<void>(profile,`/${encodeURIComponent(entry.id)}`,'DELETE',{revision:entry.revision}),
};
