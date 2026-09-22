export type SettingsPage =
  | 'grammarMigration'
  | 'observations'
  | 'category'
  | 'external'
  | 'parser'
  | 'epubExport'
  | 'htmlExport'
  | 'archiveExport'
  | 'archiveImport'
  | 'index'
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
  | 'playback'
  | 'diagnostic'
  | 'dataSources'
  | 'blacklist'
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
