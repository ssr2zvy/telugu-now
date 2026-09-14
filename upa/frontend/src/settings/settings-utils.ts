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
    commonWordReduction:
      String(settings.commonWordReduction ?? 2),
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
export function sourceDisplayName(sourceId: string): string {
  const preparedNames: Record<string, string> = { 'fleurs-te': 'FLEURS', 'shrutilipi-te': 'Shrutilipi', 'indicvoices-te': 'IndicVoices' };
  if (preparedNames[sourceId]) return preparedNames[sourceId];
  const match = /^source(\d+)$/.exec(sourceId);
  return match?.[1] ?? sourceId;
}
