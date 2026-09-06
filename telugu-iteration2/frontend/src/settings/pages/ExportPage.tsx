import type { ChangeEvent, MouseEvent } from 'react';
import {
  downloadPreparedExportArtifact,
  type ExportFormat,
  type PreparedExportArtifact,
} from '../../export-artifact';
import { t } from '../language';
import type { UiLanguage } from '../types';
interface ExportPageProps {
  language: UiLanguage;
  count: string;
  exporting: boolean;
  error: boolean;
  formatChooserOpen: boolean;
  preparedArtifact: PreparedExportArtifact | null;
  onCountChange: (count: string) => void;
  onRequestExport: () => void;
  onCancelFormatChoice: () => void;
  onChooseFormat: (format: ExportFormat) => void;
}
export function ExportPage({
  language,
  count,
  exporting,
  error,
  formatChooserOpen,
  preparedArtifact,
  onCountChange,
  onRequestExport,
  onCancelFormatChoice,
  onChooseFormat,
}: ExportPageProps) {
  const preparedFormatLabel =
    preparedArtifact?.format === 'epub'
      ? t(language, 'epub')
      : t(language, 'html');
  return (
    <div className="export-page">
      <input
        type="number"
        min="1"
        step="1"
        inputMode="numeric"
        aria-label={t(language, 'count')}
        placeholder={t(language, 'count')}
        value={count}
        disabled={exporting}
        onChange={(event: ChangeEvent<HTMLInputElement>) =>
          onCountChange(event.target.value)
        }
      />
      <button
        className="primary-action"
        type="button"
        disabled={exporting}
        onClick={onRequestExport}
      >
        {exporting
          ? t(language, 'exporting')
          : t(language, 'export')}
      </button>
      <button
        className="secondary-action"
        type="button"
        disabled={exporting || preparedArtifact === null}
        onClick={() => {
          if (preparedArtifact) {
            downloadPreparedExportArtifact(preparedArtifact);
          }
        }}
      >
        {t(language, 'download')}
      </button>
      {preparedArtifact ? (
        <div className="export-ready" role="status">
          {t(language, 'ready')}: {preparedArtifact.entryCount} · {preparedFormatLabel}
        </div>
      ) : null}
      {error ? (
        <div className="settings-error">
          {t(language, 'invalidExport')}
        </div>
      ) : null}
      {formatChooserOpen ? (
        <div
          className="export-format-backdrop"
          role="presentation"
          onClick={onCancelFormatChoice}
        >
          <section
            className="export-format-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="export-format-title"
            onClick={(event: MouseEvent<HTMLElement>) => event.stopPropagation()}
          >
            <h2 id="export-format-title">
              {t(language, 'chooseExportFormat')}
            </h2>
            <button
              className="export-format-option"
              type="button"
              onClick={() => onChooseFormat('epub')}
            >
              <strong>{t(language, 'epub')}</strong>
              <span>{t(language, 'epubDescription')}</span>
            </button>
            <button
              className="export-format-option"
              type="button"
              onClick={() => onChooseFormat('html')}
            >
              <strong>{t(language, 'html')}</strong>
              <span>{t(language, 'htmlDescription')}</span>
            </button>
            <button
              className="export-format-cancel"
              type="button"
              onClick={onCancelFormatChoice}
            >
              {t(language, 'cancel')}
            </button>
          </section>
        </div>
      ) : null}
    </div>
  );
}
