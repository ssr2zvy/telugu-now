import { config } from '../config/config';
import { db } from '../db/database';
import type {
  ProfileAudioSettings,
  UpdateAudioSettingsRequest,
} from '../../../shared/contracts';

import { AUDIO_PLAYBACK_RATE_MIN, AUDIO_PLAYBACK_RATE_MAX, clampPlaybackRate } from '../../../shared/audio';
export { AUDIO_PLAYBACK_RATE_MIN, AUDIO_PLAYBACK_RATE_MAX } from '../../../shared/audio';

export class InvalidAudioSettingsError extends Error {}

export function validateAudioSettings(request: UpdateAudioSettingsRequest): void {
  if (!Number.isFinite(request.playbackRate)) {
    throw new InvalidAudioSettingsError('Playback rate must be finite.');
  }
  if (request.playbackRate < AUDIO_PLAYBACK_RATE_MIN || request.playbackRate > AUDIO_PLAYBACK_RATE_MAX) {
    throw new InvalidAudioSettingsError(
      `Playback rate must be between ${AUDIO_PLAYBACK_RATE_MIN} and ${AUDIO_PLAYBACK_RATE_MAX}.`,
    );
  }
}

function ensureRow(profileCode: string): void {
  db.prepare(`
    INSERT INTO profile_audio_settings (profile_code, playback_rate, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(profile_code) DO NOTHING
  `).run(profileCode, config.defaultAudioPlaybackRate, Date.now());
}

export function getProfileAudioSettings(profileCode: string): ProfileAudioSettings {
  ensureRow(profileCode);
  const row = db.prepare(`
    SELECT playback_rate FROM profile_audio_settings WHERE profile_code = ?
  `).get(profileCode) as { playback_rate: number } | undefined;
  if (!row) throw new Error(`Audio settings missing for profile ${profileCode}.`);
  return { playbackRate: clampPlaybackRate(row.playback_rate) };
}

export function updateProfileAudioSettings(
  profileCode: string,
  request: UpdateAudioSettingsRequest,
): ProfileAudioSettings {
  validateAudioSettings(request);
  ensureRow(profileCode);
  db.prepare(`
    UPDATE profile_audio_settings SET playback_rate = ?, updated_at = ? WHERE profile_code = ?
  `).run(request.playbackRate, Date.now(), profileCode);
  return getProfileAudioSettings(profileCode);
}
