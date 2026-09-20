import {
  t,
} from '../language';
import type {
  SettingsPage,
  UiLanguage,
} from '../types';
import { settingsGroups, settingsPageIcons, settingsPageLabel } from '../navigation';
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
  const { appearance } = useAppearance();
  const entries = settingsGroups[currentPage] ?? [];
  const percent = new Intl.NumberFormat(language, { style: 'percent', maximumFractionDigits: 1 });
  const summaries: Partial<Record<SettingsPage, string>> = currentPage === 'index' ? {
    sampling: `${t(language, 'target')} ${percent.format(state.selectionSettings.complexityPercentileTarget)} · ${t(language, 'spread')} ${percent.format(state.selectionSettings.complexityPercentileSpread)}`,
    diagnostic: state.currentObservation
      ? `${language === 'en' ? 'Acquisition' : 'సేకరణ'} ${state.currentObservation.diagnostic.acquisitionNumber}`
      : t(language, 'unavailable'),
    display: `${state.audioSettings.playbackRate}x · ${appearance.fonts.length} ${language === 'en' ? 'fonts' : 'ఫాంట్లు'}`,
    eons: language === 'en' ? 'Named periods of use' : 'పేరు పెట్టిన వినియోగ కాలాలు',
    export: 'EPUB / HTML',
    frequencyExport: language === 'en' ? 'Surface-word frequencies and occurrence mapping' : 'పద పౌనఃపున్యాలు మరియు సందర్భాల వివరాలు',
    import: language === 'en' ? 'Restore an app archive' : 'యాప్ ఆర్కైవ్‌ను పునరుద్ధరించండి',
    controlsGuide: language === 'en' ? 'Reading, questions, audio, and navigation' : 'చదవడం, ప్రశ్నలు, ఆడియో మరియు నావిగేషన్',
    about: language === 'en' ? 'Build and deployment information' : 'బిల్డ్ మరియు అమలు సమాచారం',
    reset: `${state.queue.unseenCount} ${language === 'en' ? 'queued' : 'వరుసలో'}`,
  } : {};
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
            const Icon = settingsPageIcons[page];
            return (
            <button
              key={page}
              type="button"
              onClick={() =>
                onNavigate(page as Exclude<SettingsPage, 'index'>)
              }
            >
              <Icon className="settings-entry-icon" aria-hidden="true" />
              <span className="settings-entry-text">
                <span className="settings-entry-label">{settingsPageLabel(page, language)}</span>
                {summaries[page] && <span className="settings-entry-meta">
                  {page === 'display' && <span className="settings-palette-preview" aria-hidden="true" />}
                  <span>{summaries[page]}</span>
                </span>}
              </span>
              <ChevronRight className="settings-entry-chevron" aria-hidden="true" />
            </button>
            );
          },
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
