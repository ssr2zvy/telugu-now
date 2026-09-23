import { ChevronRight } from 'lucide-react';
import { settingsPageLabel } from '../navigation';
import type { SettingsPage, UiLanguage } from '../types';
export type ParserNavigate=(page:Exclude<SettingsPage,'index'>)=>void;
export function ParserLinks({pages,onNavigate,language='en'}:{pages:Exclude<SettingsPage,'index'>[];onNavigate:ParserNavigate;language?:UiLanguage}) {
  return <nav className="settings-index">{pages.map(page=>{return <button type="button" key={page} onClick={()=>onNavigate(page)}>
    <span className="settings-entry-label">{settingsPageLabel(page,language)}</span><ChevronRight className="settings-entry-chevron" aria-hidden="true"/>
  </button>;})}</nav>;
}
