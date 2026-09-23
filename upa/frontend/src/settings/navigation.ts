import { diagnosticSectionLabel } from './diagnostic';
import { t } from './language';
import type { SettingsPage, UiLanguage } from './types';
import { Activity, Ban, BookOpen, ChartNoAxesCombined, CircleHelp, Database, Download, Gauge, Globe, History, Image, Info, ListOrdered, Palette, RotateCcw, SlidersHorizontal, Sparkles, Upload, Workflow } from 'lucide-react';

export const settingsPageIcons = {
  searchAttempt: Activity,
  currentChain: ListOrdered,
  nextChainSearch: Activity,
  lastSearchAttempt: Activity,
  currentReset: RotateCcw,
  coreProgress: Activity,
  objectCoverage: Activity,
  coverageNotes: Activity,
  searchAndParse: Activity,
  currentSearches: Activity,
  allTimeSearches: Activity,
  cycleHistory: Activity,
  parserEvents: Activity,
  parserDetails: Activity,

  diagnosticsDownload: Download, parsingMode: CircleHelp, complexity: Gauge, sources: SlidersHorizontal, grammarMigration: Database, category: ChartNoAxesCombined,
  parserCurrent: ListOrdered, index: SlidersHorizontal, observations: BookOpen, external: Download, parser: Workflow, diagnostic: Activity,
  display: Palette, epubExport: BookOpen, htmlExport: Download, archiveExport: Download, archiveImport: Upload, reset: RotateCcw,
  dataSources: Database, trigger: Workflow, source: Database,
  complexityInfo: ChartNoAxesCombined, global: Globe, playback: Gauge, appearance: Sparkles,
  images: Image, eons: History, blacklist: Ban,
  questionInfo: CircleHelp,
  queue: ListOrdered,
  controlsGuide: BookOpen,
  about: Info,
};

export const settingsGroups: Partial<Record<SettingsPage, SettingsPage[]>> = {
  index: ['observations', 'external', 'display', 'eons', 'controlsGuide', 'about'],
  external: ['epubExport', 'htmlExport', 'archiveExport', 'archiveImport'],
  observations: ['parser', 'parsingMode', 'dataSources'],
  parser: ['parserCurrent', 'diagnostic'],
  parserCurrent: ['currentChain','nextChainSearch','currentReset','coreProgress'],
  nextChainSearch: ['lastSearchAttempt'],
  diagnostic: ['objectCoverage','searchAndParse','cycleHistory','parserEvents','parserDetails'],
  objectCoverage: ['coverageNotes'],
  searchAndParse: ['currentSearches','allTimeSearches'],
  parserEvents: ['diagnosticsDownload'],
  display: ['playback', 'appearance', 'images'],
};

export function parentSettingsPage(page: SettingsPage): SettingsPage {
  return (Object.entries(settingsGroups).find(([, children]) => children?.includes(page))?.[0] as SettingsPage) ?? 'index';
}

export function settingsPageLabel(page: SettingsPage, language: UiLanguage): string {
  const parserLabels:Partial<Record<SettingsPage,string>>={"currentChain": "Chain", "nextChainSearch": "Next chain search", "lastSearchAttempt": "Last search and parse attempt", "currentReset": "Reset", "coreProgress": "Progress by core", "objectCoverage": "Object coverage", "coverageNotes": "Coverage notes", "searchAndParse": "Search and parse", "currentSearches": "Current searches", "allTimeSearches": "All-time searches", "cycleHistory": "Cycle history", "parserEvents": "Events", "parserDetails": "Parser details"};
  if(parserLabels[page])return parserLabels[page]!;
  if (page === 'searchAttempt') return 'Search and parse attempt';
  if (page === 'observations') return language === 'en' ? 'Observations' : 'పరిశీలనలు';
  if (page === 'parser') return language === 'en' ? 'Parser' : 'పార్సర్';
  if (page === 'parserCurrent') return language === 'en' ? 'Current' : 'ప్రస్తుతం';
  if (page === 'diagnostic') return language === 'en' ? 'Diagnostics' : 'విశ్లేషణ';
  if (page === 'diagnosticsDownload') return language === 'en' ? 'Download' : 'పూర్తి విశ్లేషణను డౌన్‌లోడ్ చేయండి';
  if (page === 'parsingMode') return language === 'en' ? 'Questions' : 'ప్రశ్నలు';
  if (page === 'complexity') return language === 'en' ? 'Complexity' : 'సంక్లిష్టత';
  if (page === 'sources') return language === 'en' ? 'Source Weights' : 'మూలాల బరువులు';
  if (page === 'grammarMigration') return 'Grammar Migration';
  if (page === 'category') return language === 'en' ? 'Category' : 'వర్గం';
  if (page === 'external') return language === 'en' ? 'External' : 'బాహ్య';
  if (page === 'epubExport') return language === 'en' ? 'EPUB Export' : 'EPUB ఎగుమతి';
  if (page === 'htmlExport') return language === 'en' ? 'HTML Export' : 'HTML ఎగుమతి';
  if (page === 'archiveExport') return language === 'en' ? 'App Archive Export' : 'యాప్ ఆర్కైవ్ ఎగుమతి';
  if (page === 'display') return language === 'en' ? 'Display' : 'ప్రదర్శన';
  if (page === 'appearance') return language === 'en' ? 'Appearance' : 'రూపం';
  if (page === 'images') return language === 'en' ? 'Image Generation' : 'చిత్ర సృష్టి';
  if (page === 'playback') return language === 'en' ? 'Playback Settings' : 'ప్లేబ్యాక్ అమరికలు';
  if (page === 'eons') return language === 'en' ? 'Eons' : 'యుగాలు';
  if (page === 'blacklist') return language === 'en' ? 'Blacklist' : 'బ్లాక్‌లిస్ట్';
  if (page === 'queue') return language === 'en' ? 'View the Queue' : 'క్యూను చూడండి';
  if (page === 'archiveImport') return language === 'en' ? 'App Archive Import' : 'యాప్ ఆర్కైవ్ దిగుమతి';
  if (page === 'controlsGuide') return language === 'en' ? 'Controls Guide' : 'నియంత్రణల మార్గదర్శి';
  if (page === 'about') return language === 'en' ? 'Version & Deployment' : 'వెర్షన్ మరియు అమలు';
  if (page === 'questionInfo') return diagnosticSectionLabel(language, 'questions');
  if (page === 'trigger' || page === 'source' || page === 'global' || page === 'complexityInfo') {
    return diagnosticSectionLabel(language, page === 'complexityInfo' ? 'complexity' : page);
  }
  if (page === 'dataSources') return language === 'en' ? 'Data Sources' : t(language, 'dataSources');
  if (page === 'reset') return language === 'en' ? 'Reset Queue' : t(language, 'resetQueue');
  const labels = { index: 'settings' } as const;
  return t(language, page in labels ? labels[page as keyof typeof labels] : page as 'complexity' | 'dataSources' | 'diagnostic' | 'export');
}
export function visibleSettingsEntries(page: SettingsPage, migrationAvailable: boolean): SettingsPage[] {
  return (settingsGroups[page] ?? []).filter(entry => entry !== 'grammarMigration' || migrationAvailable);
}

export const exportFormatForPage = {epubExport: 'epub', htmlExport: 'html', archiveExport: 'app-archive'} as const;

