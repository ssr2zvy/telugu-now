import type {
  ChangeEvent,
} from 'react';
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
        <input
          type="number"
          min="0"
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
      </label>
      <label>
        <span>
          {t(
            language,
            'spread',
          )}
        </span>
        <input
          type="number"
          min="0.000001"
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
