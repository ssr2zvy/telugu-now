import type {
  DataSourcesResponse,
  ExportRequest,
  ExportResponse,
  LoadProfileRequest,
  NavigationRequest,
  ProfileAudioSettings,
  ProfileSelectionSettings,
  ProfileStateResponse,
  ProfileEonsResponse,
  UpdateAudioSettingsRequest,
  UpdateSelectionSettingsRequest,
  VisibilityRequest,
} from '../../shared/contracts';
import type { ProfilePreferences, UpdateProfilePreferences } from '../../shared/appearance';

export async function getProfilePreferences(code: string): Promise<ProfilePreferences> {
  return parseJson<ProfilePreferences>(await fetch(`/api/profiles/${encodeURIComponent(code)}/preferences`));
}

export async function getProfileEons(code: string, signal?: AbortSignal): Promise<ProfileEonsResponse> {
  return parseJson<ProfileEonsResponse>(await fetch(`/api/profiles/${encodeURIComponent(code)}/eons`, signal ? { signal } : {}));
}

export async function startProfileEon(code: string, name: string): Promise<ProfileEonsResponse> {
  return parseJson<ProfileEonsResponse>(await fetch(`/api/profiles/${encodeURIComponent(code)}/eons`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
  }));
}

export async function stopProfileEon(code: string, eonId: string): Promise<ProfileEonsResponse> {
  return parseJson<ProfileEonsResponse>(await fetch(`/api/profiles/${encodeURIComponent(code)}/eons/${encodeURIComponent(eonId)}/stop`, {
    method: 'POST',
  }));
}

export async function transferBrowserData(code: string, storage?: Storage): Promise<void> {
  let browserStorage: Storage;
  const entries: Array<{ key: string; value: string }> = [];
  try {
    browserStorage = storage ?? window.localStorage;
    const settings = new Set(['telugu-now-appearance-v1', 'telugu-now-settings-language', 'telugu-now-preferences-migrated']);
    for (let index = 0; index < browserStorage.length; index += 1) {
      const key = browserStorage.key(index);
      if (!key || (!settings.has(key) && !key.startsWith('telugu-now-audio-bookmarks:'))) continue;
      const value = browserStorage.getItem(key);
      if (value !== null) entries.push({ key, value });
    }
  } catch { return; }
  if (!entries.length) return;
  const result = await parseJson<{ saved: boolean }>(await fetch(`/api/profiles/${encodeURIComponent(code)}/browser-data`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entries }),
  }));
  if (result.saved !== true) throw new Error('Could not transfer saved user data.');
  for (const entry of entries) {
    try { if (browserStorage.getItem(entry.key) === entry.value) browserStorage.removeItem(entry.key); } catch {}
  }
}

export async function saveProfilePreferences(code: string, patch: UpdateProfilePreferences): Promise<ProfilePreferences> {
  return parseJson<ProfilePreferences>(await fetch(`/api/profiles/${encodeURIComponent(code)}/preferences`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
    keepalive: true,
  }));
}

async function parseJson<T>(response: Response): Promise<T> {
  if (!response.ok) throw new Error(String(response.status));
  return response.json() as Promise<T>;
}

export async function getDataSources(): Promise<DataSourcesResponse> {
  return parseJson<DataSourcesResponse>(await fetch('/api/data-sources'));
}

export class InvalidProfileCodeError extends Error {
  constructor() {
    super('Invalid profile code');
    this.name = 'InvalidProfileCodeError';
  }
}

export async function loadProfile(request: LoadProfileRequest): Promise<ProfileStateResponse> {
  const response = await fetch('/api/profiles/load', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (response.status === 404) {
    const body = await response.json().catch(() => null);
    if (body?.error === 'invalid-profile-code') throw new InvalidProfileCodeError();
  }
  return parseJson<ProfileStateResponse>(response);
}

export async function getProfileState(code: string, visible: boolean): Promise<ProfileStateResponse> {
  return parseJson<ProfileStateResponse>(
    await fetch(`/api/profiles/${code}/state?visible=${visible ? '1' : '0'}`),
  );
}

export async function navigate(
  code: string,
  direction: 'back' | 'next',
  request: NavigationRequest,
): Promise<ProfileStateResponse> {
  return parseJson<ProfileStateResponse>(await fetch(`/api/profiles/${code}/${direction}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request),
  }));
}

export async function setVisibility(code: string, request: VisibilityRequest): Promise<void> {
  const response = await fetch(`/api/profiles/${code}/visibility`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request),
    keepalive: true,
  });
  if (!response.ok) throw new Error(String(response.status));
}

export async function resetQueue(
  code: string,
  request: NavigationRequest,
): Promise<ProfileStateResponse> {
  return parseJson<ProfileStateResponse>(await fetch(`/api/profiles/${code}/queue/reset`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request),
  }));
}

export async function updateSelectionSettings(
  code: string,
  request: UpdateSelectionSettingsRequest,
): Promise<ProfileSelectionSettings> {
  return parseJson<ProfileSelectionSettings>(await fetch(`/api/profiles/${code}/settings`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request),
  }));
}

export async function updateAudioSettings(
  code: string,
  request: UpdateAudioSettingsRequest,
): Promise<ProfileAudioSettings> {
  return parseJson<ProfileAudioSettings>(await fetch(`/api/profiles/${code}/audio-settings`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request),
  }));
}

export async function generateExport(
  code: string,
  request: ExportRequest,
): Promise<ExportResponse> {
  return parseJson<ExportResponse>(await fetch(`/api/profiles/${code}/export`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request),
  }));
}
