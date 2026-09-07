export type SettingsPage =
  | 'index'
  | 'complexity'
  | 'sources'
  | 'diagnostic'
  | 'export'
  | 'dataSources';
export type UiLanguage =
  | 'en'
  | 'te';
export interface SettingsDraft {
  targetPercent: string;
  spreadPercent: string;
  sourceWeights:
    Record<string, string>;
}
