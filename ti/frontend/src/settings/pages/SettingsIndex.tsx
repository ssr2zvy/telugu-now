import {
  t,
} from '../language';
import type {
  SettingsPage,
  UiLanguage,
} from '../types';
interface SettingsIndexProps {
  language: UiLanguage;
  resetting: boolean;
  resetError: boolean;
  onNavigate:
    (
      page:
        Exclude<
          SettingsPage,
          'index'
        >,
    ) => void;
  onResetQueue: () => void;
}
export function SettingsIndex({
  language,
  resetting,
  resetError,
  onNavigate,
  onResetQueue,
}: SettingsIndexProps) {
  const entries:
    Array<{
      page:
        Exclude<
          SettingsPage,
          'index'
        >;
      label:
        | 'complexity'
        | 'sourceWeights'
        | 'diagnostic'
        | 'export'
        | 'dataSources';
    }> = [
      {
        page: 'complexity',
        label: 'complexity',
      },
      {
        page: 'sources',
        label: 'sourceWeights',
      },
      {
        page: 'dataSources',
        label: 'dataSources',
      },
      {
        page: 'diagnostic',
        label: 'diagnostic',
      },
      {
        page: 'export',
        label: 'export',
      },
    ];
  return (
    <div className="settings-index-page">
      <nav
        className="settings-index"
        aria-label={
          t(
            language,
            'settings',
          )
        }
      >
        {entries.map(
          ({
            page,
            label,
          }) => (
            <button
              key={page}
              type="button"
              onClick={() =>
                onNavigate(page)
              }
            >
              <span>
                {t(
                  language,
                  label,
                )}
              </span>
              <span aria-hidden="true">
                ›
              </span>
            </button>
          ),
        )}
      </nav>
      <div className="settings-reset-queue">
        <p className="settings-reset-queue-description">
          {t(
            language,
            'resetQueueDescription',
          )}
        </p>
        <button
          className="secondary-action"
          type="button"
          disabled={resetting}
          onClick={onResetQueue}
        >
          {resetting
            ? t(
                language,
                'resettingQueue',
              )
            : t(
                language,
                'resetQueue',
              )}
        </button>
        {resetError ? (
          <div className="settings-error">
            {t(
              language,
              'resetQueueError',
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
