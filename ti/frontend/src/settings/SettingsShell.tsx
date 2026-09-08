import type {
  ReactNode,
} from 'react';
import {
  LanguageIcon,
} from '../components/icons';
import {
  t,
} from './language';
import type {
  UiLanguage,
} from './types';
interface SettingsShellProps {
  language: UiLanguage;
  title: string;
  onBack?: () => void;
  onClose: () => void;
  onToggleLanguage: () => void;
  children: ReactNode;
}
export function SettingsShell({
  language,
  title,
  onBack,
  onClose,
  onToggleLanguage,
  children,
}: SettingsShellProps) {
  return (
    <main className="app-shell settings-screen">
      <header className="settings-header">
        <div className="settings-header-side">
          {onBack ? (
            <button
              className="settings-back"
              type="button"
              aria-label={
                t(
                  language,
                  'back',
                )
              }
              onClick={onBack}
            >
              ‹
            </button>
          ) : null}
        </div>
        <h1>{title}</h1>
        <div className="settings-header-side settings-header-side-right">
          <button
            className="settings-close"
            type="button"
            aria-label={
              t(
                language,
                'close',
              )
            }
            onClick={onClose}
          >
            ×
          </button>
        </div>
      </header>
      <div className="settings-page-content">
        {children}
      </div>
      <button
        className="language-toggle"
        type="button"
        aria-label={
          t(
            language,
            'language',
          )
        }
        onClick={
          onToggleLanguage
        }
      >
        <LanguageIcon />
      </button>
    </main>
  );
}
