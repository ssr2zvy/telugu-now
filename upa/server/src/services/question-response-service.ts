import type Database from 'better-sqlite3';
import type { UpdateQuestionResponseRequest } from '../../../shared/contracts';

export class InvalidQuestionResponseError extends Error {}

function assertQuestion(db: Database.Database, profileCode: string, observationId: string): void {
  const row = db.prepare(`
    SELECT 1
    FROM history_entries h
    JOIN observation_acquisitions a ON a.observation_id = h.observation_id
    WHERE h.profile_code = ? AND h.observation_id = ? AND a.observation_kind = 'question'
  `).get(profileCode, observationId);
  if (!row) throw new InvalidQuestionResponseError('Question observation not found.');
}

export function updateQuestionText(db: Database.Database, profileCode: string, observationId: string, request: UpdateQuestionResponseRequest): void {
  assertQuestion(db, profileCode, observationId);
  if (typeof request.text !== 'string' || request.text.length > 10_000) throw new InvalidQuestionResponseError('Question response text is invalid.');
  db.prepare(`
    INSERT INTO question_responses (profile_code, observation_id, response_text, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(profile_code, observation_id) DO UPDATE SET response_text = excluded.response_text, updated_at = excluded.updated_at
  `).run(profileCode, observationId, request.text, Date.now());
}

export function updateQuestionAudio(db: Database.Database, profileCode: string, observationId: string, bytes: Uint8Array, mimeType: string): void {
  assertQuestion(db, profileCode, observationId);
  if (!mimeType.startsWith('audio/') || bytes.byteLength === 0 || bytes.byteLength > 16 * 1024 * 1024) {
    throw new InvalidQuestionResponseError('Question response audio is invalid.');
  }
  db.prepare(`
    INSERT INTO question_responses (profile_code, observation_id, response_audio, response_audio_mime_type, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(profile_code, observation_id) DO UPDATE SET
      response_audio = excluded.response_audio,
      response_audio_mime_type = excluded.response_audio_mime_type,
      updated_at = excluded.updated_at
  `).run(profileCode, observationId, Buffer.from(bytes), mimeType, Date.now());
}

export function getQuestionAudio(db: Database.Database, profileCode: string, observationId: string): { bytes: Buffer; mimeType: string } | null {
  assertQuestion(db, profileCode, observationId);
  const row = db.prepare(`
    SELECT response_audio, response_audio_mime_type
    FROM question_responses WHERE profile_code = ? AND observation_id = ?
  `).get(profileCode, observationId) as { response_audio: Buffer | null; response_audio_mime_type: string | null } | undefined;
  if (!row?.response_audio || !row.response_audio_mime_type) return null;
  return { bytes: row.response_audio, mimeType: row.response_audio_mime_type };
}
