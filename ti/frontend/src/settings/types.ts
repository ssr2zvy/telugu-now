export type SettingsPage =
  | 'index'
  | 'sampling'
  | 'display'
  | 'appearance'
  | 'reset'
  | 'trigger'
  | 'source'
  | 'complexityInfo'
  | 'global'
  | 'complexity'
  | 'sources'
  | 'playback'
  | 'diagnostic'
  | 'dataSources'
  | 'export';
export type UiLanguage =
  | 'en'
  | 'te';
export interface SettingsDraft {
  targetPercent: string;
  spreadPercent: string;
  sourceWeights:
    Record<string, string>;
}
