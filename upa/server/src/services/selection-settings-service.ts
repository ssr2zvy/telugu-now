import { config } from '../config/config';
import { db } from '../db/database';
import type {
  ProfileSelectionSettings,
  UpdateSelectionSettingsRequest,
} from '../../../shared/contracts';
import { sourceRegistry } from './source-registry';
import { COMPLEXITY_REFERENCE_VERSION } from './selection-engine';

export class InvalidSelectionSettingsError extends Error {}

function assertFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) throw new InvalidSelectionSettingsError(`${name} must be finite.`);
}

export function validateSelectionSettings(request: ProfileSelectionSettings): void {
  assertFinite(request.complexityPercentileTarget, 'complexity target');
  assertFinite(request.complexityPercentileSpread, 'complexity spread');
  for (const [value, name] of [
    [request.questionProbability ?? 0.3, 'question probability'],
    [request.seenQuestionProbability ?? 0.75, 'seen question probability'],
    [request.audioGivenQuestionProbability ?? 0.6, 'audio-given question probability'],
  ] as const) {
    assertFinite(value, name);
    if (value < 0 || value > 1) throw new InvalidSelectionSettingsError(`${name} must be in [0, 1].`);
  }

  if (request.complexityPercentileTarget < 0 || request.complexityPercentileTarget > 1) {
    throw new InvalidSelectionSettingsError('Complexity target must be in [0, 1].');
  }
  if (request.complexityPercentileSpread <= 0) {
    throw new InvalidSelectionSettingsError('Complexity spread must be greater than zero.');
  }

  const sourceIds = sourceRegistry.selectableSourceIds();
  const providedIds = Object.keys(request.sourceWeights).sort();
  if (providedIds.length !== sourceIds.length || sourceIds.some((id) => !providedIds.includes(id))) {
    throw new InvalidSelectionSettingsError('Source weights must contain every selectable source exactly once.');
  }

  const weights = sourceIds.map((id) => request.sourceWeights[id] as number);
  for (const weight of weights) {
    assertFinite(weight, 'source weight');
    if (weight < 0 || weight > 1) {
      throw new InvalidSelectionSettingsError('Every source weight must be in [0, 1].');
    }
  }
  if (Math.max(...weights) !== 1) {
    throw new InvalidSelectionSettingsError('At least one source weight must equal 1.');
  }
}

function defaultWeight(sourceId: string): number {
  const value = config.defaultSourceWeights[sourceId as keyof typeof config.defaultSourceWeights];
  if (value === undefined) throw new Error(`No default source weight configured for ${sourceId}.`);
  return value;
}

function ensureRows(profileCode: string): void {
  const now = Date.now();
  const insertSettings = db.prepare(`
    INSERT INTO profile_selection_settings (
      profile_code, complexity_percentile_target, complexity_percentile_spread,
      question_probability, seen_question_probability, audio_given_question_probability, updated_at
    ) VALUES (?, ?, ?, 0.3, 0.75, 0.6, ?)
    ON CONFLICT(profile_code) DO NOTHING
  `);
  const insertWeight = db.prepare(`
    INSERT INTO profile_source_weights (profile_code, source_id, weight)
    VALUES (?, ?, ?)
    ON CONFLICT(profile_code, source_id) DO NOTHING
  `);

  // These are idempotent inserts. Avoid nesting a SQLite transaction when this is
  // called from queue selection, which itself may already be inside the atomic
  // consumption/replenishment transaction. A later call fills any partially missing
  // default rows after an interrupted process.
  insertSettings.run(
    profileCode,
    config.defaultComplexityPercentileTarget,
    config.defaultComplexityPercentileSpread,
    now,
  );
  for (const sourceId of sourceRegistry.selectableSourceIds()) {
    insertWeight.run(profileCode, sourceId, defaultWeight(sourceId));
  }
}

export function getProfileSelectionSettings(profileCode: string): ProfileSelectionSettings {
  const sourceIds = sourceRegistry.selectableSourceIds();
  const readSettings = () => db.prepare(`
        SELECT complexity_percentile_target, complexity_percentile_spread,
          question_probability, seen_question_probability, audio_given_question_probability
    FROM profile_selection_settings
    WHERE profile_code = ?
  `).get(profileCode) as {
    complexity_percentile_target: number;
    complexity_percentile_spread: number;
    question_probability: number;
    seen_question_probability: number;
    audio_given_question_probability: number;
  } | undefined;
  const readWeights = () => db.prepare(`
    SELECT source_id, weight
    FROM profile_source_weights
    WHERE profile_code = ?
    ORDER BY source_id
  `).all(profileCode) as Array<{ source_id: string; weight: number }>;

  let settings = readSettings();
  let weightRows = readWeights();
  if (!settings || sourceIds.some((id) => !weightRows.some((row) => row.source_id === id))) {
    ensureRows(profileCode);
    settings = readSettings();
    weightRows = readWeights();
  }
  if (!settings) throw new Error(`Selection settings missing for profile ${profileCode}.`);

  const sourceWeights: Record<string, number> = {};
  for (const sourceId of sourceIds) {
    const row = weightRows.find((candidate) => candidate.source_id === sourceId);
    if (!row) throw new Error(`Source weight missing for ${profileCode}/${sourceId}.`);
    sourceWeights[sourceId] = row.weight;
  }

  return {
    sourceWeights,
    complexityPercentileTarget: settings.complexity_percentile_target,
    complexityPercentileSpread: settings.complexity_percentile_spread,
    questionProbability: 1,
    seenQuestionProbability: settings.seen_question_probability,
    audioGivenQuestionProbability: settings.audio_given_question_probability,
    complexityReferenceVersion: COMPLEXITY_REFERENCE_VERSION,
  };
}

export function updateProfileSelectionSettings(
  profileCode: string,
  request: UpdateSelectionSettingsRequest,
): ProfileSelectionSettings {
  if(Object.keys(request).some(key=>key!=='audioGivenQuestionProbability'))throw new InvalidSelectionSettingsError('Only question type can be changed on this branch.');
  const value=request.audioGivenQuestionProbability;
  if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>1)throw new InvalidSelectionSettingsError('Question probability must be in [0,1].');
  ensureRows(profileCode);
  db.prepare('UPDATE profile_selection_settings SET question_probability=1,audio_given_question_probability=?,updated_at=? WHERE profile_code=?').run(value,Date.now(),profileCode);
  return getProfileSelectionSettings(profileCode);
}
