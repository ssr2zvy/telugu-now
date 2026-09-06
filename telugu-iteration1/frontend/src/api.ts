import type {
  LoadProfileRequest,
  NavigationRequest,
  ProfileStateResponse,
  VisibilityRequest,
} from '../../shared/contracts';

async function parseState(response: Response): Promise<ProfileStateResponse> {
  if (!response.ok) throw new Error(String(response.status));
  return response.json() as Promise<ProfileStateResponse>;
}

export async function loadProfile(request: LoadProfileRequest): Promise<ProfileStateResponse> {
  return parseState(await fetch('/api/profiles/load', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request),
  }));
}

export async function getProfileState(code: string, visible: boolean): Promise<ProfileStateResponse> {
  return parseState(await fetch(`/api/profiles/${code}/state?visible=${visible ? '1' : '0'}`));
}

export async function navigate(
  code: string,
  direction: 'back' | 'next',
  request: NavigationRequest,
): Promise<ProfileStateResponse> {
  return parseState(await fetch(`/api/profiles/${code}/${direction}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request),
  }));
}

export async function setVisibility(code: string, request: VisibilityRequest): Promise<void> {
  await fetch(`/api/profiles/${code}/visibility`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request),
    keepalive: true,
  });
}
