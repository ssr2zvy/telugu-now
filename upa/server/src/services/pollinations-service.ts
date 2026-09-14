import { IMAGE_MODEL } from '../../../shared/image-settings';
import { randomInt } from 'node:crypto';

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MISSING_POLLINATIONS_KEY_MESSAGE = 'Set pollinations_api_key in the server environment (Fly secret). For local dev, export it in local-machine/dev-secrets.env and restart dev.';

export function readPollinationsKey(): string {
  return process.env.pollinations_api_key?.trim() ?? '';
}

export async function generatePollinationsImage(
  prompt: string,
  apiKey: string,
  request: typeof fetch = fetch,
): Promise<Buffer> {
  if (!apiKey) throw new Error(MISSING_POLLINATIONS_KEY_MESSAGE);
  const url = new URL(`https://gen.pollinations.ai/image/${encodeURIComponent(prompt)}`);
  url.searchParams.set('model', IMAGE_MODEL);
  url.searchParams.set('seed', String(randomInt(0, 2147483647)));
  let response: Response;
  try {
    response = await request(url, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'image/*' },
      signal: AbortSignal.timeout(120000),
      redirect: 'error',
    });
  } catch {
    throw new Error('Pollinations could not be reached or the image request timed out.');
  }
  if (!response.ok) {
    await response.body?.cancel();
    if (response.status === 401 || response.status === 403) throw new Error('Pollinations rejected the API key or access to MAI Image 2.5 Flash.');
    if (response.status === 402) throw new Error('Pollinations account credits are insufficient.');
    if (response.status === 429) throw new Error('Pollinations rate limit reached. Please try again later.');
    throw new Error(`Pollinations image generation failed (HTTP ${response.status}).`);
  }
  if (!response.body || Number(response.headers.get('content-length')) > MAX_IMAGE_BYTES) {
    await response.body?.cancel();
    throw new Error('Pollinations returned an empty or oversized image.');
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_IMAGE_BYTES) {
        await reader.cancel();
        throw new Error('Image exceeds the 10 MiB limit.');
      }
      chunks.push(value);
    }
  } catch {
    throw new Error('Could not download the image from Pollinations within the size or time limit.');
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}