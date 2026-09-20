export type SettingsPage =
  | 'index'
  | 'sampling'
  | 'questions'
  | 'display'
  | 'appearance'
  | 'images'
  | 'eons'
  | 'reset'
  | 'trigger'
  | 'source'
  | 'complexityInfo'
  | 'global'
  | 'questionInfo'
  | 'queue'
  | 'complexity'
  | 'sources'
  | 'playback'
  | 'diagnostic'
  | 'dataSources'
  | 'blacklist'
  | 'export'
  | 'frequencyExport'
  | 'import'
  | 'controlsGuide'
  | 'about';
export type UiLanguage =
  | 'en'
  | 'te';
export interface SettingsDraft {
  targetPercent: string;
  spreadPercent: string;
  questionPercent?: string;
  seenQuestionPercent?: string;
  audioGivenQuestionPercent?: string;
  sourceWeights:
    Record<string, string>;
}
