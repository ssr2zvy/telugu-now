import { useEffect, useState } from 'react';
import type { DataSourceInfo } from '../../../../shared/contracts';
import { getDataSources } from '../../api';
import { t } from '../language';
import type { UiLanguage } from '../types';

export function DataSourcesPage({ language }: { language: UiLanguage }) {
  const [sources, setSources] = useState<DataSourceInfo[] | null>(null);

  useEffect(() => {
    let active = true;
    void getDataSources().then((response) => {
      if (active) setSources(response.sources);
    });
    return () => {
      active = false;
    };
  }, []);

  if (!sources) {
    return <div className="diagnostic-empty">...</div>;
  }

  return (
    <div className="data-source-list">
      {sources.map((source) => (
        <section className="data-source-card" key={source.sourceId}>
          <h2>{source.displayName}</h2>
          <dl>
            <dt>{t(language, 'provider')}</dt>
            <dd>{source.provider}</dd>
            <dt>{t(language, 'license')}</dt>
            <dd>{source.license}</dd>
            <dt>{t(language, 'catalogVersion')}</dt>
            <dd>{source.catalogVersion}</dd>
            <dt>{t(language, 'acceptedRows')}</dt>
            <dd>{source.acceptedRows}</dd>
            <dt>{t(language, 'rejectedRows')}</dt>
            <dd>{source.rejectedRows}</dd>
            <dt>{t(language, 'complexityMetric')}</dt>
            <dd>{source.complexityMetric}</dd>
            <dt>{t(language, 'sourceStatus')}</dt>
            <dd>{source.status === 'ready' ? t(language, 'sourceReady') : t(language, 'sourceFixture')}</dd>
          </dl>
          {source.upstreamUrl ? (
            <a href={source.upstreamUrl} target="_blank" rel="noreferrer">
              {t(language, 'sourceRepository')}
            </a>
          ) : null}
        </section>
      ))}
    </div>
  );
}
