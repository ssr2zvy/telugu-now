import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import { config } from '../config/config';

const MAX_AUDIO_BYTES = 4 * 1024 * 1024;
export const MISSING_SERPER_KEY_MESSAGE = 'Set SERPER_API_KEY in the server environment (Fly secret) before searching for images.';

export interface LetterAudio {
  mimeType: string;
  audio: Buffer;
}

export interface SearchResult {
  title: string;
  imageUrl: string;
  sourceUrl: string;
}

/**
 * Shared TTS and image-search stores. Both are keyed only by their request, so
 * any user asking for the same letter or the same query reuses what was already
 * retrieved instead of calling the external service again.
 */
export function sharedMediaStore(database: Database.Database, directory = path.join(config.dataDirectory, 'shared-media')) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS letter_tts (
      letter TEXT PRIMARY KEY,
      mime_type TEXT NOT NULL,
      file TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS image_search_cache (
      query TEXT PRIMARY KEY,
      results_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);

  return {
    getLetterAudio(letter: string): LetterAudio | undefined {
      const row = database.prepare('SELECT mime_type, file FROM letter_tts WHERE letter = ?')
        .get(letter.normalize('NFC')) as { mime_type: string; file: string } | undefined;
      if (!row) return undefined;
      try {
        const audio = fs.readFileSync(path.join(directory, row.file));
        return audio.length <= MAX_AUDIO_BYTES ? { mimeType: row.mime_type, audio } : undefined;
      } catch { return undefined; }
    },

    saveLetterAudio(letter: string, record: LetterAudio): LetterAudio {
      const normalized = letter.normalize('NFC');
      const file = `tts-${createHash('sha256').update(normalized).digest('hex')}.mp3`;
      fs.mkdirSync(directory, { recursive: true });
      const target = path.join(directory, file);
      if (!fs.existsSync(target)) fs.writeFileSync(target, record.audio, { flag: 'wx' });
      database.prepare(
        'INSERT OR REPLACE INTO letter_tts (letter, mime_type, file, created_at) VALUES (?, ?, ?, ?)',
      ).run(normalized, record.mimeType, file, Date.now());
      return record;
    },

    getSearch(query: string): SearchResult[] | undefined {
      const row = database.prepare('SELECT results_json FROM image_search_cache WHERE query = ?')
        .get(query) as { results_json: string } | undefined;
      if (!row) return undefined;
      try { return JSON.parse(row.results_json) as SearchResult[]; }
      catch { return undefined; }
    },

    saveSearch(query: string, results: SearchResult[]): SearchResult[] {
      database.prepare(
        'INSERT OR REPLACE INTO image_search_cache (query, results_json, created_at) VALUES (?, ?, ?)',
      ).run(query, JSON.stringify(results), Date.now());
      return results;
    },
  };
}

export function readSerperKey(): string {
  return process.env.SERPER_API_KEY?.trim() ?? '';
}

/** Generic web image search through Serper.dev. */
export async function searchImages(query: string, apiKey: string, request: typeof fetch = fetch): Promise<SearchResult[]> {
  if (!apiKey) throw new Error(MISSING_SERPER_KEY_MESSAGE);
  let response: Response;
  try {
    response = await request('https://google.serper.dev/images', {
      method: 'POST',
      headers: { 'X-API-KEY': apiKey, 'content-type': 'application/json' },
      body: JSON.stringify({ q: query, num: 20 }),
      signal: AbortSignal.timeout(20000),
    });
  } catch { throw new Error('Serper.dev could not be reached.'); }
  if (!response.ok) {
    await response.body?.cancel();
    if (response.status === 401 || response.status === 403) throw new Error('Serper.dev rejected the API key.');
    throw new Error(`Serper.dev image search failed (HTTP ${response.status}).`);
  }
  const body = await response.json() as { images?: Array<{ title?: string; imageUrl?: string; link?: string }> };
  return (body.images ?? [])
    .filter(item => typeof item.imageUrl === 'string')
    .map(item => ({
      title: typeof item.title === 'string' ? item.title : '',
      imageUrl: item.imageUrl as string,
      sourceUrl: typeof item.link === 'string' ? item.link : '',
    }));
}

/** Pollinations text-to-speech for a single Telugu letter. */
export async function generateLetterSpeech(letter: string, apiKey: string, request: typeof fetch = fetch): Promise<LetterAudio> {
  if (!apiKey) throw new Error('Set pollinations_api_key in the server environment before generating speech.');
  const url = new URL(`https://text.pollinations.ai/${encodeURIComponent(letter)}`);
  url.searchParams.set('model', 'openai-audio');
  url.searchParams.set('voice', 'nova');
  let response: Response;
  try {
    response = await request(url, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'audio/*' },
      signal: AbortSignal.timeout(60000),
    });
  } catch { throw new Error('Pollinations could not be reached for speech.'); }
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`Pollinations speech generation failed (HTTP ${response.status}).`);
  }
  const audio = Buffer.from(await response.arrayBuffer());
  if (!audio.length || audio.length > MAX_AUDIO_BYTES) throw new Error('Pollinations returned an empty or oversized recording.');
  return { mimeType: response.headers.get('content-type')?.split(';')[0] ?? 'audio/mpeg', audio };
}
