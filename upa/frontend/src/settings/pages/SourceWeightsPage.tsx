import type {
  ChangeEvent,
} from 'react';
import { Check } from 'lucide-react';
import {
  t,
} from '../language';
import {
  sourceDisplayName,
} from '../settings-utils';
import type {
  SettingsDraft,
  UiLanguage,
} from '../types';
interface SourceWeightsPageProps {
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
export function SourceWeightsPage({
  language,
  draft,
  saving,
  error,
  onDraftChange,
  onClearError,
  onSave,
}: SourceWeightsPageProps) {
  return (
    <div className="settings-form">
      {Object.keys(
        draft.sourceWeights,
      )
        .sort()
        .map((sourceId) => (
          <label key={sourceId}>
            <span>
              {sourceDisplayName(
                sourceId,
              )}
            </span>
            <input
              type="number"
              min="0"
              max="1"
              step="0.01"
              value={
                draft
                  .sourceWeights[
                  sourceId
                ] ?? ''
              }
              onChange={(
                event:
                  ChangeEvent<HTMLInputElement>,
              ) => {
                onClearError();
                onDraftChange({
                  ...draft,
                  sourceWeights: {
                    ...draft
                      .sourceWeights,
                    [sourceId]:
                      event
                        .target
                        .value,
                  },
                });
              }}
            />
          </label>
        ))}
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
