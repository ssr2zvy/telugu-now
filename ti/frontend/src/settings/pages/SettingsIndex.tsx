import {
  t,
} from '../language';
import type {
  SettingsPage,
  UiLanguage,
} from '../types';
interface SettingsIndexProps {
  language: UiLanguage;
  onNavigate:
    (
      page:
        Exclude<
          SettingsPage,
          'index'
        >,
    ) => void;
}
export function SettingsIndex({
  language,
  onNavigate,
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
  );
}
