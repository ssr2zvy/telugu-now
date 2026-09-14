import { config } from '../config/config';
import { db } from '../db/database';
import type {
  ProfileSelectionSettings,
  UpdateSelectionSettingsRequest,
} from '../../../shared/contracts';
import { sourceRegistry } from './source-registry';
import { COMPLEXITY_REFERENCE_VERSION } from './selection-engine';
import { DEFAULT_COMMON_WORD_REDUCTION, MAX_COMMON_WORD_REDUCTION } from './common-word-complexity';

export class InvalidSelectionSettingsError extends Error {}

function assertFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) throw new InvalidSelectionSettingsError(`${name} must be finite.`);
}

export function validateSelectionSettings(request: UpdateSelectionSettingsRequest): void {
  assertFinite(request.complexityPercentileTarget, 'complexity target');
  assertFinite(request.complexityPercentileSpread, 'complexity spread');

  if (request.complexityPercentileTarget < 0 || request.complexityPercentileTarget > 1) {
    throw new InvalidSelectionSettingsError('Complexity target must be in [0, 1].');
  }
  if (request.complexityPercentileSpread <= 0) {
    throw new InvalidSelectionSettingsError('Complexity spread must be greater than zero.');
  }
  if (request.commonWordReduction !== undefined) {
    assertFinite(request.commonWordReduction, 'common word reduction');
    if (!Number.isInteger(request.commonWordReduction)
      || request.commonWordReduction < 0 || request.commonWordReduction > MAX_COMMON_WORD_REDUCTION) {
      throw new InvalidSelectionSettingsError(`Common word reduction must be a whole number in [0, ${MAX_COMMON_WORD_REDUCTION}].`);
    }
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
      profile_code, complexity_percentile_target, complexity_percentile_spread, common_word_reduction, updated_at
    ) VALUES (?, ?, ?, ?, ?)
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
    DEFAULT_COMMON_WORD_REDUCTION,
    now,
  );
  for (const sourceId of sourceRegistry.selectableSourceIds()) {
    insertWeight.run(profileCode, sourceId, defaultWeight(sourceId));
  }
}

export function getProfileSelectionSettings(profileCode: string): ProfileSelectionSettings {
  const sourceIds = sourceRegistry.selectableSourceIds();
  const readSettings = () => db.prepare(`
    SELECT complexity_percentile_target, complexity_percentile_spread, common_word_reduction
    FROM profile_selection_settings
    WHERE profile_code = ?
  `).get(profileCode) as {
    complexity_percentile_target: number;
    complexity_percentile_spread: number;
    common_word_reduction: number | null;
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
    complexityReferenceVersion: COMPLEXITY_REFERENCE_VERSION,
    commonWordReduction: settings.common_word_reduction ?? DEFAULT_COMMON_WORD_REDUCTION,
  };
}

export function updateProfileSelectionSettings(
  profileCode: string,
  request: UpdateSelectionSettingsRequest,
): ProfileSelectionSettings {
  validateSelectionSettings(request);
  ensureRows(profileCode);
  const now = Date.now();

  const updateSettings = db.prepare(`
    UPDATE profile_selection_settings
    SET complexity_percentile_target = ?,
        complexity_percentile_spread = ?,
        common_word_reduction = ?,
        updated_at = ?
    WHERE profile_code = ?
  `);
  const upsertWeight = db.prepare(`
    INSERT INTO profile_source_weights (profile_code, source_id, weight)
    VALUES (?, ?, ?)
    ON CONFLICT(profile_code, source_id) DO UPDATE SET weight = excluded.weight
  `);

  db.transaction(() => {
    updateSettings.run(
      request.complexityPercentileTarget,
      request.complexityPercentileSpread,
      request.commonWordReduction ?? DEFAULT_COMMON_WORD_REDUCTION,
      now,
      profileCode,
    );
    for (const sourceId of sourceRegistry.selectableSourceIds()) {
      upsertWeight.run(profileCode, sourceId, request.sourceWeights[sourceId]);
    }
  })();

  return getProfileSelectionSettings(profileCode);
}
