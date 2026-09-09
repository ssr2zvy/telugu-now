import {
  t,
} from '../language';
import type {
  SettingsPage,
  UiLanguage,
} from '../types';
import { settingsGroups, settingsPageLabel } from '../navigation';
import { ChevronRight } from 'lucide-react';
interface SettingsIndexProps {
  language: UiLanguage;
  page: SettingsPage;
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
  page: currentPage,
  resetting,
  resetError,
  onNavigate,
  onResetQueue,
}: SettingsIndexProps) {
  const entries = settingsGroups[currentPage] ?? [];
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
          (page) => (
            <button
              key={page}
              type="button"
              onClick={() =>
                onNavigate(page as Exclude<SettingsPage, 'index'>)
              }
            >
              <span>
                {settingsPageLabel(page, language)}
              </span>
              <ChevronRight aria-hidden="true" />
            </button>
          ),
        )}
      </nav>
      {currentPage === 'reset' && <div className="settings-reset-queue">
        <p className="settings-reset-queue-description">
          {t(
            language,
            'resetQueueDescription',
          )}
        </p>
        <p className="settings-reset-queue-description">
          {language === 'en' ? 'Your current observation and history stay unchanged. Unseen observations are replaced using your current sampling settings.' : 'ప్రస్తుత పరిశీలన మరియు చరిత్ర మారవు. చూడని పరిశీలనలు ప్రస్తుత ఎంపిక సెట్టింగులతో భర్తీ అవుతాయి.'}
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
      </div>}
    </div>
  );
}
