import { config } from '../config/config';
import type { ExportResponse } from '../../../shared/contracts';
import { ensureProfileRow, parseObservationAudio } from './profile-service';
import { getProfileSelectionSettings } from './selection-settings-service';
import { selectionEngine } from './selection-engine';
import { sourceRecordService } from './source-record-service';

export class InvalidExportRequestError extends Error {}

export async function generateExport(profileCode: string, count: number): Promise<ExportResponse> {
  if (!Number.isInteger(count) || count <= 0 || count > config.maxExportCount) {
    throw new InvalidExportRequestError(
      `Export count must be an integer from 1 through ${config.maxExportCount}.`,
    );
  }

  ensureProfileRow(profileCode);
  // Immutable snapshot: every selection in this export uses these exact values even if
  // profile settings are changed before this async operation finishes.
  const settings = getProfileSelectionSettings(profileCode);
  const entries: ExportResponse['entries'] = [];

  for (let index = 0; index < count; index += 1) {
    const selected = selectionEngine.select(settings);
    const resolved = await sourceRecordService.resolve(profileCode, selected.sourceId, selected.sourceKey);
    entries.push({
      position: index + 1,
      sourceId: selected.sourceId,
      sourceKey: selected.sourceKey,
      text: resolved.text,
      audio: parseObservationAudio(JSON.stringify(resolved.media)),
      diagnostic: {
        selection: selected.snapshot,
        cacheHit: resolved.cacheHit,
        requestStartedAt: resolved.requestStartedAt,
        requestCompletedAt: resolved.requestCompletedAt,
        requestDurationMs: resolved.requestDurationMs,
      },
    });
  }

  return {
    settings: {
      sourceWeights: { ...settings.sourceWeights },
      complexityPercentileTarget: settings.complexityPercentileTarget,
      complexityPercentileSpread: settings.complexityPercentileSpread,
      complexityReferenceVersion: settings.complexityReferenceVersion,
    },
    entries,
  };
}
