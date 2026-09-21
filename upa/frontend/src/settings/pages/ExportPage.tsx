import { useEffect, useRef, type ChangeEvent } from 'react';
import { Archive, BookOpen, Download, FileCode2, FileDown } from 'lucide-react';
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
  phase: 'selecting' | 'packaging';
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
  phase,
  error,
  formatChooserOpen,
  preparedArtifact,
  onCountChange,
  onRequestExport,
  onCancelFormatChoice,
  onChooseFormat,
}: ExportPageProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!formatChooserOpen || !dialog) return;
    dialog.showModal();
    return () => dialog.close();
  }, [formatChooserOpen]);
  const progressLabel = phase === 'selecting'
    ? (language === 'en' ? 'Selecting observations' : 'పరిశీలనలను ఎంచుకుంటోంది')
    : (language === 'en' ? 'Preparing file' : 'ఫైల్ సిద్ధం చేస్తోంది');
  const preparedFormatLabel = preparedArtifact?.format === 'epub'
    ? t(language, 'epub')
    : preparedArtifact?.format === 'app-archive'
      ? t(language, 'appArchive')
      : t(language, 'html');
  return (
    <div className="export-page">
      <label className="export-count">
      <span>{t(language, 'count')}</span>
      <input
        type="number"
        min="1"
        max="500"
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
      </label>
      <div className="export-actions">
      <button
        className="primary-action"
        type="button"
        disabled={exporting}
        onClick={onRequestExport}
      >
        <FileDown aria-hidden="true" />
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
        <Download aria-hidden="true" />
        {t(language, 'download')}
      </button>
      </div>
      {exporting && (
        <div className="export-status" role="status">
          <span>{progressLabel}</span>
          <div className="export-progress" role="progressbar" aria-label={progressLabel}><span /></div>
        </div>
      )}
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
          <dialog
            ref={dialogRef}
            className="export-format-modal"
            aria-labelledby="export-format-title"
            onCancel={(event) => { event.preventDefault(); onCancelFormatChoice(); }}
            onClick={(event) => {
              const bounds = event.currentTarget.getBoundingClientRect();
              if (event.target === event.currentTarget && (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom)) onCancelFormatChoice();
            }}
          >
            <h2 id="export-format-title">
              {t(language, 'chooseExportFormat')}
            </h2>
            <button
              className="export-format-option"
              type="button"
              onClick={() => onChooseFormat('epub')}
            >
              <BookOpen aria-hidden="true" />
              <span><strong>{t(language, 'epub')}</strong><small>{t(language, 'epubDescription')}</small></span>
            </button>
            <button
              className="export-format-option"
              type="button"
              onClick={() => onChooseFormat('html')}
            >
              <FileCode2 aria-hidden="true" />
              <span><strong>{t(language, 'html')}</strong><small>{t(language, 'htmlDescription')}</small></span>
            </button>
            <button
              className="export-format-option"
              type="button"
              onClick={() => onChooseFormat('app-archive')}
            >
              <Archive aria-hidden="true" />
              <span><strong>{t(language, 'appArchive')}</strong><small>{t(language, 'appArchiveDescription')}</small></span>
            </button>
            <button
              className="export-format-cancel"
              type="button"
              onClick={onCancelFormatChoice}
            >
              {t(language, 'cancel')}
            </button>
          </dialog>
    </div>
  );
}
