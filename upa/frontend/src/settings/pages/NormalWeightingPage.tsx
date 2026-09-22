import { useState } from 'react';
import type { ProfileSelectionSettings } from '../../../../shared/contracts';
import { updateSelectionSettings } from '../../api';
import { ComplexityPage } from './ComplexityPage';
import { SourceWeightsPage } from './SourceWeightsPage';
import { draftFromSettings } from '../settings-utils';
import type { UiLanguage } from '../types';

export function NormalWeightingPage({ profileCode, settings, section, language, onSaved }: {
  profileCode: string; settings: ProfileSelectionSettings; section: 'complexity' | 'sources'; language: UiLanguage;
  onSaved: (settings: ProfileSelectionSettings) => void;
}) {
  const [draft, setDraft] = useState(() => draftFromSettings(settings));
  const [saving, setSaving] = useState(false), [error, setError] = useState(false);
  const save = async () => {
    if (saving) return;
    setSaving(true); setError(false);
    try {
      const request = section === 'sources' ? { sourceWeights: Object.fromEntries(Object.entries(draft.sourceWeights).map(([key, value]) => [key, Number(value)])) }
        : { complexityPercentileTarget: Number(draft.targetPercent) / 100, complexityPercentileSpread: Number(draft.spreadPercent) / 100 };
      const updated = await updateSelectionSettings(profileCode, request);
      setDraft(draftFromSettings(updated)); onSaved(updated);
    } catch { setError(true); } finally { setSaving(false); }
  };
  const Page = section === 'sources' ? SourceWeightsPage : ComplexityPage;
  return <><p>These saved settings control normal weighted mode.</p><Page language={language} draft={draft} saving={saving} error={error}
    onDraftChange={setDraft} onClearError={() => setError(false)} onSave={() => void save()} /></>;
}
