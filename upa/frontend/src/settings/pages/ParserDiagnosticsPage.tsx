import type { DisplayObservation } from '../../../../shared/contracts';
import type { SettingsPage, UiLanguage } from '../types';
import { ParsingDiagnostics } from './ParsingDiagnostics';
import { SelectedWordMatch } from './SelectedWordMatch';
import { ParserSection } from './ParserSection';
import { settingsPageIcons, settingsPageLabel } from '../navigation';
import { ChevronRight } from 'lucide-react';
export function ParserDiagnosticsPage({profileCode,observation,language,onDownload,onNavigate}:{profileCode:string;observation:DisplayObservation|null;language:UiLanguage;onDownload?:()=>void;onNavigate?:(page:Exclude<SettingsPage,'index'>)=>void}) {
  return <div className="parser-settings">
    <ParsingDiagnostics key={profileCode} profileCode={profileCode} {...(onDownload ? {onDownload} : {})}/>
    <ParserSection title="Selection details"><SelectedWordMatch observation={observation}/></ParserSection>
    {onNavigate ? <nav className="settings-index" aria-label="Diagnostic tools">{(['queue','dataSources','blacklist','reset'] as const).map(page => {
      const Icon = settingsPageIcons[page];
      return <button key={page} type="button" onClick={() => onNavigate(page)}><Icon className="settings-entry-icon" aria-hidden="true"/><span className="settings-entry-label">{settingsPageLabel(page,language)}</span><ChevronRight className="settings-entry-chevron" aria-hidden="true"/></button>;
    })}</nav> : null}
  </div>;
}
