import { useEffect, useState } from 'react';
import type { DataSourceInfo } from '../../../../shared/contracts';
import { getDataSources } from '../../api';
import { t } from '../language';
import type { UiLanguage } from '../types';
import { CollapsibleSettingsSection } from '../CollapsibleSettingsSection';
function statusLabel(language: UiLanguage, status: DataSourceInfo['status']): string { return t(language, status === 'ready' ? 'sourceReady' : status === 'fixture' ? 'sourceFixture' : 'sourceInvalid'); }
export function DataSourcesPage({ language }: { language: UiLanguage }) {
  const [sources, setSources] = useState<DataSourceInfo[] | null>(null); const [failed, setFailed] = useState(false);
  useEffect(() => { let active = true; void getDataSources().then((r) => { if (!active) return; setSources(r.sources); setFailed(false); }).catch(() => { if (active) setFailed(true); }); return () => { active = false; }; }, []);
  if (failed) return <div className="diagnostic-empty">{t(language, 'unavailable')}</div>;
  if (!sources) return <div className="diagnostic-empty">...</div>;
  return <div className="data-source-list">{sources.map((source) => <CollapsibleSettingsSection className="data-source-card" ariaLabel={source.displayName} title={source.displayName} key={source.sourceId}><div className="diagnostic-table-wrap"><table className="diagnostic-table"><tbody><tr><th>{t(language, 'provider')}</th><td>{source.provider}</td></tr><tr><th>{t(language, 'license')}</th><td>{source.license}</td></tr><tr><th>{t(language, 'catalogVersion')}</th><td>{source.catalogVersion}</td></tr><tr><th>{t(language, 'acceptedRows')}</th><td>{source.acceptedRows}</td></tr><tr><th>{t(language, 'rejectedRows')}</th><td>{source.rejectedRows}</td></tr><tr><th>{t(language, 'sourceStatus')}</th><td>{statusLabel(language, source.status)}</td></tr>{source.upstreamUrl ? <tr><th>{t(language, 'sourceRepository')}</th><td><a href={source.upstreamUrl} target="_blank" rel="noreferrer">{source.upstreamUrl}</a></td></tr> : null}</tbody></table></div></CollapsibleSettingsSection>)}</div>;
}
