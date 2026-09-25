import type { ChangeEvent } from 'react';
import { Download, FileDown } from 'lucide-react';
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
  format: ExportFormat;
  preparedArtifact: PreparedExportArtifact | null;
  onCountChange: (count: string) => void;
  onRequestExport: () => void;
}
export function ExportPage({
  language,
  count,
  exporting,
  phase,
  error,
  format,
  preparedArtifact,
  onCountChange,
  onRequestExport,
}: ExportPageProps) {
  const progressLabel = phase === 'selecting'
    ? (language === 'en' ? 'Selecting observations' : 'పరిశీలనలను ఎంచుకుంటోంది')
    : (language === 'en' ? 'Preparing file' : 'ఫైల్ సిద్ధం చేస్తోంది');
  const preparedFormatLabel = format === 'epub'
    ? t(language, 'epub')
    : format === 'app-archive'
      ? t(language, 'appArchive')
      : t(language, 'html');
  return (
    <div className="export-page">
      <p>{format === 'epub' ? t(language, 'epubDescription') : format === 'html' ? t(language, 'htmlDescription') : t(language, 'appArchiveDescription')}</p>
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
    </div>
  );
}
