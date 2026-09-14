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
  const rows = (source: DataSourceInfo): Array<[string, string | number]> => [
    [t(language, 'provider'), source.provider],
    [t(language, 'license'), source.license],
    [t(language, 'catalogVersion'), source.catalogVersion],
    [t(language, 'acceptedRows'), source.acceptedRows],
    [t(language, 'rejectedRows'), source.rejectedRows],
    [t(language, 'complexityMetric'), source.complexityMetric],
    [t(language, 'sourceStatus'), statusLabel(language, source.status)],
  ];
  return (
    <div className="diagnostic-sections">
      {sources.map((source) => (
        <div className="diagnostic-section" key={source.sourceId}>
          <h3 className="diagnostic-section-title data-source-title">{source.displayName}</h3>
          <div className="diagnostic-table-wrap">
            <table className="diagnostic-table">
              <tbody>
                {rows(source).map(([label, value]) => (
                  <tr key={label}>
                    <th scope="row">{label}</th>
                    <td>{value}</td>
                  </tr>
                ))}
                {source.upstreamUrl ? (
                  <tr>
                    <th scope="row">{t(language, 'sourceRepository')}</th>
                    <td><a href={source.upstreamUrl} target="_blank" rel="noreferrer">{source.upstreamUrl}</a></td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}
