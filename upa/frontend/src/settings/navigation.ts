import { diagnosticSectionLabel } from './diagnostic';
import { t } from './language';
import type { SettingsPage, UiLanguage } from './types';
import { Activity, Ban, ChartNoAxesCombined, Database, Download, Gauge, Globe, History, Image, Info, Layers, RotateCcw, SlidersHorizontal, Sparkles, Workflow } from 'lucide-react';

export const settingsPageIcons = {
  index: SlidersHorizontal, sampling: SlidersHorizontal, diagnostic: Activity,
  export: Download, reset: RotateCcw, complexity: ChartNoAxesCombined,
  sources: Layers, dataSources: Database, trigger: Workflow, source: Database,
  complexityInfo: ChartNoAxesCombined, global: Globe, playback: Gauge, appearance: Sparkles,
  images: Image, eons: History, blacklist: Ban, version: Info,
};

export const settingsGroups: Partial<Record<SettingsPage, SettingsPage[]>> = {
  index: ['sampling', 'diagnostic', 'playback', 'appearance', 'images', 'eons', 'blacklist', 'export', 'version', 'reset'],
  sampling: ['complexity', 'sources', 'dataSources'],
  diagnostic: ['trigger', 'source', 'complexityInfo', 'global'],
};

export function parentSettingsPage(page: SettingsPage): SettingsPage {
  return (Object.entries(settingsGroups).find(([, children]) => children?.includes(page))?.[0] as SettingsPage) ?? 'index';
}

export function settingsPageLabel(page: SettingsPage, language: UiLanguage): string {
  if (page === 'sampling') return language === 'en' ? 'Sampling' : 'నమూనా ఎంపిక';
  if (page === 'appearance') return language === 'en' ? 'Appearance' : 'రూపం';
  if (page === 'images') return language === 'en' ? 'Image Generation' : 'చిత్ర సృష్టి';
  if (page === 'eons') return language === 'en' ? 'Eons' : 'యుగాలు';
  if (page === 'blacklist') return language === 'en' ? 'Blacklist' : 'బ్లాక్‌లిస్ట్';
  if (page === 'version') return language === 'en' ? 'Telugu Now Version' : 'తెలుగు నౌ వెర్షన్';
  if (page === 'trigger' || page === 'source' || page === 'global' || page === 'complexityInfo') {
    return diagnosticSectionLabel(language, page === 'complexityInfo' ? 'complexity' : page);
  }
  const labels = { index: 'settings', sources: 'sourceWeights', playback: 'playbackSettings', reset: 'resetQueue' } as const;
  return t(language, page in labels ? labels[page as keyof typeof labels] : page as 'complexity' | 'dataSources' | 'diagnostic' | 'export');
}