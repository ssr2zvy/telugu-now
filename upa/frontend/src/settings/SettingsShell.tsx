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
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Partial<Record<SettingsPage, boolean>>>({});
  const heading = useRef<HTMLHeadingElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const shell = useRef<HTMLElement>(null);
  const parent = parentSettingsPage(page);
  const railToggleLabel = language === 'en'
    ? (railCollapsed ? 'Show settings menu' : 'Hide settings menu')
    : (railCollapsed ? 'అమరికల మెను చూపించు' : 'అమరికల మెను దాచు');
  useEffect(() => {
    content.current?.scrollTo(0, 0);
    heading.current?.focus({ preventScroll: true });
  }, [page]);
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
        onClick={() => {
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
    <main ref={shell} className={`app-shell settings-screen${railCollapsed ? ' settings-rail-collapsed' : ''}`} lang={language}>
      <button
        className="settings-rail-toggle"
        type="button"
        aria-label={railToggleLabel}
        aria-expanded={!railCollapsed}
        aria-controls="settings-rail"
        onClick={() => setRailCollapsed((collapsed) => !collapsed)}
      >
        {railCollapsed ? <PanelLeftOpen size={20} aria-hidden="true" /> : <PanelLeftClose size={20} aria-hidden="true" />}
      </button>
      <button
        className="settings-close"
        type="button"
        aria-label={t(language, 'close')}
        onClick={onClose}
      >
        <X size={20} aria-hidden="true" />
      </button>
      <aside className="settings-rail" id="settings-rail">
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
            >
              <ChevronLeft size={20} aria-hidden="true" />
            </button>
          ) : null}
        </div>
        <div className="settings-heading">
          <div className="settings-context">
            {page === 'index'
              ? `${language === 'en' ? 'Profile' : 'ప్రొఫైల్'} ${profileCode}`
              : settingsPageLabel(parent, language)}
          </div>
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
      >
        <LanguageIcon />
      </button>
    </main>
  );
}
