import type {
  ProfileSelectionSettings,
} from '../../../shared/contracts';
import type {
  SettingsDraft,
} from './types';
export function draftFromSettings(
  settings:
    ProfileSelectionSettings,
): SettingsDraft {
  return {
    targetPercent:
      String(
        settings
          .complexityPercentileTarget *
          100,
      ),
    spreadPercent:
      String(
        settings
          .complexityPercentileSpread *
          100,
      ),
    sourceWeights:
      Object.fromEntries(
        Object.entries(
          settings.sourceWeights,
        ).map(
          ([sourceId, weight]) => [
            sourceId,
            String(weight),
          ],
        ),
      ),
  };
}
export function sourceDisplayName(
  sourceId: string,
): string {
  const match =
    /^source(\d+)$/.exec(
      sourceId,
    );
  return match?.[1] ?? sourceId;
}
