import {
  t,
} from '../language';
import type {
  SettingsPage,
  UiLanguage,
} from '../types';
import { visibleSettingsEntries, settingsPageLabel } from '../navigation';
import { ChevronRight } from 'lucide-react';
import type { ProfileStateResponse } from '../../../../shared/contracts';
import { useAppearance } from '../../appearance';
interface SettingsIndexProps {
  language: UiLanguage;
  state: ProfileStateResponse;
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
  state,
  page: currentPage,
  resetting,
  resetError,
  onNavigate,
  onResetQueue,
}: SettingsIndexProps) {
  const entries = visibleSettingsEntries(currentPage, state.grammarMigrationAvailable ?? false);
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
          (page) => {
            return (
            <button
              key={page}
              type="button"
              onClick={() =>
                onNavigate(page as Exclude<SettingsPage, 'index'>)
              }
            >
              <span className="settings-entry-text">
                <span className="settings-entry-label">{settingsPageLabel(page, language)}</span>

              </span>
              <ChevronRight className="settings-entry-chevron" aria-hidden="true" />
            </button>
            );
          },
        )}
      </nav>
      {currentPage === 'reset' && <div className="settings-reset-queue">
        <p className="settings-reset-queue-description">
          {state.grammarActive
            ? (language === 'en' ? 'Retry preparation of the current question batch.' : 'ప్రస్తుత ప్రశ్నల సమూహాన్ని మళ్లీ సిద్ధం చేయండి.')
            : t(language, 'resetQueueDescription')}
        </p>
        <p className="settings-reset-queue-description">
          {state.grammarActive ? (language === 'en' ? 'Your selected targets, answers, progress and history stay unchanged. This does not draw a new batch.' : 'ఎంచుకున్న లక్ష్యాలు, సమాధానాలు, పురోగతి మరియు చరిత్ర మారవు. కొత్త సమూహాన్ని ఎంచుకోదు.') : language === 'en' ? 'Your current observation and history stay unchanged. Unseen observations are replaced using your current sampling settings.' : 'ప్రస్తుత పరిశీలన మరియు చరిత్ర మారవు. చూడని పరిశీలనలు ప్రస్తుత ఎంపిక సెట్టింగులతో భర్తీ అవుతాయి.'}
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
