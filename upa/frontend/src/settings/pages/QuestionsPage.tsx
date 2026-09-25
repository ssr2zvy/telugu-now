import type { ChangeEvent } from 'react';
import { Check } from 'lucide-react';
import type { SettingsDraft, UiLanguage } from '../types';
import { t } from '../language';

interface QuestionsPageProps {
  grammarActive?: boolean;
  language: UiLanguage;
  draft: SettingsDraft;
  saving: boolean;
  error: boolean;
  onDraftChange: (draft: SettingsDraft) => void;
  onClearError: () => void;
  onSave: () => void;
}

interface ProbabilityFieldProps {
  label: string;
  complementLabel: string;
  value: string;
  onChange: (value: string) => void;
}

function ProbabilityField({ label, complementLabel, value, onChange }: ProbabilityFieldProps) {
  const probability = Number(value);
  const complement = Number.isFinite(probability) ? Math.max(0, 100 - probability) : 0;
  return <label className="question-probability-field">
    <span>
      <span>{label}</span>
      <small>{value || '0'}% / {complement}% {complementLabel}</small>
    </span>
    <div className="field-value">
      <input
        type="number"
        inputMode="decimal"
        min="0"
        max="100"
        step="1"
        value={value}
        aria-label={label}
        onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value)}
      />
      <span className="field-unit" aria-hidden="true">%</span>
    </div>
  </label>;
}

export function QuestionsPage({ grammarActive, language, draft, saving, error, onDraftChange, onClearError, onSave }: QuestionsPageProps) {
  const update = (key: 'questionPercent' | 'seenQuestionPercent' | 'audioGivenQuestionPercent') => (value: string) => {
    onClearError();
    onDraftChange({ ...draft, [key]: value });
  };
  return <div className="settings-form question-probability-form">
    {!grammarActive && <><ProbabilityField
      label={language === 'en' ? 'Questions' : 'ప్రశ్నలు'}
      complementLabel={language === 'en' ? 'Normal' : 'సాధారణ'}
      value={draft.questionPercent ?? '30'}
      onChange={update('questionPercent')}
    />
    <ProbabilityField
      label={language === 'en' ? 'Previously Seen' : 'ఇంతకు ముందు చూసినవి'}
      complementLabel={language === 'en' ? 'Not Seen' : 'చూడనివి'}
      value={draft.seenQuestionPercent ?? '75'}
      onChange={update('seenQuestionPercent')}
    /></>}
    <ProbabilityField
      label={language === 'en' ? 'Audio Given' : 'ఆడియో ఇవ్వబడింది'}
      complementLabel={language === 'en' ? 'Text Given' : 'టెక్స్ట్ ఇవ్వబడింది'}
      value={draft.audioGivenQuestionPercent ?? '60'}
      onChange={update('audioGivenQuestionPercent')}
    />
    {error ? <div className="settings-error">{t(language, 'invalidValues')}</div> : null}
    <button className="primary-action" type="button" disabled={saving} onClick={onSave}>
      <Check aria-hidden="true" />
      {saving ? t(language, 'saving') : t(language, 'save')}
    </button>
  </div>;
}
