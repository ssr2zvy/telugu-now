import type { ModifierDraw, ModifierState } from '../../../shared/modifiers';
import { withRequestDeadline } from '../request-deadline';

async function request<T>(profile: string, path: string, method = 'GET', body?: unknown): Promise<T> {
  return withRequestDeadline(async signal => {
    const response = await fetch(`/api/profiles/${encodeURIComponent(profile)}/modifiers/${path}`, {
      method, signal, headers: { 'content-type': 'application/json' },
      ...(body === undefined ? {} : {body: JSON.stringify(body)}),
    });
    if (!response.ok) throw new Error('modifier-request-failed');
    const result = await response.json();
    if (!result || !Array.isArray(result.progress) || result.progress.some((item: Partial<ModifierState['progress'][number]> | null) =>
      !item || typeof item.id !== 'string' || typeof item.excluded !== 'boolean' || typeof item.seenAt !== 'number')) {
      throw new Error('invalid-modifier-response');
    }
    return result as T;
  }, 12000, 'modifier-request-timeout');
}
export const modifierApi = {
  state: (profile: string) => request<ModifierState>(profile, 'state'),
  draw: (profile: string, current: string | null) => request<ModifierDraw>(profile, 'draw', 'POST', {current}),
  setExcluded: (profile: string, id: string, excluded: boolean) => request<ModifierState>(profile, `entries/${encodeURIComponent(id)}`, 'PUT', {excluded}),
  reset: (profile: string) => request<ModifierState>(profile, 'reset', 'POST'),
};
