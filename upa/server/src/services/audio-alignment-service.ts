import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { Hono } from 'hono';
import type {
  AlignedLetterAudio,
  AlignedWordAudio,
  AudioAlignmentStatus,
  AudioMedia,
  MediaItem,
  ObservationAudio,
} from '../../../shared/contracts';
import { config } from '../config/config';
import { initializeAudioAlignmentSchema } from '../db/audio-alignments';
import { getCorpusObjectStore, objectBodyStream } from './corpus-object-store';
import { resolveAudioFilePath } from './audio-service';

export const AUDIO_ALIGNMENT_ENGINE_VERSION = 'espeak-dtw-v1';

export interface AlignmentInterval {
  index: number;
  text: string;
  startSeconds: number;
  endSeconds: number;
  status: AudioAlignmentStatus;
}

export interface SentenceAlignmentResult {
  words: AlignmentInterval[];
}

export interface WordAlignmentResult {
  status: AudioAlignmentStatus;
  writtenUnits: AlignmentInterval[];
  phonemes: Array<{ referenceLabel: string; startSeconds: number; endSeconds: number }>;
}

export interface AudioAlignmentEngine {
  alignSentence(input: { audioPath: string; transcript: string; words: Array<{ index: number; text: string }> }): Promise<SentenceAlignmentResult>;
  alignWord(input: { audioPath: string; word: string; startSeconds: number; endSeconds: number; writtenUnits: Array<{ index: number; text: string }> }): Promise<WordAlignmentResult>;
}

interface AlignmentDependencies {
  profileCodes?: ReadonlySet<string>;
  engine?: AudioAlignmentEngine;
  withAudioFile?: <T>(objectKey: string, run: (audioPath: string) => Promise<T>) => Promise<T>;
}

interface ObservationRecord {
  id: string;
  text: string;
  sourceId: string;
  sourceKey: string;
  audio: AudioMedia;
}

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function audioUrl(objectKey: string): string {
  return `/api/audio/${objectKey.split('/').map(encodeURIComponent).join('/')}?v=2`;
}

function segmentAudio(audio: AudioMedia, startSeconds: number, endSeconds: number): ObservationAudio {
  const start = Math.round(Math.max(0, Math.min(audio.durationSeconds, startSeconds)) * 1e6) / 1e6;
  const end = Math.round(Math.max(start, Math.min(audio.durationSeconds, endSeconds)) * 1e6) / 1e6;
  return {
    url: `${audioUrl(audio.objectKey)}#t=${start.toFixed(6)},${end.toFixed(6)}`,
    mimeType: audio.mimeType,
    durationSeconds: Math.round((end - start) * 1e6) / 1e6,
  };
}

function sentenceWords(text: string): Array<{ index: number; text: string; start: number; end: number }> {
  return [...new Intl.Segmenter('te', { granularity: 'word' }).segment(text)]
    .filter(segment => segment.isWordLike)
    .map((segment, index) => ({ index, text: segment.segment, start: segment.index, end: segment.index + segment.segment.length }));
}

function writtenUnits(text: string): Array<{ index: number; text: string; start: number; end: number }> {
  return [...new Intl.Segmenter('te', { granularity: 'grapheme' }).segment(text)]
    .map((segment, index) => ({ index, text: segment.segment, start: segment.index, end: segment.index + segment.segment.length }));
}

function validInterval(value: AlignmentInterval, expected: { index: number; text: string }, duration: number): boolean {
  return value.index === expected.index && value.text === expected.text
    && Number.isFinite(value.startSeconds) && Number.isFinite(value.endSeconds)
    && value.startSeconds >= 0 && value.endSeconds > value.startSeconds && value.endSeconds <= duration + .001
    && (value.status === 'estimated' || value.status === 'needs_review');
}

function parseMedia(value: string): AudioMedia | null {
  try {
    const media = JSON.parse(value) as MediaItem[];
    const audio = media.find((item): item is AudioMedia => item?.kind === 'audio');
    return audio && typeof audio.objectKey === 'string' && typeof audio.sha256 === 'string'
      && Number.isFinite(audio.durationSeconds) && audio.durationSeconds > 0 ? audio : null;
  } catch {
    return null;
  }
}

function observationRecord(database: Database.Database, profileCode: string, observationId: string): ObservationRecord | null {
  const row = database.prepare(`
    SELECT o.id, COALESCE(o.text, sr.text) AS text, o.source_id, o.source_key, sr.media_json
    FROM observations o
    JOIN observation_acquisitions acquisition ON acquisition.observation_id = o.id AND acquisition.profile_code = ?
    JOIN source_records sr ON sr.profile_code = ? AND sr.source_id = o.source_id AND sr.source_key = o.source_key
    WHERE o.id = ? AND o.status = 'ready'
  `).get(profileCode, profileCode, observationId) as {
    id: string; text: string | null; source_id: string; source_key: string; media_json: string;
  } | undefined;
  if (!row?.text) return null;
  const audio = parseMedia(row.media_json);
  return audio ? { id: row.id, text: row.text, sourceId: row.source_id, sourceKey: row.source_key, audio } : null;
}

function runPython(request: unknown): Promise<unknown> {
  const script = path.join(path.dirname(fileURLToPath(import.meta.url)), 'alignment-engine.py');
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.AUDIO_ALIGNMENT_PYTHON ?? 'python3', [script], { stdio: ['pipe', 'pipe', 'pipe'] });
    const output: Buffer[] = [];
    const errors: Buffer[] = [];
    const timer = setTimeout(() => child.kill('SIGKILL'), 120_000);
    child.stdout.on('data', chunk => output.push(Buffer.from(chunk)));
    child.stderr.on('data', chunk => errors.push(Buffer.from(chunk)));
    child.on('error', reject);
    child.on('close', code => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(Buffer.concat(errors).toString('utf8').trim() || `Alignment engine exited with code ${code}.`));
        return;
      }
      try { resolve(JSON.parse(Buffer.concat(output).toString('utf8'))); }
      catch { reject(new Error('Alignment engine returned invalid output.')); }
    });
    child.stdin.end(JSON.stringify(request));
  });
}

const defaultEngine: AudioAlignmentEngine = {
  alignSentence: input => runPython({ operation: 'sentence', ...input }) as Promise<SentenceAlignmentResult>,
  alignWord: input => runPython({ operation: 'word', ...input }) as Promise<WordAlignmentResult>,
};

async function defaultWithAudioFile<T>(objectKey: string, run: (audioPath: string) => Promise<T>): Promise<T> {
  if (config.corpusBackend === 'local') return run(resolveAudioFilePath(objectKey));
  const directory = path.join(tmpdir(), `telugu-now-alignment-${randomUUID()}`);
  const audioPath = path.join(directory, path.basename(objectKey));
  await mkdir(directory, { recursive: true });
  try {
    const object = await getCorpusObjectStore().getObject(objectKey);
    await pipeline(objectBodyStream(object.Body), createWriteStream(audioPath, { flags: 'wx', mode: 0o600 }));
    return await run(audioPath);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function cachedJson<T>(database: Database.Database, table: string, cacheKey: string): T | null {
  const row = database.prepare(`SELECT result_json FROM ${table} WHERE cache_key = ?`).get(cacheKey) as { result_json: string } | undefined;
  if (!row) return null;
  try { return JSON.parse(row.result_json) as T; }
  catch { database.prepare(`DELETE FROM ${table} WHERE cache_key = ?`).run(cacheKey); return null; }
}

export function audioAlignmentRoutes(database: Database.Database, dependencies: AlignmentDependencies = {}): Hono {
  initializeAudioAlignmentSchema(database);
  const profileCodes = dependencies.profileCodes ?? config.profileCodes;
  const engine = dependencies.engine ?? defaultEngine;
  const withAudioFile = dependencies.withAudioFile ?? defaultWithAudioFile;
  const inFlight = new Map<string, Promise<unknown>>();

  const sentenceAlignment = async (record: ObservationRecord): Promise<SentenceAlignmentResult> => {
    const words = sentenceWords(record.text);
    const key = digest([AUDIO_ALIGNMENT_ENGINE_VERSION, record.audio.sha256, record.text]);
    const cached = cachedJson<SentenceAlignmentResult>(database, 'sentence_audio_alignments', key);
    if (cached?.words.length === words.length && cached.words.every((word, index) => validInterval(word, words[index]!, record.audio.durationSeconds))) return cached;
    let task = inFlight.get(`sentence:${key}`) as Promise<SentenceAlignmentResult> | undefined;
    if (!task) {
      task = withAudioFile(record.audio.objectKey, audioPath => engine.alignSentence({
        audioPath,
        transcript: record.text,
        words: words.map(({ index, text }) => ({ index, text })),
      })).then(result => {
        if (result.words.length !== words.length || !result.words.every((word, index) => validInterval(word, words[index]!, record.audio.durationSeconds))) {
          throw new Error('Sentence alignment returned invalid word boundaries.');
        }
        database.prepare(`
          INSERT OR REPLACE INTO sentence_audio_alignments
            (cache_key, engine_version, audio_sha256, transcript, result_json, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(key, AUDIO_ALIGNMENT_ENGINE_VERSION, record.audio.sha256, record.text, JSON.stringify(result), Date.now());
        return result;
      }).finally(() => inFlight.delete(`sentence:${key}`));
      inFlight.set(`sentence:${key}`, task);
    }
    return task;
  };

  const wordAlignment = async (record: ObservationRecord, word: AlignmentInterval): Promise<WordAlignmentResult> => {
    const units = writtenUnits(word.text);
    const key = digest([AUDIO_ALIGNMENT_ENGINE_VERSION, record.audio.sha256, word.text, word.startSeconds, word.endSeconds]);
    const cached = cachedJson<WordAlignmentResult>(database, 'word_audio_alignments', key);
    const duration = word.endSeconds - word.startSeconds;
    if (cached?.writtenUnits.length === units.length && cached.writtenUnits.every((unit, index) => validInterval(unit, units[index]!, duration))) return cached;
    let task = inFlight.get(`word:${key}`) as Promise<WordAlignmentResult> | undefined;
    if (!task) {
      task = withAudioFile(record.audio.objectKey, audioPath => engine.alignWord({
        audioPath,
        word: word.text,
        startSeconds: word.startSeconds,
        endSeconds: word.endSeconds,
        writtenUnits: units.map(({ index, text }) => ({ index, text })),
      })).then(result => {
        if ((result.status !== 'estimated' && result.status !== 'needs_review')
          || result.writtenUnits.length !== units.length
          || !result.writtenUnits.every((unit, index) => validInterval(unit, units[index]!, duration))) {
          throw new Error('Word alignment returned invalid written-unit boundaries.');
        }
        database.prepare(`
          INSERT OR REPLACE INTO word_audio_alignments
            (cache_key, engine_version, audio_sha256, word_text, sentence_start_seconds, sentence_end_seconds, result_json, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(key, AUDIO_ALIGNMENT_ENGINE_VERSION, record.audio.sha256, word.text, word.startSeconds, word.endSeconds, JSON.stringify(result), Date.now());
        return result;
      }).finally(() => inFlight.delete(`word:${key}`));
      inFlight.set(`word:${key}`, task);
    }
    return task;
  };

  const app = new Hono();
  app.post('/:code/alignments/word', async context => {
    const code = context.req.param('code');
    if (!profileCodes.has(code)) return context.json({ error: 'invalid-profile-code' }, 404);
    const body = await context.req.json().catch(() => null) as { observationId?: unknown; wordStart?: unknown; wordEnd?: unknown } | null;
    if (!body || typeof body.observationId !== 'string' || !Number.isSafeInteger(body.wordStart) || !Number.isSafeInteger(body.wordEnd)) {
      return context.json({ error: 'invalid-alignment-request' }, 400);
    }
    const record = observationRecord(database, code, body.observationId);
    if (!record) return context.json({ error: 'alignment-source-not-found' }, 404);
    const target = sentenceWords(record.text).find(word => word.start === body.wordStart && word.end === body.wordEnd);
    if (!target) return context.json({ error: 'word-not-found' }, 400);
    try {
      const alignment = await sentenceAlignment(record);
      const word = alignment.words[target.index]!;
      const response: AlignedWordAudio = {
        index: target.index,
        text: target.text,
        transcriptStart: target.start,
        transcriptEnd: target.end,
        status: word.status,
        audio: segmentAudio(record.audio, word.startSeconds, word.endSeconds),
      };
      return context.json(response);
    } catch {
      return context.json({ error: 'Could not align this recording.' }, 503);
    }
  });

  app.post('/:code/alignments/letter', async context => {
    const code = context.req.param('code');
    if (!profileCodes.has(code)) return context.json({ error: 'invalid-profile-code' }, 404);
    const body = await context.req.json().catch(() => null) as {
      observationId?: unknown; wordStart?: unknown; wordEnd?: unknown; graphemeStart?: unknown; graphemeEnd?: unknown;
    } | null;
    if (!body || typeof body.observationId !== 'string' || !Number.isSafeInteger(body.wordStart)
      || !Number.isSafeInteger(body.wordEnd) || !Number.isSafeInteger(body.graphemeStart) || !Number.isSafeInteger(body.graphemeEnd)) {
      return context.json({ error: 'invalid-alignment-request' }, 400);
    }
    const record = observationRecord(database, code, body.observationId);
    if (!record) return context.json({ error: 'alignment-source-not-found' }, 404);
    const target = sentenceWords(record.text).find(word => word.start === body.wordStart && word.end === body.wordEnd);
    if (!target) return context.json({ error: 'word-not-found' }, 400);
    const unit = writtenUnits(target.text).find(candidate => candidate.start === body.graphemeStart && candidate.end === body.graphemeEnd);
    if (!unit) return context.json({ error: 'letter-not-found' }, 400);
    try {
      const sentence = await sentenceAlignment(record);
      const word = sentence.words[target.index]!;
      const aligned = await wordAlignment(record, word);
      const selected = aligned.writtenUnits[unit.index]!;
      const startSeconds = word.startSeconds + selected.startSeconds;
      const endSeconds = word.startSeconds + selected.endSeconds;
      const response: AlignedLetterAudio = {
        text: unit.text,
        word: target.text,
        graphemeIndex: unit.index,
        status: selected.status === 'needs_review' || aligned.status === 'needs_review' ? 'needs_review' : 'estimated',
        audio: segmentAudio(record.audio, startSeconds, endSeconds),
        sourceId: record.sourceId,
        sourceKey: `${record.sourceKey}:${target.start}-${target.end}:${unit.start}-${unit.end}`,
      };
      return context.json(response);
    } catch {
      return context.json({ error: 'Could not align this word.' }, 503);
    }
  });

  return app;
}
