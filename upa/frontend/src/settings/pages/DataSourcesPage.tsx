import { useEffect, useState } from 'react';
import type { DataSourceInfo } from '../../../../shared/contracts';
import { getDataSources } from '../../api';
import { t } from '../language';
import type { UiLanguage } from '../types';
function statusLabel(language: UiLanguage, status: DataSourceInfo['status']): string { return t(language, status === 'ready' ? 'sourceReady' : status === 'fixture' ? 'sourceFixture' : 'sourceInvalid'); }
export function DataSourcesPage({ language }: { language: UiLanguage }) {
  const [sources, setSources] = useState<DataSourceInfo[] | null>(null); const [failed, setFailed] = useState(false);
  useEffect(() => { let active = true; void getDataSources().then((r) => { if (!active) return; setSources(r.sources); setFailed(false); }).catch(() => { if (active) setFailed(true); }); return () => { active = false; }; }, []);
  if (failed) return <div className="diagnostic-empty">{t(language, 'unavailable')}</div>;
  if (!sources) return <div className="diagnostic-empty">...</div>;
  return <div className="data-source-list">{sources.map((source) => <section className="data-source-card" key={source.sourceId}><h2>{source.displayName}</h2><dl><dt>{t(language, 'provider')}</dt><dd>{source.provider}</dd><dt>{t(language, 'license')}</dt><dd>{source.license}</dd><dt>{t(language, 'catalogVersion')}</dt><dd>{source.catalogVersion}</dd><dt>{t(language, 'acceptedRows')}</dt><dd>{source.acceptedRows}</dd><dt>{t(language, 'rejectedRows')}</dt><dd>{source.rejectedRows}</dd><dt>{t(language, 'complexityMetric')}</dt><dd>{source.complexityMetric}</dd><dt>{t(language, 'sourceStatus')}</dt><dd>{statusLabel(language, source.status)}</dd></dl>{source.upstreamUrl ? <a href={source.upstreamUrl} target="_blank" rel="noreferrer">{t(language, 'sourceRepository')}</a> : null}</section>)}</div>;
}
