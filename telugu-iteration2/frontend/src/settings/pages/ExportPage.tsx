import type {
  ChangeEvent,
} from 'react';
import type {
  ExportResponse,
} from '../../../../shared/contracts';
import {
  downloadExportHtml,
} from '../../export-html';
import {
  t,
} from '../language';
import type {
  UiLanguage,
} from '../types';
interface ExportPageProps {
  language: UiLanguage;
  count: string;
  exporting: boolean;
  error: boolean;
  preparedExport:
    ExportResponse | null;
  onCountChange:
    (count: string) => void;
  onExport:
    () => void;
}
export function ExportPage({
  language,
  count,
  exporting,
  error,
  preparedExport,
  onCountChange,
  onExport,
}: ExportPageProps) {
  return (
    <div className="export-page">
      <input
        type="number"
        min="1"
        step="1"
        inputMode="numeric"
        aria-label={
          t(
            language,
            'count',
          )
        }
        placeholder={
          t(
            language,
            'count',
          )
        }
        value={count}
        disabled={exporting}
        onChange={(
          event:
            ChangeEvent<HTMLInputElement>,
        ) =>
          onCountChange(
            event.target.value,
          )
        }
      />
      <button
        className="primary-action"
        type="button"
        disabled={exporting}
        onClick={onExport}
      >
        {exporting
          ? t(
              language,
              'exporting',
            )
          : t(
              language,
              'export',
            )}
      </button>
      <button
        className="secondary-action"
        type="button"
        disabled={
          exporting ||
          preparedExport === null
        }
        onClick={() => {
          if (preparedExport) {
            downloadExportHtml(
              preparedExport,
            );
          }
        }}
      >
        {t(
          language,
          'download',
        )}
      </button>
      {preparedExport ? (
        <div
          className="export-ready"
          role="status"
        >
          {t(
            language,
            'ready',
          )}
          :{' '}
          {
            preparedExport
              .entries.length
          }
        </div>
      ) : null}
      {error ? (
        <div className="settings-error">
          {t(
            language,
            'invalidExport',
          )}
        </div>
      ) : null}
    </div>
  );
}
