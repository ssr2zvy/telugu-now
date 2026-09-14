import type {
  ChangeEvent,
} from 'react';
import { Check } from 'lucide-react';
import {
  t,
} from '../language';
import type {
  SettingsDraft,
  UiLanguage,
} from '../types';
interface ComplexityPageProps {
  language: UiLanguage;
  draft: SettingsDraft;
  saving: boolean;
  error: boolean;
  onDraftChange:
    (
      draft:
        SettingsDraft,
    ) => void;
  onClearError:
    () => void;
  onSave:
    () => void;
}
export function ComplexityPage({
  language,
  draft,
  saving,
  error,
  onDraftChange,
  onClearError,
  onSave,
}: ComplexityPageProps) {
  return (
    <div className="settings-form">
      <label>
        <span>
          {t(
            language,
            'target',
          )}
        </span>
        <div className="field-value">
          <input
          type="number"
          inputMode="decimal"
          min="0"
          aria-label={t(language, 'target')}
          aria-description={language === 'en' ? 'Percent' : 'శాతం'}
          max="100"
          step="0.1"
          value={
            draft.targetPercent
          }
          onChange={(
            event:
              ChangeEvent<HTMLInputElement>,
          ) => {
            onClearError();
            onDraftChange({
              ...draft,
              targetPercent:
                event.target.value,
            });
          }}
          />
          <span className="field-unit" aria-hidden="true">%</span>
        </div>
      </label>
      <label>
        <span>
          {t(
            language,
            'spread',
          )}
        </span>
        <div className="field-value">
          <input
          type="number"
          inputMode="decimal"
          min="0.000001"
          aria-label={t(language, 'spread')}
          aria-description={language === 'en' ? 'Percent' : 'శాతం'}
          step="0.1"
          value={
            draft.spreadPercent
          }
          onChange={(
            event:
              ChangeEvent<HTMLInputElement>,
          ) => {
            onClearError();
            onDraftChange({
              ...draft,
              spreadPercent:
                event.target.value,
            });
          }}
          />
          <span className="field-unit" aria-hidden="true">%</span>
        </div>
      </label>
      {error ? (
        <div className="settings-error">
          {t(
            language,
            'invalidValues',
          )}
        </div>
      ) : null}
      <button
        className="primary-action"
        type="button"
        disabled={saving}
        onClick={onSave}
      >
        <Check aria-hidden="true" />
        {saving
          ? t(
              language,
              'saving',
            )
          : t(
              language,
              'save',
            )}
      </button>
    </div>
  );
}
