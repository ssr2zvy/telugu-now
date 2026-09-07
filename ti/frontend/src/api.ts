import type {
  DataSourcesResponse,
  ExportRequest,
  ExportResponse,
  LoadProfileRequest,
  NavigationRequest,
  ProfileSelectionSettings,
  ProfileStateResponse,
  UpdateSelectionSettingsRequest,
  VisibilityRequest,
} from '../../shared/contracts';

async function parseJson<T>(response: Response): Promise<T> {
  if (!response.ok) throw new Error(String(response.status));
  return response.json() as Promise<T>;
}

export async function loadProfile(request: LoadProfileRequest): Promise<ProfileStateResponse> {
  return parseJson<ProfileStateResponse>(await fetch('/api/profiles/load', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request),
  }));
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

export async function getDataSources(): Promise<DataSourcesResponse> {
  return parseJson<DataSourcesResponse>(await fetch('/api/data-sources'));
}
