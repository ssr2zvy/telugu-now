import type Database from 'better-sqlite3';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { GraphemeWord } from '../../../shared/contracts';
import { config } from '../config/config';
import { preparedCorpusStore, type CorpusGraphemeWord, type PreparedCorpusStore } from '../sources/prepared-corpus/prepared-corpus-store';

interface GraphemeWordRequest {
  grapheme?: unknown;
}

function validText(value: unknown, maximum: number): value is string {
  return typeof value === 'string' && value.normalize('NFC').trim().length > 0
    && [...value].length <= maximum && !value.includes('\0');
}

export function selectGraphemeWord(candidates: readonly CorpusGraphemeWord[],
  blacklistedWords: ReadonlySet<string>): CorpusGraphemeWord | null {
  const byWord = new Map<string, CorpusGraphemeWord>();
  for (const candidate of candidates) if (!byWord.has(candidate.word)) byWord.set(candidate.word, candidate);
  const unique = [...byWord.values()];
  return unique.find(candidate => !blacklistedWords.has(candidate.word)) ?? unique[0] ?? null;
}

function audioUrl(objectKey: string): string {
  return `/api/audio/${objectKey.split('/').map(encodeURIComponent).join('/')}?v=2`;
}

export function graphemeWordRoutes(database: Database.Database, dependencies: {
  corpus?: Pick<PreparedCorpusStore, 'wordsContaining'>;
  profileCodes?: ReadonlySet<string>;
} = {}): Hono {
  const corpus = dependencies.corpus ?? preparedCorpusStore;
  const app = new Hono();
  app.use('/:code/grapheme-word', bodyLimit({ maxSize: 32768, onError: context => context.json({ error: 'request-too-large' }, 413) }));
  app.post('/:code/grapheme-word', async context => {
    const code = context.req.param('code');
    if (!(dependencies.profileCodes ?? config.profileCodes).has(code)
      || !database.prepare('SELECT 1 FROM profiles WHERE code = ?').get(code)) {
      return context.json({ error: 'invalid-profile-code' }, 404);
    }
    const body: GraphemeWordRequest | null = await context.req.json().catch(() => null);
    if (!body || !validText(body.grapheme, 16) || Object.keys(body).some(key => key !== 'grapheme')) {
      return context.json({ error: 'invalid-grapheme-word-request' }, 400);
    }
    const grapheme = body.grapheme.normalize('NFC').trim();
    if ([...new Intl.Segmenter('te', { granularity: 'grapheme' }).segment(grapheme)].length !== 1) {
      return context.json({ error: 'invalid-grapheme-word-request' }, 400);
    }
    const blacklisted = new Set<string>();
    const selected = selectGraphemeWord(corpus.wordsContaining(grapheme), blacklisted);
    if (!selected) return context.json({ error: 'grapheme-word-not-found' }, 404);
    return context.json<GraphemeWord>({
      word: selected.word,
      complexity: selected.complexity,
      wordGraphemeCount: selected.wordGraphemeCount,
      sourceId: selected.sourceId,
      sourceKey: selected.sourceKey,
      audio: { url: audioUrl(selected.audioObjectKey), mimeType: selected.audioMimeType, durationSeconds: selected.durationSeconds },
    });
  });
  return app;
}