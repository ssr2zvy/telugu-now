import { diagnosticSectionLabel } from './diagnostic';
import { t } from './language';
import type { SettingsPage, UiLanguage } from './types';
import { Activity, Ban, ChartNoAxesCombined, Database, Download, Gauge, Globe, History, Image, Layers, Palette, RotateCcw, SlidersHorizontal, Sparkles, Workflow } from 'lucide-react';

export const settingsPageIcons = {
  index: SlidersHorizontal, sampling: SlidersHorizontal, diagnostic: Activity,
  display: Palette, export: Download, reset: RotateCcw, complexity: ChartNoAxesCombined,
  sources: Layers, dataSources: Database, trigger: Workflow, source: Database,
  complexityInfo: ChartNoAxesCombined, global: Globe, playback: Gauge, appearance: Sparkles,
  images: Image, eons: History, blacklist: Ban,
};

export const settingsGroups: Partial<Record<SettingsPage, SettingsPage[]>> = {
  index: ['sampling', 'diagnostic', 'display', 'eons', 'blacklist', 'export', 'reset'],
  sampling: ['complexity', 'sources', 'dataSources'],
  diagnostic: ['trigger', 'source', 'complexityInfo', 'global'],
  display: ['playback', 'appearance', 'images'],
};

export function parentSettingsPage(page: SettingsPage): SettingsPage {
  return (Object.entries(settingsGroups).find(([, children]) => children?.includes(page))?.[0] as SettingsPage) ?? 'index';
}

export function settingsPageLabel(page: SettingsPage, language: UiLanguage): string {
  if (page === 'sampling') return language === 'en' ? 'Sampling' : 'నమూనా ఎంపిక';
  if (page === 'display') return language === 'en' ? 'Display' : 'ప్రదర్శన';
  if (page === 'appearance') return language === 'en' ? 'Appearance' : 'రూపం';
  if (page === 'images') return language === 'en' ? 'Image generation' : 'చిత్ర సృష్టి';
  if (page === 'eons') return language === 'en' ? 'Eons' : 'యుగాలు';
  if (page === 'blacklist') return language === 'en' ? 'Blacklist' : 'బ్లాక్‌లిస్ట్';
  if (page === 'trigger' || page === 'source' || page === 'global' || page === 'complexityInfo') {
    return diagnosticSectionLabel(language, page === 'complexityInfo' ? 'complexity' : page);
  }
  const labels = { index: 'settings', sources: 'sourceWeights', playback: 'playbackSpeed', reset: 'resetQueue' } as const;
  return t(language, page in labels ? labels[page as keyof typeof labels] : page as 'complexity' | 'dataSources' | 'diagnostic' | 'export');
}