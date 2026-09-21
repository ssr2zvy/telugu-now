import { useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import { importAppArchive } from '../../app-archive';
import { t } from '../language';
import type { UiLanguage } from '../types';

interface ImportPageProps {
  language: UiLanguage;
}

export function ImportPage({ language }: ImportPageProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<'idle' | 'saved' | 'error'>('idle');

  return (
    <div className="import-page">
      <p>
        {language === 'en'
          ? 'Restore observations and audio from a Telugu Now app archive.'
          : 'తెలుగు నౌ యాప్ ఆర్కైవ్ నుండి పరిశీలనలు మరియు ఆడియోను పునరుద్ధరించండి.'}
      </p>
      <input
        ref={inputRef}
        className="visually-hidden"
        type="file"
        accept=".json,.telugu-now-app.json,application/json"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (!file) return;
          setStatus('idle');
          void importAppArchive(file)
            .then(() => setStatus('saved'))
            .catch(() => setStatus('error'));
        }}
      />
      <button className="secondary-action import-file-action" type="button" onClick={() => inputRef.current?.click()}>
        <Upload aria-hidden="true" />
        {language === 'en' ? 'Choose archive file' : 'ఆర్కైవ్ ఫైల్‌ను ఎంచుకోండి'}
      </button>
      {status !== 'idle' ? (
        <div className={status === 'saved' ? 'export-ready' : 'settings-error'} role="status">
          {t(language, status === 'saved' ? 'archiveImported' : 'invalidArchive')}
        </div>
      ) : null}
    </div>
  );
}
