import { diagnosticSectionLabel } from './diagnostic';
import { t } from './language';
import type { SettingsPage, UiLanguage } from './types';

export const settingsGroups: Partial<Record<SettingsPage, SettingsPage[]>> = {
  index: ['sampling', 'diagnostic', 'display', 'export', 'reset'],
  sampling: ['complexity', 'sources', 'dataSources'],
  diagnostic: ['trigger', 'source', 'complexityInfo', 'global'],
  display: ['playback', 'appearance'],
};

export function parentSettingsPage(page: SettingsPage): SettingsPage {
  return (Object.entries(settingsGroups).find(([, children]) => children?.includes(page))?.[0] as SettingsPage) ?? 'index';
}

export function settingsPageLabel(page: SettingsPage, language: UiLanguage): string {
  if (page === 'sampling') return language === 'en' ? 'Sampling' : 'నమూనా ఎంపిక';
  if (page === 'display') return language === 'en' ? 'Display' : 'ప్రదర్శన';
  if (page === 'appearance') return language === 'en' ? 'Appearance' : 'రూపం';
  if (page === 'trigger' || page === 'source' || page === 'global' || page === 'complexityInfo') {
    return diagnosticSectionLabel(language, page === 'complexityInfo' ? 'complexity' : page);
  }
  const labels = { index: 'settings', sources: 'sourceWeights', playback: 'playbackSpeed', reset: 'resetQueue' } as const;
  return t(language, page in labels ? labels[page as keyof typeof labels] : page as 'complexity' | 'dataSources' | 'diagnostic' | 'export');
}