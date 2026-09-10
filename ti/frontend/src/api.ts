import type {
  DataSourcesResponse,
  ExportRequest,
  ExportResponse,
  LoadProfileRequest,
  NavigationRequest,
  ProfileAudioSettings,
  ProfileSelectionSettings,
  ProfileStateResponse,
  UpdateAudioSettingsRequest,
  UpdateSelectionSettingsRequest,
  VisibilityRequest,
} from '../../shared/contracts';
import type { ProfilePreferences, UpdateProfilePreferences, ProfileMigrationState } from '../../shared/appearance';

export async function getProfileMigrations(code: string): Promise<ProfileMigrationState> {
  return parseJson<ProfileMigrationState>(await fetch(`/api/profiles/${encodeURIComponent(code)}/migrations`));
}

export async function saveProfilePreferences(code: string, patch: UpdateProfilePreferences, initialize = false): Promise<ProfilePreferences> {
  return parseJson<ProfilePreferences>(await fetch(`/api/profiles/${encodeURIComponent(code)}/preferences`, {
    method: initialize ? 'POST' : 'PATCH',
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
