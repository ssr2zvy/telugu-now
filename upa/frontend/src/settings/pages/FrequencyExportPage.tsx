import { useEffect, useState, type ChangeEvent } from 'react';
import { Download } from 'lucide-react';
import { downloadFrequencyExport, getFrequencyExportAvailability } from '../../api';
import { downloadPreparedExportArtifact } from '../../export-artifact';
import type { UiLanguage } from '../types';

export function FrequencyExportPage({ language }: { language: UiLanguage }) {
  const [available, setAvailable] = useState<number | null>(null);
  const [occurrenceLimit, setOccurrenceLimit] = useState('');
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void getFrequencyExportAvailability(controller.signal)
      .then(result => setAvailable(result.availableAcceptedOccurrences))
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, []);

  const exportArchive = async () => {
    const occurrences = Number(occurrenceLimit);
    if (!Number.isSafeInteger(occurrences) || occurrences <= 0) {
      setError(true);
      return;
    }
    setExporting(true);
    setError(false);
    try {
      const artifact = await downloadFrequencyExport({
        occurrenceLimit: occurrences,
      });
      downloadPreparedExportArtifact({
        format: 'frequency-zip',
        blob: artifact.blob,
        fileName: artifact.fileName,
        entryCount: Math.min(occurrences, available ?? occurrences),
      });
    } catch {
      setError(true);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="frequency-export-page">
      <p>
        {language === 'en'
          ? 'Randomly sample normalized Telugu surface words from the corpus. The ZIP includes the complete frequency list for that sample, occurrences, transcripts, sources, and metadata.'
          : 'కార్పస్ నుండి సాధారణీకరించిన తెలుగు పద రూపాలను యాదృచ్ఛికంగా నమూనా చేయండి. ZIPలో ఆ నమూనా కోసం పూర్తి పౌనఃపున్య జాబితా, సందర్భాలు, ట్రాన్స్‌క్రిప్ట్‌లు, మూలాలు మరియు మెటాడేటా ఉంటాయి.'}
      </p>
      <label className="frequency-export-field">
        <span>{language === 'en' ? 'Accepted occurrences to process' : 'ప్రాసెస్ చేయాల్సిన ఆమోదించిన సందర్భాలు'}</span>
        <span className="frequency-export-input">
          <input
            type="number"
            min="1"
            step="1"
            inputMode="numeric"
            value={occurrenceLimit}
            disabled={exporting}
            onChange={(event: ChangeEvent<HTMLInputElement>) => setOccurrenceLimit(event.target.value)}
          />
          <button
            type="button"
            className="secondary-action"
            disabled={exporting || available === null || available === 0}
            onClick={() => setOccurrenceLimit(String(available))}
          >
            {language === 'en' ? 'All' : 'అన్నీ'}
          </button>
        </span>
      </label>
      <small className="frequency-export-available">
        {available === null
          ? (language === 'en' ? 'Counting available occurrences…' : 'అందుబాటులో ఉన్న సందర్భాలను లెక్కిస్తోంది…')
          : `${available.toLocaleString(language)} ${language === 'en' ? 'available accepted occurrences' : 'ఆమోదించిన సందర్భాలు అందుబాటులో ఉన్నాయి'}`}
      </small>
      <button className="primary-action" type="button" disabled={exporting || available === null} onClick={() => void exportArchive()}>
        <Download aria-hidden="true" />
        {exporting
          ? (language === 'en' ? 'Preparing ZIP…' : 'ZIP సిద్ధం చేస్తోంది…')
          : (language === 'en' ? 'Download ZIP' : 'ZIP డౌన్‌లోడ్ చేయండి')}
      </button>
      {error && <div className="settings-error">{language === 'en' ? 'Enter valid positive limits and try again.' : 'చెల్లుబాటు అయ్యే ధన పూర్ణాంకాలను నమోదు చేసి మళ్లీ ప్రయత్నించండి.'}</div>}
    </div>
  );
}
