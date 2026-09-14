import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, PanelLeftClose, PanelLeftOpen, X } from 'lucide-react';
import { parentSettingsPage, settingsGroups, settingsPageIcons, settingsPageLabel } from './navigation';
import {
  LanguageIcon,
} from '../components/icons';
import {
  t,
} from './language';
import type {
  SettingsPage,
  UiLanguage,
} from './types';
interface SettingsShellProps {
  language: UiLanguage;
  title: string;
  page: SettingsPage;
  profileCode: string;
  onNavigate: (page: Exclude<SettingsPage, 'index'>) => void;
  onOverview: () => void;
  onBack?: () => void;
  onClose: () => void;
  onToggleLanguage: () => void;
  children: ReactNode;
}
export function SettingsShell({
  language,
  title,
  page,
  profileCode,
  onNavigate,
  onOverview,
  onBack,
  onClose,
  onToggleLanguage,
  children,
}: SettingsShellProps) {
  // The overview and each of its top-level sections start collapsed.
  const [railOpen, setRailOpen] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Partial<Record<SettingsPage, boolean>>>(
    () => Object.fromEntries((settingsGroups.index ?? []).map(group => [group, true])),
  );
  const heading = useRef<HTMLHeadingElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const shell = useRef<HTMLElement>(null);
  const railToggleLabel = language === 'en'
    ? (railOpen ? 'Hide settings menu' : 'Show settings menu')
    : (railOpen ? 'అమరికల మెను దాచు' : 'అమరికల మెను చూపించు');
  // From the top-level screen the overview takes the whole screen; from a nested
  // section it is a left-side overlay that leaves the section visible.
  const railMode = page === 'index' ? 'full' : 'popup';
  useEffect(() => {
    content.current?.scrollTo(0, 0);
    heading.current?.focus({ preventScroll: true });
  }, [page]);
  useEffect(() => {
    if (!railOpen) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setRailOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [railOpen]);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    let frame = 0;
    const updateViewport = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const element = document.activeElement;
        const container = content.current;
        const style = shell.current?.style;
        if (!style || !container) return;
        const editing = element instanceof HTMLElement && container.contains(element)
          && element.matches('input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="color"]), textarea, select');
        // Follow the keyboard's visible area, but leave deliberate pinch zoom to the browser.
        if (!editing || Math.abs(viewport.scale - 1) > 0.01) {
          style.removeProperty('--settings-viewport-height');
          style.removeProperty('--settings-viewport-top');
          return;
        }
        style.setProperty('--settings-viewport-height', `${viewport.height}px`);
        style.setProperty('--settings-viewport-top', `${viewport.offsetTop}px`);
        const field = element.getBoundingClientRect();
        const bounds = container.getBoundingClientRect();
        const top = bounds.top + 24;
        const bottom = bounds.bottom - 24;
        if (field.top < top) container.scrollBy({ top: field.top - top });
        else if (field.bottom > bottom) container.scrollBy({ top: Math.min(field.bottom - bottom, field.top - top) });
      });
    };
    viewport.addEventListener('resize', updateViewport);
    viewport.addEventListener('scroll', updateViewport);
    document.addEventListener('focusin', updateViewport);
    document.addEventListener('focusout', updateViewport);
    return () => {
      cancelAnimationFrame(frame);
      viewport.removeEventListener('resize', updateViewport);
      viewport.removeEventListener('scroll', updateViewport);
      document.removeEventListener('focusin', updateViewport);
      document.removeEventListener('focusout', updateViewport);
    };
  }, []);

  const navigationButton = (destination: SettingsPage, nested = false) => {
    const Icon = settingsPageIcons[destination];
    const label = settingsPageLabel(destination, language);
    return (
      <button
        key={destination}
        className={`settings-rail-link${nested ? ' settings-rail-child' : ''}`}
        type="button"
        aria-label={`${nested ? settingsPageLabel(parentSettingsPage(destination), language) : t(language, 'settings')}: ${label}`}
        aria-current={page === destination ? 'page' : undefined}
        onClick={(event) => {
          event.currentTarget.blur();
          setRailOpen(false);
          if (page !== destination) {
            if (destination === 'index') onOverview();
            else onNavigate(destination);
          }
        }}
      >
        {!nested && <Icon aria-hidden="true" />}
        <span>{label}</span>
      </button>
    );
  };
  return (
    <main ref={shell} className={`app-shell settings-screen${railOpen ? ' settings-rail-open' : ''}`} data-rail-mode={railMode} lang={language}>
      <button
        className="settings-rail-toggle"
        type="button"
        aria-label={railToggleLabel}
        title={railToggleLabel}
        aria-expanded={railOpen}
        aria-controls="settings-rail"
        onClick={() => setRailOpen((open) => !open)}
      >
        {railOpen ? <PanelLeftClose size={20} aria-hidden="true" /> : <PanelLeftOpen size={20} aria-hidden="true" />}
      </button>
      {railOpen && railMode === 'popup' ? (
        <button className="settings-rail-scrim" type="button" tabIndex={-1} aria-hidden="true" onClick={() => setRailOpen(false)} />
      ) : null}
      <button
        className="settings-close"
        type="button"
        aria-label={t(language, 'close')}
        onClick={onClose}
        title={t(language, 'close')}
      >
        <X size={20} aria-hidden="true" />
      </button>
      <aside className="settings-rail" id="settings-rail" hidden={!railOpen}>
        <div className="settings-rail-heading">
          <span>{language === 'en' ? 'Profile' : 'ప్రొఫైల్'}</span>
          <span className="settings-profile-code">{profileCode}</span>
        </div>
        <nav aria-label={language === 'en' ? 'Settings navigation' : 'అమరికల నావిగేషన్'}>
          {navigationButton('index')}
          {settingsGroups.index?.map((group) => (
            <div className="settings-rail-group" key={group}>
              <div className="settings-rail-group-heading">
                {navigationButton(group)}
                {settingsGroups[group] ? (
                  <button
                    className="settings-rail-disclosure"
                    type="button"
                    aria-label={`${collapsedGroups[group] ? (language === 'en' ? 'Expand' : 'విస్తరించు') : (language === 'en' ? 'Collapse' : 'కుదించు')} ${settingsPageLabel(group, language)}`}
                    title={`${collapsedGroups[group] ? (language === 'en' ? 'Expand' : 'విస్తరించు') : (language === 'en' ? 'Collapse' : 'కుదించు')} ${settingsPageLabel(group, language)}`}
                    aria-expanded={!collapsedGroups[group]}
                    aria-controls={`settings-rail-${group}`}
                    onClick={() => setCollapsedGroups(current => ({ ...current, [group]: !current[group] }))}
                  >
                    {collapsedGroups[group] ? <ChevronRight size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}
                  </button>
                ) : null}
              </div>
              {settingsGroups[group] ? (
                <div id={`settings-rail-${group}`} hidden={Boolean(collapsedGroups[group])}>
                  {settingsGroups[group]?.map((child) => navigationButton(child, true))}
                </div>
              ) : null}
            </div>
          ))}
        </nav>
      </aside>
      <header className="settings-header">
        <div className="settings-header-side">
          {onBack ? (
            <button
              className="settings-back"
              type="button"
              aria-label={
                t(
                  language,
                  'back',
                )
              }
              onClick={onBack}
              title={t(language, 'back')}
            >
              <ChevronLeft size={20} aria-hidden="true" />
            </button>
          ) : null}
        </div>
        <div className="settings-heading">
          <h1 ref={heading} tabIndex={-1}>{title}</h1>
        </div>
      </header>
      <div ref={content} className="settings-page-content">
        <div className="settings-page-transition" key={page}>{children}</div>
      </div>
      <button
        className="language-toggle"
        type="button"
        aria-label={
          t(
            language,
            'language',
          )
        }
        onClick={
          onToggleLanguage
        }
        title={language === 'en' ? 'తెలుగు' : 'English'}
      >
        <LanguageIcon />
      </button>
    </main>
  );
}
