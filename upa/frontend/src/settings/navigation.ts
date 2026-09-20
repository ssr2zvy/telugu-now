import { diagnosticSectionLabel } from './diagnostic';
import { t } from './language';
import type { SettingsPage, UiLanguage } from './types';
import { Activity, Ban, BookOpen, ChartNoAxesCombined, CircleHelp, Database, Download, Gauge, Globe, History, Image, Info, Layers, ListOrdered, Palette, RotateCcw, SlidersHorizontal, Sparkles, Upload, Workflow } from 'lucide-react';

export const settingsPageIcons = {
  index: SlidersHorizontal, sampling: SlidersHorizontal, diagnostic: Activity,
  display: Palette, export: Download, frequencyExport: ListOrdered, import: Upload, reset: RotateCcw, complexity: ChartNoAxesCombined,
  sources: Layers, dataSources: Database, trigger: Workflow, source: Database,
  complexityInfo: ChartNoAxesCombined, global: Globe, playback: Gauge, appearance: Sparkles,
  images: Image, eons: History, blacklist: Ban,
  questions: CircleHelp,
  questionInfo: CircleHelp,
  queue: ListOrdered,
  controlsGuide: BookOpen,
  about: Info,
};

export const settingsGroups: Partial<Record<SettingsPage, SettingsPage[]>> = {
  index: ['sampling', 'diagnostic', 'display', 'eons', 'blacklist', 'export', 'frequencyExport', 'import', 'controlsGuide', 'about', 'reset'],
  sampling: ['questions', 'complexity', 'sources', 'dataSources'],
  diagnostic: ['queue', 'questionInfo', 'trigger', 'source', 'complexityInfo', 'global'],
  display: ['playback', 'appearance', 'images'],
};

export function parentSettingsPage(page: SettingsPage): SettingsPage {
  return (Object.entries(settingsGroups).find(([, children]) => children?.includes(page))?.[0] as SettingsPage) ?? 'index';
}

export function settingsPageLabel(page: SettingsPage, language: UiLanguage): string {
  if (page === 'sampling') return language === 'en' ? 'Sampling' : 'నమూనా ఎంపిక';
  if (page === 'questions') return language === 'en' ? 'Questions' : 'ప్రశ్నలు';
  if (page === 'display') return language === 'en' ? 'Display' : 'ప్రదర్శన';
  if (page === 'appearance') return language === 'en' ? 'Appearance' : 'రూపం';
  if (page === 'images') return language === 'en' ? 'Image Generation' : 'చిత్ర సృష్టి';
  if (page === 'playback') return language === 'en' ? 'Playback Settings' : 'ప్లేబ్యాక్ అమరికలు';
  if (page === 'eons') return language === 'en' ? 'Eons' : 'యుగాలు';
  if (page === 'blacklist') return language === 'en' ? 'Blacklist' : 'బ్లాక్‌లిస్ట్';
  if (page === 'queue') return language === 'en' ? 'View the Queue' : 'క్యూను చూడండి';
  if (page === 'import') return language === 'en' ? 'Import' : 'దిగుమతి';
  if (page === 'frequencyExport') return language === 'en' ? 'Frequency Export' : 'పద పౌనఃపున్య ఎగుమతి';
  if (page === 'controlsGuide') return language === 'en' ? 'Controls Guide' : 'నియంత్రణల మార్గదర్శి';
  if (page === 'about') return language === 'en' ? 'Version & Deployment' : 'వెర్షన్ మరియు అమలు';
  if (page === 'questionInfo') return diagnosticSectionLabel(language, 'questions');
  if (page === 'trigger' || page === 'source' || page === 'global' || page === 'complexityInfo') {
    return diagnosticSectionLabel(language, page === 'complexityInfo' ? 'complexity' : page);
  }
  if (page === 'sources') return language === 'en' ? 'Source Weights' : t(language, 'sourceWeights');
  if (page === 'dataSources') return language === 'en' ? 'Data Sources' : t(language, 'dataSources');
  if (page === 'reset') return language === 'en' ? 'Reset Queue' : t(language, 'resetQueue');
  const labels = { index: 'settings' } as const;
  return t(language, page in labels ? labels[page as keyof typeof labels] : page as 'complexity' | 'dataSources' | 'diagnostic' | 'export');
}