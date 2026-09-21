import { useEffect, useState } from 'react';
import type { UiLanguage } from '../types';

interface AboutPageProps {
  language: UiLanguage;
}

interface VersionMetadata {
  version?: string;
  deployedAt?: string;
}

export function AboutPage({ language }: AboutPageProps) {
  const [metadata, setMetadata] = useState<VersionMetadata | null>(null);

  useEffect(() => {
    let active = true;
    void fetch('/version.json')
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error('Version unavailable'))))
      .then((value: VersionMetadata) => {
        if (active) setMetadata(value);
      })
      .catch(() => {
        if (active) setMetadata({});
      });
    return () => {
      active = false;
    };
  }, []);

  const unavailable = language === 'en' ? 'Unavailable' : 'అందుబాటులో లేదు';
  const deployedAt = metadata?.deployedAt ? new Date(metadata.deployedAt) : null;
  const deployedLabel = deployedAt && !Number.isNaN(deployedAt.getTime())
    ? new Intl.DateTimeFormat(language === 'en' ? 'en' : 'te', { dateStyle: 'long', timeStyle: 'short' }).format(deployedAt)
    : unavailable;

  return (
    <div className="settings-info-page">
      <dl className="settings-info-list">
        <div>
          <dt>{language === 'en' ? 'Application' : 'అప్లికేషన్'}</dt>
          <dd>Telugu Now</dd>
        </div>
        <div>
          <dt>{language === 'en' ? 'Version' : 'వెర్షన్'}</dt>
          <dd>{metadata === null ? '…' : metadata.version ?? unavailable}</dd>
        </div>
        <div>
          <dt>{language === 'en' ? 'Deployed' : 'డిప్లాయ్ చేసిన సమయం'}</dt>
          <dd>{metadata === null ? '…' : deployedLabel}</dd>
        </div>
      </dl>
    </div>
  );
}
