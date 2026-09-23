import type { AppearancePage } from './appearance-navigation';
export type SettingsPage =
  | AppearancePage
  | 'dataSourceDetail'
  | 'searchAttempt'
  | 'currentChain'
  | 'nextChainSearch'
  | 'lastSearchAttempt'
  | 'currentReset'
  | 'resetChain'
  | 'resetCore'
  | 'resetAllCores'
  | 'coreProgress'
  | 'objectCoverage'
  | 'coverageNotes'
  | 'searchAndParse'
  | 'currentSearches'
  | 'allTimeSearches'
  | 'cycleHistory'
  | 'parserEvents'
  | 'parserDetails'

  | 'grammarMigration'
  | 'parsingMode'
  | 'complexity'
  | 'sources'
  | 'observations'
  | 'category'
  | 'external'
  | 'parser'
  | 'parserCurrent'
  | 'diagnosticsDownload'
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
