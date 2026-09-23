import { useEffect, useState } from 'react';
import { ChevronRight, Database } from 'lucide-react';
import type { DataSourceInfo } from '../../../../shared/contracts';
import { getDataSources } from '../../api';
import { t } from '../language';
import type { UiLanguage } from '../types';
export function DataSourcesPage({language,onSelect}:{language:UiLanguage;onSelect:(source:DataSourceInfo)=>void}) {
  const [sources,setSources]=useState<DataSourceInfo[]|null>(null),[failed,setFailed]=useState(false);
  useEffect(()=>{let active=true;void getDataSources().then(result=>{if(active)setSources(result.sources);}).catch(()=>{if(active)setFailed(true);});return()=>{active=false;};},[]);
  if(failed)return <p role="alert">{t(language,'unavailable')}</p>;
  if(!sources)return <p role="status">…</p>;
  return <nav className="settings-index">{sources.map(source=><button type="button" key={source.sourceId} onClick={()=>onSelect(source)}><Database className="settings-entry-icon" aria-hidden="true"/><span>{source.displayName}</span><ChevronRight className="settings-entry-chevron" aria-hidden="true"/></button>)}</nav>;
}
export function DataSourceDetailPage({language,source}:{language:UiLanguage;source:DataSourceInfo|null}) {
  if(!source)return <p>{t(language,'unavailable')}</p>;
  return <div className="diagnostic-table-wrap"><table className="diagnostic-table"><tbody>
    <tr><th>{t(language,'provider')}</th><td>{source.provider}</td></tr>
    <tr><th>{t(language,'license')}</th><td>{source.license}</td></tr>
    <tr><th>{t(language,'catalogVersion')}</th><td>{source.catalogVersion}</td></tr>
    <tr><th>{t(language,'acceptedRows')}</th><td>{source.acceptedRows}</td></tr>
    <tr><th>{t(language,'rejectedRows')}</th><td>{source.rejectedRows}</td></tr>
    <tr><th>{t(language,'sourceStatus')}</th><td>{t(language,source.status==='ready'?'sourceReady':source.status==='fixture'?'sourceFixture':'sourceInvalid')}</td></tr>
    {source.upstreamUrl?<tr><th>{t(language,'sourceRepository')}</th><td><a href={source.upstreamUrl} target="_blank" rel="noreferrer">{source.upstreamUrl}</a></td></tr>:null}
  </tbody></table></div>;
}
