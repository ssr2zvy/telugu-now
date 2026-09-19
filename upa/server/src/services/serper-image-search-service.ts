import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';
import { load } from 'cheerio';
import { imageType, type WordImageRecord } from './word-image-store';
import { MAX_IMAGE_BYTES } from './pollinations-service';

const SERPER_IMAGES_URL = 'https://google.serper.dev/images';
const TARGET_RESULTS = 8;
const MAX_SEARCH_PAGES = 10;
const MAX_SEARCH_DURATION_MS = 90_000;
const MAX_METADATA_BYTES = 1024 * 1024;
const MAX_REDIRECTS = 3;
const REQUEST_TIMEOUT_MS = 15_000;
const CC_4_URL = /^https?:\/\/(?:www\.)?creativecommons\.org\/licenses\/(by|by-sa)\/4\.0\/?(?:[?#].*)?$/i;
const WIKIMEDIA_IMAGE_HOSTS = new Set(['upload.wikimedia.org', 'thumb.wikimedia.org']);

export const MISSING_SERPER_KEY_MESSAGE = 'Set serper_api_key in the server environment (Fly secret). For local dev, export it in local-machine/dev-secrets.env and restart dev.';

export interface SerperSearchImage {
  record: WordImageRecord;
  title: string;
  sourceName: string;
  sourceUrl: string;
  originalUrl: string;
  license: 'CC BY 4.0' | 'CC BY-SA 4.0';
  licenseUrl: string;
  resultIndex: number;
}

interface SerperCandidate {
  title: string;
  imageUrl: string;
  link: string;
  source?: string;
  domain?: string;
  resultIndex: number;
}

interface SearchOptions {
  request?: typeof fetch;
  assertPublicUrl?: (url: URL) => Promise<void>;
  maxPages?: number;
  startPage?: number;
  maxDurationMs?: number;
  log?: (event: Record<string, unknown>) => void;
  onRejected?: (rejection: { imageUrl: string; reason: string }) => void;
  onComplete?: (summary: { accepted: number; candidatesSeen: number; pagesSearched: number; nextPage: number }) => void;
}

type CandidateResolution = { image: SerperSearchImage; reason?: never } | { image?: never; reason: string };

function defaultSearchLog(event: Record<string, unknown>): void {
  console.info(`[word-image-search] ${JSON.stringify(event)}`);
}

async function beforeDeadline<T>(task: Promise<T>, deadline: number): Promise<T | null> {
  const remainingMs = deadline - Date.now();
  if (remainingMs <= 0) return null;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>(resolve => { timeoutId = setTimeout(resolve, remainingMs, null); });
  const result = await Promise.race([task, timeout]);
  clearTimeout(timeoutId);
  return result;
}

export function readSerperKey(): string {
  return process.env.serper_api_key?.trim() ?? '';
}

function privateIpv4(address: string): boolean {
  const parts = address.split('.').map(Number);
  const [first, second] = parts;
  return first === 0 || first === 10 || first === 127
    || (first === 169 && second === 254)
    || (first === 172 && second! >= 16 && second! <= 31)
    || (first === 192 && second === 168)
    || (first === 100 && second! >= 64 && second! <= 127)
    || first! >= 224;
}

function privateIpv6(address: string): boolean {
  const normalized = address.toLowerCase();
  return normalized === '::' || normalized === '::1' || normalized.startsWith('fc')
    || normalized.startsWith('fd') || /^fe[89ab]/.test(normalized)
    || normalized.startsWith('::ffff:127.') || normalized.startsWith('::ffff:10.')
    || normalized.startsWith('::ffff:192.168.');
}

export async function assertPublicImageUrl(url: URL): Promise<void> {
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Unsupported image source URL.');
  if (url.username || url.password || url.hostname === 'localhost') throw new Error('Unsafe image source URL.');
  const literal = isIP(url.hostname);
  if ((literal === 4 && privateIpv4(url.hostname)) || (literal === 6 && privateIpv6(url.hostname))) throw new Error('Unsafe image source URL.');
  const addresses = literal ? [{ address: url.hostname, family: literal }] : await lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some(result => result.family === 4 ? privateIpv4(result.address) : privateIpv6(result.address))) {
    throw new Error('Unsafe image source URL.');
  }
}

async function fetchPublic(urlValue: string, request: typeof fetch, validate: (url: URL) => Promise<void>, accept: string): Promise<Response> {
  let url = new URL(urlValue);
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    await validate(url);
    const response = await request(url, {
      headers: { Accept: accept, 'User-Agent': 'TeluguNow/1.0 image-license-resolver' },
      redirect: 'manual',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (response.status < 300 || response.status >= 400) return response;
    const location = response.headers.get('location');
    await response.body?.cancel();
    if (!location || redirect === MAX_REDIRECTS) throw new Error('Image source redirected too many times.');
    url = new URL(location, url);
  }
  throw new Error('Image source redirected too many times.');
}

async function boundedBytes(response: Response, limit: number): Promise<Buffer> {
  if (!response.body || Number(response.headers.get('content-length')) > limit) {
    await response.body?.cancel();
    throw new Error('Remote response is empty or oversized.');
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new Error('Remote response is oversized.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}

export function findCc4License(html: string): Pick<SerperSearchImage, 'license' | 'licenseUrl'> | null {
  const document = load(html);
  const values = new Set<string>();
  document('a[href], link[href], meta[content]').each((_index, element) => {
    const value = document(element).attr('href') ?? document(element).attr('content');
    if (value) values.add(value.trim());
  });
  for (const value of values) {
    const match = value.match(CC_4_URL);
    if (match) return { license: match[1]!.toLowerCase() === 'by-sa' ? 'CC BY-SA 4.0' : 'CC BY 4.0', licenseUrl: value };
  }
  return null;
}

function findCc4LicenseInText(value: string): Pick<SerperSearchImage, 'license' | 'licenseUrl'> | null {
  const urls = value.match(/https?:\/\/(?:www\.)?creativecommons\.org\/licenses\/(?:by|by-sa)\/4\.0\/?(?:[?#][^\s"'<>]*)?/ig) ?? [];
  for (const licenseUrl of urls) {
    const match = licenseUrl.match(CC_4_URL);
    if (match) return { license: match[1]!.toLowerCase() === 'by-sa' ? 'CC BY-SA 4.0' : 'CC BY 4.0', licenseUrl };
  }
  return null;
}

function wikimediaFileName(imageUrl: string): string | null {
  const url = new URL(imageUrl);
  if (!WIKIMEDIA_IMAGE_HOSTS.has(url.hostname) || !url.pathname.includes('/wikipedia/commons/')) return null;
  const segments = url.pathname.split('/').filter(Boolean);
  const encoded = segments.includes('thumb') ? segments.at(-2) : segments.at(-1);
  if (!encoded) return null;
  try { return decodeURIComponent(encoded); }
  catch { return null; }
}

async function wikimediaCc4License(imageUrl: string, request: typeof fetch,
  validate: (url: URL) => Promise<void>): Promise<Pick<SerperSearchImage, 'license' | 'licenseUrl'> | null> {
  const fileName = wikimediaFileName(imageUrl);
  if (!fileName) return null;
  const api = new URL('https://commons.wikimedia.org/w/api.php');
  api.search = new URLSearchParams({
    action: 'query', format: 'json', formatversion: '2', prop: 'imageinfo', iiprop: 'extmetadata', titles: `File:${fileName}`,
  }).toString();
  const response = await fetchPublic(api.href, request, validate, 'application/json');
  if (!response.ok || !(response.headers.get('content-type') ?? '').toLowerCase().includes('json')) {
    await response.body?.cancel();
    return null;
  }
  const body: unknown = JSON.parse((await boundedBytes(response, MAX_METADATA_BYTES)).toString('utf8'));
  if (!body || typeof body !== 'object' || !('query' in body)) return null;
  const pages = (body as { query?: { pages?: unknown } }).query?.pages;
  if (!Array.isArray(pages)) return null;
  const metadata = (pages[0] as { imageinfo?: Array<{ extmetadata?: Record<string, { value?: unknown }> }> } | undefined)
    ?.imageinfo?.[0]?.extmetadata;
  const licenseUrl = metadata?.LicenseUrl?.value;
  return typeof licenseUrl === 'string' ? findCc4License(`<a href="${licenseUrl}"></a>`) : null;
}

async function serperPage(word: string, key: string, page: number, request: typeof fetch,
  creativeCommonsOnly = true): Promise<SerperCandidate[]> {
  const body = { q: word, gl: 'in', hl: 'te', page, ...(creativeCommonsOnly ? { tbs: 'sur:cl' } : {}) };
  const response = await request(SERPER_IMAGES_URL, {
    method: 'POST',
    headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    await response.body?.cancel();
    if (response.status === 401 || response.status === 403) throw new Error('Serper rejected the API key.');
    if (response.status === 429) throw new Error('Serper rate limit reached. Please try again later.');
    throw new Error(`Serper image search failed (HTTP ${response.status}).`);
  }
  const body: unknown = await response.json();
  if (!body || typeof body !== 'object' || !('images' in body) || !Array.isArray(body.images)) throw new Error('Serper returned an invalid image response.');
  return body.images.flatMap((value, index) => {
    if (!value || typeof value !== 'object') return [];
    const candidate = value as Partial<SerperCandidate>;
    return typeof candidate.title === 'string' && typeof candidate.imageUrl === 'string' && typeof candidate.link === 'string'
      ? [{ title: candidate.title, imageUrl: candidate.imageUrl, link: candidate.link,
        resultIndex: (page - 1) * 1000 + index,
        ...(typeof candidate.source === 'string' ? { source: candidate.source } : {}),
        ...(typeof candidate.domain === 'string' ? { domain: candidate.domain } : {}) }]
      : [];
  });
}

async function resolveCandidate(candidate: SerperCandidate, request: typeof fetch,
  validate: (url: URL) => Promise<void>): Promise<CandidateResolution> {
  try {
    let licensing = await wikimediaCc4License(candidate.imageUrl, request, validate);
    const imageResponse = await fetchPublic(candidate.imageUrl, request, validate, 'image/png,image/jpeg,image/webp');
    if (!imageResponse.ok) {
      await imageResponse.body?.cancel();
      return { reason: `image-http-${imageResponse.status}` };
    }
    const image = await boundedBytes(imageResponse, MAX_IMAGE_BYTES);
    const mimeType = imageType(image);
    if (!mimeType) return { reason: 'unsupported-image' };
    licensing ??= findCc4LicenseInText([
      imageResponse.headers.get('link'), imageResponse.headers.get('license'), imageResponse.headers.get('x-license-url'),
      image.toString('latin1'),
    ].filter((value): value is string => Boolean(value)).join('\n'));
    if (!licensing) return { reason: 'no-image-level-cc4-license' };
    return { image: {
      record: { image, mimeType },
      title: candidate.title.slice(0, 500),
      sourceName: (candidate.source || candidate.domain || new URL(candidate.link).hostname).slice(0, 200),
      sourceUrl: candidate.link,
      originalUrl: candidate.imageUrl,
      resultIndex: candidate.resultIndex,
      ...licensing,
    } };
  } catch (error) {
    return { reason: error instanceof Error ? `fetch-error:${error.message}` : 'fetch-error' };
  }
}

export async function searchSerperCc4Images(word: string, key: string, excludedUrls: ReadonlySet<string>,
  onImage: (image: SerperSearchImage) => boolean | Promise<boolean>, options: SearchOptions = {}): Promise<number> {
  if (!key) throw new Error(MISSING_SERPER_KEY_MESSAGE);
  const request = options.request ?? fetch;
  const validate = options.assertPublicUrl ?? assertPublicImageUrl;
  const log = options.log ?? defaultSearchLog;
  const seen = new Set(excludedUrls);
  let accepted = 0;
  let candidatesSeen = 0;
  const rejected: Record<string, number> = {};
  const startPage = options.startPage ?? 1;
  const maxPages = options.maxPages ?? MAX_SEARCH_PAGES;
  const deadline = Date.now() + (options.maxDurationMs ?? MAX_SEARCH_DURATION_MS);
  let pagesSearched = 0;
  let nextPage = startPage;
  log({ event: 'start', word, target: TARGET_RESULTS, startPage, maxPages, maxDurationMs: options.maxDurationMs ?? MAX_SEARCH_DURATION_MS, excluded: excludedUrls.size });
  for (let page = startPage; page < startPage + maxPages && accepted < TARGET_RESULTS && Date.now() < deadline; page += 1) {
    let returned = await beforeDeadline(serperPage(word, key, page, request), deadline);
    if (!returned) break;
    if (!returned.length) {
      log({ event: 'unfiltered-fallback', word, page });
      returned = await beforeDeadline(serperPage(word, key, page, request, false), deadline);
      if (!returned) break;
    }
    pagesSearched += 1;
    if (!returned.length) {
      nextPage = page + 1;
      break;
    }
    const candidates = returned.filter(candidate => {
      if (seen.has(candidate.imageUrl)) return false;
      seen.add(candidate.imageUrl);
      return true;
    });
    log({ event: 'page', word, page, returned: returned.length, newCandidates: candidates.length, accepted });
    const pending = new Map(candidates.map((candidate, index) => [index, resolveCandidate(candidate, request, validate)
      .then(result => ({ result, candidate, index }))]));
    while (pending.size && accepted < TARGET_RESULTS && Date.now() < deadline) {
      const resolved = await beforeDeadline(Promise.race(pending.values()), deadline);
      if (!resolved) break;
      pending.delete(resolved.index);
      candidatesSeen += 1;
      const source = resolved.candidate.source || resolved.candidate.domain || new URL(resolved.candidate.link).hostname;
      if (!resolved.result.image) {
        rejected[resolved.result.reason] = (rejected[resolved.result.reason] ?? 0) + 1;
        options.onRejected?.({ imageUrl: resolved.candidate.imageUrl, reason: resolved.result.reason });
        log({ event: 'rejected', word, page, resultIndex: resolved.candidate.resultIndex, source, reason: resolved.result.reason });
        continue;
      }
      if (await onImage(resolved.result.image)) {
        accepted += 1;
        log({ event: 'accepted', word, page, resultIndex: resolved.candidate.resultIndex, source, accepted });
      } else {
        rejected.duplicateContent = (rejected.duplicateContent ?? 0) + 1;
        options.onRejected?.({ imageUrl: resolved.candidate.imageUrl, reason: 'duplicate-content' });
        log({ event: 'rejected', word, page, resultIndex: resolved.candidate.resultIndex, source, reason: 'duplicate-content' });
      }
    }
    nextPage = pending.size ? page : page + 1;
  }
  log({ event: 'complete', word, accepted, target: TARGET_RESULTS, candidatesSeen, pagesSearched, nextPage, rejected });
  options.onComplete?.({ accepted, candidatesSeen, pagesSearched, nextPage });
  return accepted;
}
