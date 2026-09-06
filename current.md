frontend/src/App.tsx

import { useState } from 'react';
import { ObservationView } from './observation/ObservationView';
import { ProfileEntry } from './profile/ProfileEntry';
import { useProfileSession } from './profile/useProfileSession';
import { SettingsView } from './settings/SettingsView';
import { useSettingsController } from './settings/useSettingsController';
import './styles.css';
export function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const session = useProfileSession(settingsOpen);
  const settings = useSettingsController({
    profileCode: session.profileCode,
    state: session.state,
    onSettingsSaved: session.applySelectionSettings,
  });
  if (!session.profileCode) {
    return (
      <ProfileEntry
        invalidCode={session.invalidCode}
        onSubmit={session.submitCode}
        onInputChange={session.clearInvalidCode}
      />
    );
  }
  if (settingsOpen && session.state) {
    return (
      <SettingsView
        state={session.state}
        controller={settings}
        onClose={() => {
          setSettingsOpen(false);
          session.setObservationVisible(
            document.visibilityState === 'visible',
          );
        }}
      />
    );
  }
  return (
    <ObservationView
      state={session.state}
      busy={session.busy}
      onMove={session.move}
      onOpenSettings={() => {
        settings.prepareOpen();
        session.setObservationVisible(false);
        setSettingsOpen(true);
      }}
    />
  );
}

frontend/src/styles.css

@import './styles/base.css';
@import './styles/profile.css';
@import './styles/observation.css';
@import './styles/settings.css';

frontend/src/components/icons.tsx

export function SettingsIcon() {
  return (
    <svg
      className="control-icon"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.86 2.86-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .62 1.7 1.7 0 0 0-.4 1.08V21h-4v-.1a1.7 1.7 0 0 0-.4-1.08 1.7 1.7 0 0 0-1-.62 1.7 1.7 0 0 0-1.88.34l-.06.06-2.86-2.86.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.62-1A1.7 1.7 0 0 0 2.9 13.6H3v-4h-.1a1.7 1.7 0 0 0 1.08-.4 1.7 1.7 0 0 0 .62-1 1.7 1.7 0 0 0-.34-1.88l-.06-.06L7.06 3.4l.06.06A1.7 1.7 0 0 0 9 3.8a1.7 1.7 0 0 0 1-.62A1.7 1.7 0 0 0 10.4 2.1V2h4v.1a1.7 1.7 0 0 0 .4 1.08 1.7 1.7 0 0 0 1 .62 1.7 1.7 0 0 0 1.88-.34l.06-.06 2.86 2.86-.06.06A1.7 1.7 0 0 0 19.4 8a1.7 1.7 0 0 0 .62 1 1.7 1.7 0 0 0 1.08.4h.1v4h-.1a1.7 1.7 0 0 0-1.08.4 1.7 1.7 0 0 0-.62 1Z" />
    </svg>
  );
}
export function LanguageIcon() {
  return (
    <svg
      className="control-icon"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9S14.5 18.4 12 21M12 3C9.5 5.6 8.2 8.6 8.2 12s1.3 6.4 3.8 9" />
    </svg>
  );
}

frontend/src/profile/ProfileEntry.tsx

import { useRef, useState, type CSSProperties, type ChangeEvent } from 'react';
interface ProfileEntryProps {
  invalidCode: boolean;
  onSubmit: (code: string) => Promise<boolean>;
  onInputChange: () => void;
}
export function ProfileEntry({
  invalidCode,
  onSubmit,
  onInputChange,
}: ProfileEntryProps) {
  const [codeInput, setCodeInput] = useState('');
  const entryLayoutHeightRef = useRef<number>(window.innerHeight);
  const handleChange = (value: string) => {
    const next = value.replace(/\D/g, '').slice(0, 3);
    setCodeInput(next);
    onInputChange();
    if (next.length === 3) {
      void onSubmit(next).then((accepted) => {
        if (!accepted) {
          setCodeInput('');
        }
      });
    }
  };
  return (
    <main
      className="app-shell entry-screen"
      style={{
        '--entry-layout-height': `${entryLayoutHeightRef.current}px`,
      } as CSSProperties}
    >
      <div className="entry-wrap">
        <input
          className="profile-input"
          aria-label="ప్రొఫైల్ కోడ్"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={3}
          value={codeInput}
          onChange={(event: ChangeEvent<HTMLInputElement>) =>
            handleChange(event.target.value)
          }
        />
        <div
          className="telugu-error"
          role={invalidCode ? 'status' : undefined}
        >
          {invalidCode ? 'చెల్లని కోడ్' : '\u00A0'}
        </div>
      </div>
    </main>
  );
}

frontend/src/profile/useProfileSession.ts

import { useEffect, useRef, useState } from 'react';
import type {
  ProfileSelectionSettings,
  ProfileStateResponse,
} from '../../../shared/contracts';
import {
  getProfileState,
  loadProfile,
  navigate,
  setVisibility,
} from '../api';
export interface ProfileSession {
  profileCode: string | null;
  state: ProfileStateResponse | null;
  invalidCode: boolean;
  busy: boolean;
  submitCode: (code: string) => Promise<boolean>;
  clearInvalidCode: () => void;
  move: (direction: 'back' | 'next') => Promise<boolean>;
  setObservationVisible: (visible: boolean) => void;
  applySelectionSettings: (settings: ProfileSelectionSettings) => void;
}
export function useProfileSession(settingsOpen: boolean): ProfileSession {
  const [profileCode, setProfileCode] = useState<string | null>(null);
  const [state, setState] = useState<ProfileStateResponse | null>(null);
  const [invalidCode, setInvalidCode] = useState(false);
  const [busy, setBusy] = useState(false);
  const activeCodeRef = useRef<string | null>(null);
  const settingsOpenRef = useRef(settingsOpen);
  useEffect(() => {
    activeCodeRef.current = profileCode;
  }, [profileCode]);
  useEffect(() => {
    settingsOpenRef.current = settingsOpen;
  }, [settingsOpen]);
  useEffect(() => {
    if (!profileCode) return;
    let cancelled = false;
    const refresh = async () => {
      try {
        const observationVisible =
          document.visibilityState === 'visible' && !settingsOpen;
        const next = await getProfileState(profileCode, observationVisible);
        if (!cancelled) {
          setState(next);
        }
      } catch {
        // Keep the last known state. The next poll will retry.
      }
    };
    void refresh();
    const interval = window.setInterval(
      () => void refresh(),
      1_000,
    );
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [profileCode, settingsOpen]);
  useEffect(() => {
    const onVisibility = () => {
      const code = activeCodeRef.current;
      if (!code) return;
      void setVisibility(code, {
        visible:
          document.visibilityState === 'visible' &&
          !settingsOpenRef.current,
      });
    };
    const onPageHide = () => {
      const code = activeCodeRef.current;
      if (!code) return;
      const body = new Blob(
        [JSON.stringify({ visible: false })],
        { type: 'application/json' },
      );
      navigator.sendBeacon(
        `/api/profiles/${code}/visibility`,
        body,
      );
    };
    document.addEventListener(
      'visibilitychange',
      onVisibility,
    );
    window.addEventListener(
      'pagehide',
      onPageHide,
    );
    return () => {
      document.removeEventListener(
        'visibilitychange',
        onVisibility,
      );
      window.removeEventListener(
        'pagehide',
        onPageHide,
      );
    };
  }, []);
  const submitCode = async (
    code: string,
  ): Promise<boolean> => {
    if (!/^\d{3}$/.test(code)) {
      return false;
    }
    setBusy(true);
    setInvalidCode(false);
    try {
      const loaded = await loadProfile({
        code,
        visible:
          document.visibilityState ===
          'visible',
      });
      setProfileCode(code);
      setState(loaded);
      return true;
    } catch {
      setInvalidCode(true);
      return false;
    } finally {
      setBusy(false);
    }
  };
  const move = async (
    direction: 'back' | 'next',
  ): Promise<boolean> => {
    if (!profileCode) {
      return false;
    }
    setBusy(true);
    try {
      const next = await navigate(
        profileCode,
        direction,
        {
          visible:
            document.visibilityState ===
            'visible',
        },
      );
      setState(next);
      return true;
    } catch {
      // Polling refreshes readiness/state.
      return false;
    } finally {
      setBusy(false);
    }
  };
  const setObservationVisible = (
    visible: boolean,
  ) => {
    if (!profileCode) return;
    void setVisibility(
      profileCode,
      { visible },
    );
  };
  const applySelectionSettings = (
    settings: ProfileSelectionSettings,
  ) => {
    setState((current) =>
      current
        ? {
            ...current,
            selectionSettings: settings,
          }
        : current,
    );
  };
  return {
    profileCode,
    state,
    invalidCode,
    busy,
    submitCode,
    clearInvalidCode: () =>
      setInvalidCode(false),
    move,
    setObservationVisible,
    applySelectionSettings,
  };
}

frontend/src/observation/ObservationView.tsx

import {
  useState,
  type MouseEvent,
} from 'react';
import type {
  ProfileStateResponse,
} from '../../../shared/contracts';
import {
  SettingsIcon,
} from '../components/icons';
import {
  useObservationTypography,
} from './useObservationTypography';
interface ObservationViewProps {
  state: ProfileStateResponse | null;
  busy: boolean;
  onMove: (
    direction: 'back' | 'next',
  ) => Promise<boolean>;
  onOpenSettings: () => void;
}
export function ObservationView({
  state,
  busy,
  onMove,
  onOpenSettings,
}: ObservationViewProps) {
  const [
    controlsVisible,
    setControlsVisible,
  ] = useState(false);
  const observation =
    state?.currentObservation ?? null;
  const typography =
    useObservationTypography(
      observation,
    );
  const canBack =
    Boolean(state?.canBack) &&
    !busy;
  const canNext =
    Boolean(state?.canNext) &&
    !busy;
  const move = async (
    direction: 'back' | 'next',
  ) => {
    const moved =
      await onMove(direction);
    if (moved) {
      setControlsVisible(false);
    }
  };
  return (
    <main
      className={
        `app-shell observation-screen ${
          controlsVisible
            ? 'controls-visible'
            : ''
        }`
      }
      onClick={() =>
        setControlsVisible(
          (visible) => !visible,
        )
      }
    >
      <button
        className="nav-zone nav-zone-left"
        type="button"
        aria-label="వెనుక"
        disabled={!canBack}
        onClick={(
          event:
            MouseEvent<HTMLButtonElement>,
        ) => {
          event.stopPropagation();
          if (canBack) {
            void move('back');
          }
        }}
      >
        ‹
      </button>
      <section
        ref={typography.containerRef}
        className="observation-center"
      >
        {observation ? (
          <div
            ref={typography.textRef}
            className="observation-text"
            style={typography.style}
          >
            {observation.text}
          </div>
        ) : (
          <div className="observation-placeholder">
            ...
          </div>
        )}
      </section>
      <button
        className="nav-zone nav-zone-right"
        type="button"
        aria-label="తర్వాత"
        disabled={!canNext}
        onClick={(
          event:
            MouseEvent<HTMLButtonElement>,
        ) => {
          event.stopPropagation();
          if (canNext) {
            void move('next');
          }
        }}
      >
        ›
      </button>
      <button
        className="settings-trigger"
        type="button"
        aria-label="అమరికలు"
        onClick={(
          event:
            MouseEvent<HTMLButtonElement>,
        ) => {
          event.stopPropagation();
          onOpenSettings();
        }}
      >
        <SettingsIcon />
      </button>
    </main>
  );
}

frontend/src/observation/useObservationTypography.ts

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from 'react';
import type {
  DisplayObservation,
} from '../../../shared/contracts';
import {
  chooseRandomObservationFont,
  preferredObservationFontSizePx,
  type ObservationFontFamily,
} from '../presentation';
interface ObservationPresentation {
  observationId: string | null;
  fontFamily: ObservationFontFamily;
}
export interface ObservationTypography {
  containerRef:
    RefObject<HTMLElement | null>;
  textRef:
    RefObject<HTMLDivElement | null>;
  style:
    CSSProperties;
}
export function useObservationTypography(
  observation:
    DisplayObservation | null,
): ObservationTypography {
  const containerRef =
    useRef<HTMLElement | null>(
      null,
    );
  const textRef =
    useRef<HTMLDivElement | null>(
      null,
    );
  const [
    presentation,
    setPresentation,
  ] =
    useState<ObservationPresentation>(
      () => ({
        observationId:
          observation?.id ?? null,
        fontFamily:
          chooseRandomObservationFont(),
      }),
    );
  const [
    fontSizePx,
    setFontSizePx,
  ] = useState(64);
  const [
    ready,
    setReady,
  ] = useState(false);
  useEffect(() => {
    const observationId =
      observation?.id ?? null;
    if (
      observationId ===
      presentation.observationId
    ) {
      return;
    }
    setPresentation({
      observationId,
      fontFamily:
        chooseRandomObservationFont(),
    });
  }, [
    observation?.id,
    presentation.observationId,
  ]);
  useLayoutEffect(() => {
    const container =
      containerRef.current;
    const element =
      textRef.current;
    if (
      !observation ||
      !container ||
      !element
    ) {
      setReady(false);
      return;
    }
    let cancelled = false;
    let resizeObserver:
      ResizeObserver | null =
      null;
    const fit = async () => {
      setReady(false);
      const containerRect =
        container
          .getBoundingClientRect();
      const availableHeight =
        Math.max(
          1,
          containerRect.height -
            64,
        );
      const desired =
        preferredObservationFontSizePx(
          observation.text,
          containerRect.width,
          availableHeight,
        );
      try {
        await document.fonts.load(
          `400 ${Math.max(
            24,
            desired,
          )}px "${
            presentation.fontFamily
          }"`,
          observation.text.slice(
            0,
            64,
          ),
        );
      } catch {
        // Device fallback fonts remain usable
        // if a webfont cannot be loaded.
      }
      if (cancelled) return;
      let low = 12;
      let high = desired;
      let best =
        Math.min(
          low,
          desired,
        );
      for (
        let iteration = 0;
        iteration < 10;
        iteration += 1
      ) {
        const candidate =
          (low + high) / 2;
        element.style.fontSize =
          `${candidate}px`;
        const fitsWidth =
          element.scrollWidth <=
          element.clientWidth + 1;
        const fitsHeight =
          element.scrollHeight <=
          availableHeight + 1;
        if (
          fitsWidth &&
          fitsHeight
        ) {
          best = candidate;
          low = candidate;
        } else {
          high = candidate;
        }
      }
      const finalSize =
        Math.max(
          12,
          Math.min(
            desired,
            best,
          ),
        );
      element.style.fontSize =
        `${finalSize}px`;
      setFontSizePx(finalSize);
      setReady(true);
    };
    void fit();
    resizeObserver =
      new ResizeObserver(
        () => {
          void fit();
        },
      );
    resizeObserver.observe(
      container,
    );
    return () => {
      cancelled = true;
      resizeObserver
        ?.disconnect();
    };
  }, [
    observation?.id,
    observation?.text,
    presentation.fontFamily,
  ]);
  return {
    containerRef,
    textRef,
    style: {
      fontFamily:
        `"${presentation.fontFamily}", ` +
        '"Noto Sans Telugu", ' +
        '"Nirmala UI", sans-serif',
      fontSize:
        `${fontSizePx}px`,
      opacity:
        ready ? 1 : 0,
    },
  };
}

frontend/src/settings/types.ts

export type SettingsPage =
  | 'index'
  | 'complexity'
  | 'sources'
  | 'diagnostic'
  | 'export';
export type UiLanguage =
  | 'en'
  | 'te';
export interface SettingsDraft {
  targetPercent: string;
  spreadPercent: string;
  sourceWeights:
    Record<string, string>;
}

frontend/src/settings/language.ts

import type {
  UiLanguage,
} from './types';
const SETTINGS_LANGUAGE_KEY =
  'telugu-now-settings-language';
export const COPY = {
  en: {
    settings: 'Settings',
    complexity: 'Complexity',
    sourceWeights: 'Source weights',
    diagnostic: 'Diagnostic',
    export: 'Export',
    target: 'Target (%)',
    spread: 'Spread (%)',
    save: 'Save',
    saving: 'Saving…',
    invalidValues:
      'Invalid values',
    count: 'Count',
    exporting: 'Exporting…',
    download: 'Download',
    ready: 'Ready',
    invalidExport:
      'Invalid count or export failed',
    close: 'Close',
    back: 'Back',
    language: 'Switch language',
    yes: 'Yes',
    no: 'No',
    unavailable: 'Unavailable',
    initialFill: 'Initial fill',
    observationConsumed:
      'Observation consumed',
  },
  te: {
    settings: 'అమరికలు',
    complexity: 'సంక్లిష్టత',
    sourceWeights: 'మూల బరువులు',
    diagnostic: 'నిర్ధారణ సమాచారం',
    export: 'ఎగుమతి',
    target: 'లక్ష్యం (%)',
    spread: 'వ్యాప్తి (%)',
    save: 'భద్రపరచు',
    saving: 'భద్రపరుస్తోంది…',
    invalidValues:
      'చెల్లని విలువలు',
    count: 'సంఖ్య',
    exporting:
      'ఎగుమతి అవుతోంది…',
    download: 'డౌన్‌లోడ్',
    ready: 'సిద్ధం',
    invalidExport:
      'చెల్లని సంఖ్య లేదా ఎగుమతి విఫలమైంది',
    close: 'మూసివేయి',
    back: 'వెనుక',
    language: 'భాష మార్చు',
    yes: 'అవును',
    no: 'కాదు',
    unavailable:
      'అందుబాటులో లేదు',
    initialFill:
      'ప్రారంభ నింపుదల',
    observationConsumed:
      'పరిశీలన వినియోగం',
  },
} as const;
export function t(
  language: UiLanguage,
  key: keyof typeof COPY.en,
): string {
  return COPY[language][key];
}
export function loadSettingsLanguage():
UiLanguage {
  const stored =
    window.localStorage
      .getItem(
        SETTINGS_LANGUAGE_KEY,
      );
  return (
    stored === 'en' ||
    stored === 'te'
  )
    ? stored
    : 'te';
}
export function saveSettingsLanguage(
  language: UiLanguage,
): void {
  window.localStorage.setItem(
    SETTINGS_LANGUAGE_KEY,
    language,
  );
}

frontend/src/settings/settings-utils.ts

import type {
  ProfileSelectionSettings,
} from '../../../shared/contracts';
import type {
  SettingsDraft,
} from './types';
export function draftFromSettings(
  settings:
    ProfileSelectionSettings,
): SettingsDraft {
  return {
    targetPercent:
      String(
        settings
          .complexityPercentileTarget *
          100,
      ),
    spreadPercent:
      String(
        settings
          .complexityPercentileSpread *
          100,
      ),
    sourceWeights:
      Object.fromEntries(
        Object.entries(
          settings.sourceWeights,
        ).map(
          ([sourceId, weight]) => [
            sourceId,
            String(weight),
          ],
        ),
      ),
  };
}
export function sourceDisplayName(
  sourceId: string,
): string {
  const match =
    /^source(\d+)$/.exec(
      sourceId,
    );
  return match?.[1] ?? sourceId;
}

frontend/src/settings/diagnostic.ts

import type {
  ProfileStateResponse,
  SelectionSnapshot,
} from '../../../shared/contracts';
import {
  t,
} from './language';
import type {
  UiLanguage,
} from './types';
export interface DiagnosticRow {
  key: DiagnosticLabelKey;
  value: string;
}
const DIAGNOSTIC_LABELS = {
  acquisitionNumber: {
    en: 'Acquisition',
    te: 'సేకరణ',
  },
  triggerKind: {
    en: 'Trigger kind',
    te: 'ట్రిగర్ రకం',
  },
  triggeredByObservationId: {
    en: 'Triggered by observation',
    te: 'ట్రిగర్ చేసిన పరిశీలన',
  },
  triggeredByAcquisitionNumber: {
    en: 'Triggered by acquisition',
    te: 'ట్రిగర్ చేసిన సేకరణ',
  },
  triggeredByHistoryPosition: {
    en: 'Triggered by history position',
    te: 'ట్రిగర్ చేసిన చరిత్ర స్థానం',
  },
  triggeredAt: {
    en: 'Trigger time',
    te: 'ట్రిగర్ సమయం',
  },
  waitingAheadAtTrigger: {
    en: 'Waiting ahead',
    te: 'ముందు వేచి ఉన్నవి',
  },
  preparationInFlightAtTrigger: {
    en: 'Preparation in flight',
    te: 'సిద్ధీకరణ కొనసాగుతోంది',
  },
  cacheHit: {
    en: 'Cache hit',
    te: 'క్యాష్‌లో లభించింది',
  },
  requestStartedAt: {
    en: 'Request start',
    te: 'అభ్యర్థన ప్రారంభం',
  },
  requestCompletedAt: {
    en: 'Request end',
    te: 'అభ్యర్థన ముగింపు',
  },
  requestDurationMs: {
    en: 'Request duration',
    te: 'అభ్యర్థన వ్యవధి',
  },
  selectionSnapshot: {
    en: 'Selection snapshot',
    te: 'ఎంపిక స్నాప్‌షాట్',
  },
  sourceWeights: {
    en: 'Source weights',
    te: 'మూల బరువులు',
  },
  sourceId: {
    en: 'Source',
    te: 'మూలం',
  },
  sourceRowCount: {
    en: 'Source rows',
    te: 'మూల వరుసలు',
  },
  sourceWeight: {
    en: 'Source weight',
    te: 'మూల బరువు',
  },
  sourceMass: {
    en: 'Source mass',
    te: 'మూల మాస్',
  },
  totalSourceMass: {
    en: 'Total source mass',
    te: 'మొత్తం మూల మాస్',
  },
  sourceProbability: {
    en: 'Source probability',
    te: 'మూల సంభావ్యత',
  },
  sourceKey: {
    en: 'Row',
    te: 'వరుస',
  },
  wordCount: {
    en: 'Word count',
    te: 'పదాల సంఖ్య',
  },
  complexityReferenceVersion: {
    en: 'Complexity reference',
    te: 'సంక్లిష్టత సూచిక',
  },
  complexityPercentileTarget: {
    en: 'Complexity target',
    te: 'సంక్లిష్టత లక్ష్యం',
  },
  complexityPercentileSpread: {
    en: 'Complexity spread',
    te: 'సంక్లిష్టత వ్యాప్తి',
  },
  derivedStandardDeviation: {
    en: 'Derived sigma',
    te: 'ఉత్పన్న సిగ్మా',
  },
  globalPercentileInterval: {
    en: 'Global percentile interval',
    te: 'ప్రపంచ పర్సెంటైల్ పరిధి',
  },
  globalIntervalMass: {
    en: 'Global interval mass',
    te: 'ప్రపంచ పరిధి మాస్',
  },
  globalRowsAtWordCount: {
    en: 'Global rows at word count',
    te: 'ఆ పదాల సంఖ్యలో ప్రపంచ వరుసలు',
  },
  globalPerRowComplexityMass: {
    en: 'Global per-row complexity mass',
    te: 'వరుసకు ప్రపంచ సంక్లిష్టత మాస్',
  },
  selectedSourceRowsAtWordCount: {
    en: 'Source rows at word count',
    te: 'ఆ పదాల సంఖ్యలో మూల వరుసలు',
  },
  selectedSourceNormalizationDenominator: {
    en: 'Source complexity denominator',
    te: 'మూల సంక్లిష్టత హారం',
  },
  rowProbabilityWithinSource: {
    en: 'Row probability within source',
    te: 'మూలంలో వరుస సంభావ్యత',
  },
  overallProbability: {
    en: 'Overall probability',
    te: 'మొత్తం సంభావ్యత',
  },
} as const;
export type DiagnosticLabelKey =
  keyof typeof DIAGNOSTIC_LABELS;
export function diagnosticLabel(
  language: UiLanguage,
  key: DiagnosticLabelKey,
): string {
  return DIAGNOSTIC_LABELS[
    key
  ][language];
}
function formatTime(
  timestamp: number | null,
): string {
  if (timestamp === null) {
    return '—';
  }
  return new Date(
    timestamp,
  ).toLocaleTimeString(
    [],
    {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    },
  );
}
function formatPercent(
  value: number,
): string {
  return `${(
    value * 100
  ).toFixed(4)}%`;
}
function formatNumber(
  value: number,
): string {
  if (value === 0) {
    return '0';
  }
  if (
    Math.abs(value) <
    0.000001
  ) {
    return value.toExponential(6);
  }
  return value
    .toFixed(8)
    .replace(/0+$/, '')
    .replace(/\.$/, '');
}
function sourceDisplayName(
  sourceId: string,
): string {
  const match =
    /^source(\d+)$/.exec(
      sourceId,
    );
  return match?.[1] ?? sourceId;
}
function formatSourceWeights(
  weights:
    Record<string, number>,
): string {
  return Object.entries(weights)
    .sort(
      ([left], [right]) =>
        left.localeCompare(right),
    )
    .map(
      ([sourceId, weight]) =>
        `${sourceDisplayName(
          sourceId,
        )}: ${formatNumber(
          weight,
        )}`,
    )
    .join(' · ');
}
function selectionRows(
  selection:
    SelectionSnapshot,
): DiagnosticRow[] {
  return [
    {
      key: 'sourceWeights',
      value:
        formatSourceWeights(
          selection.sourceWeights,
        ),
    },
    {
      key: 'sourceId',
      value:
        selection.sourceId,
    },
    {
      key: 'sourceRowCount',
      value:
        String(
          selection.sourceRowCount,
        ),
    },
    {
      key: 'sourceWeight',
      value:
        formatNumber(
          selection.sourceWeight,
        ),
    },
    {
      key: 'sourceMass',
      value:
        formatNumber(
          selection.sourceMass,
        ),
    },
    {
      key: 'totalSourceMass',
      value:
        formatNumber(
          selection.totalSourceMass,
        ),
    },
    {
      key: 'sourceProbability',
      value:
        formatPercent(
          selection.sourceProbability,
        ),
    },
    {
      key: 'sourceKey',
      value:
        selection.sourceKey,
    },
    {
      key: 'wordCount',
      value:
        String(
          selection.wordCount,
        ),
    },
    {
      key:
        'complexityReferenceVersion',
      value:
        `v${
          selection
            .complexityReferenceVersion
        }`,
    },
    {
      key:
        'complexityPercentileTarget',
      value:
        formatPercent(
          selection
            .complexityPercentileTarget,
        ),
    },
    {
      key:
        'complexityPercentileSpread',
      value:
        `±${formatPercent(
          selection
            .complexityPercentileSpread,
        )}`,
    },
    {
      key:
        'derivedStandardDeviation',
      value:
        formatNumber(
          selection
            .derivedStandardDeviation,
        ),
    },
    {
      key:
        'globalPercentileInterval',
      value:
        `${formatPercent(
          selection
            .globalPercentileStart,
        )}–` +
        formatPercent(
          selection
            .globalPercentileEnd,
        ),
    },
    {
      key:
        'globalIntervalMass',
      value:
        formatNumber(
          selection
            .globalIntervalMass,
        ),
    },
    {
      key:
        'globalRowsAtWordCount',
      value:
        String(
          selection
            .globalRowsAtWordCount,
        ),
    },
    {
      key:
        'globalPerRowComplexityMass',
      value:
        formatNumber(
          selection
            .globalPerRowComplexityMass,
        ),
    },
    {
      key:
        'selectedSourceRowsAtWordCount',
      value:
        String(
          selection
            .selectedSourceRowsAtWordCount,
        ),
    },
    {
      key:
        'selectedSourceNormalizationDenominator',
      value:
        formatNumber(
          selection
            .selectedSourceNormalizationDenominator,
        ),
    },
    {
      key:
        'rowProbabilityWithinSource',
      value:
        formatPercent(
          selection
            .rowProbabilityWithinSource,
        ),
    },
    {
      key:
        'overallProbability',
      value:
        formatPercent(
          selection
            .overallProbability,
        ),
    },
  ];
}
export function buildDiagnosticRows(
  state: ProfileStateResponse,
  language: UiLanguage,
): DiagnosticRow[] | null {
  const diagnostic =
    state
      .currentObservation
      ?.diagnostic;
  if (!diagnostic) {
    return null;
  }
  const rows:
    DiagnosticRow[] = [
    {
      key:
        'acquisitionNumber',
      value:
        `#${
          diagnostic
            .acquisitionNumber
        }`,
    },
    {
      key:
        'triggerKind',
      value:
        diagnostic.triggerKind ===
        'initial-fill'
          ? t(
              language,
              'initialFill',
            )
          : t(
              language,
              'observationConsumed',
            ),
    },
    {
      key:
        'triggeredByObservationId',
      value:
        diagnostic
          .triggeredByObservationId ??
        '—',
    },
    {
      key:
        'triggeredByAcquisitionNumber',
      value:
        diagnostic
          .triggeredByAcquisitionNumber ===
        null
          ? '—'
          : `#${
              diagnostic
                .triggeredByAcquisitionNumber
            }`,
    },
    {
      key:
        'triggeredByHistoryPosition',
      value:
        diagnostic
          .triggeredByHistoryPosition ===
        null
          ? '—'
          : String(
              diagnostic
                .triggeredByHistoryPosition,
            ),
    },
    {
      key:
        'triggeredAt',
      value:
        formatTime(
          diagnostic.triggeredAt,
        ),
    },
    {
      key:
        'waitingAheadAtTrigger',
      value:
        String(
          diagnostic
            .waitingAheadAtTrigger,
        ),
    },
    {
      key:
        'preparationInFlightAtTrigger',
      value:
        diagnostic
          .preparationInFlightAtTrigger
          ? t(language, 'yes')
          : t(language, 'no'),
    },
    {
      key: 'cacheHit',
      value:
        diagnostic.cacheHit ===
        null
          ? '—'
          : diagnostic.cacheHit
            ? t(
                language,
                'yes',
              )
            : t(
                language,
                'no',
              ),
    },
    {
      key:
        'requestStartedAt',
      value:
        formatTime(
          diagnostic
            .requestStartedAt,
        ),
    },
    {
      key:
        'requestCompletedAt',
      value:
        formatTime(
          diagnostic
            .requestCompletedAt,
        ),
    },
    {
      key:
        'requestDurationMs',
      value:
        diagnostic
          .requestDurationMs ===
        null
          ? '—'
          : `${
              diagnostic
                .requestDurationMs
            } ms`,
    },
  ];
  if (diagnostic.selection) {
    rows.push(
      ...selectionRows(
        diagnostic.selection,
      ),
    );
  } else {
    rows.push({
      key:
        'selectionSnapshot',
      value:
        t(
          language,
          'unavailable',
        ),
    });
  }
  return rows;
}

frontend/src/settings/SettingsShell.tsx

import type {
  ReactNode,
} from 'react';
import {
  LanguageIcon,
} from '../components/icons';
import {
  t,
} from './language';
import type {
  UiLanguage,
} from './types';
interface SettingsShellProps {
  language: UiLanguage;
  title: string;
  onBack?: () => void;
  onClose: () => void;
  onToggleLanguage: () => void;
  children: ReactNode;
}
export function SettingsShell({
  language,
  title,
  onBack,
  onClose,
  onToggleLanguage,
  children,
}: SettingsShellProps) {
  return (
    <main className="app-shell settings-screen">
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
              ‹
            </button>
          ) : null}
        </div>
        <h1>{title}</h1>
        <div className="settings-header-side settings-header-side-right">
          <button
            className="settings-close"
            type="button"
            aria-label={
              t(
                language,
                'close',
              )
            }
            onClick={onClose}
          >
            ×
          </button>
        </div>
      </header>
      <div className="settings-page-content">
        {children}
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

frontend/src/settings/useSettingsController.ts

import {
  useState,
} from 'react';
import type {
  ExportResponse,
  ProfileSelectionSettings,
  ProfileStateResponse,
} from '../../../shared/contracts';
import {
  generateExport,
  updateSelectionSettings,
} from '../api';
import {
  loadSettingsLanguage,
  saveSettingsLanguage,
} from './language';
import {
  draftFromSettings,
} from './settings-utils';
import type {
  SettingsDraft,
  SettingsPage,
  UiLanguage,
} from './types';
interface UseSettingsControllerOptions {
  profileCode: string | null;
  state: ProfileStateResponse | null;
  onSettingsSaved:
    (
      settings:
        ProfileSelectionSettings,
    ) => void;
}
export interface SettingsController {
  page: SettingsPage;
  language: UiLanguage;
  draft: SettingsDraft | null;
  settingsSaving: boolean;
  settingsError: boolean;
  exportCount: string;
  exporting: boolean;
  exportError: boolean;
  preparedExport:
    ExportResponse | null;
  prepareOpen: () => void;
  enterPage:
    (
      page:
        Exclude<
          SettingsPage,
          'index'
        >,
    ) => void;
  backToIndex: () => void;
  toggleLanguage: () => void;
  setDraft:
    (
      draft:
        SettingsDraft,
    ) => void;
  clearSettingsError:
    () => void;
  saveComplexitySettings:
    () => Promise<void>;
  saveSourceSettings:
    () => Promise<void>;
  setExportCount:
    (count: string) => void;
  startExport:
    () => Promise<void>;
}
export function useSettingsController({
  profileCode,
  state,
  onSettingsSaved,
}: UseSettingsControllerOptions):
SettingsController {
  const [
    page,
    setPage,
  ] =
    useState<SettingsPage>(
      'index',
    );
  const [
    language,
    setLanguage,
  ] =
    useState<UiLanguage>(
      () =>
        loadSettingsLanguage(),
    );
  const [
    draft,
    setDraftState,
  ] =
    useState<
      SettingsDraft | null
    >(null);
  const [
    settingsSaving,
    setSettingsSaving,
  ] = useState(false);
  const [
    settingsError,
    setSettingsError,
  ] = useState(false);
  const [
    exportCount,
    setExportCountState,
  ] = useState('');
  const [
    exporting,
    setExporting,
  ] = useState(false);
  const [
    exportError,
    setExportError,
  ] = useState(false);
  const [
    preparedExport,
    setPreparedExport,
  ] =
    useState<
      ExportResponse | null
    >(null);
  const prepareOpen = () => {
    if (!state) return;
    setDraftState(
      draftFromSettings(
        state.selectionSettings,
      ),
    );
    setSettingsError(false);
    setExportError(false);
    setPage('index');
  };
  const enterPage = (
    nextPage:
      Exclude<
        SettingsPage,
        'index'
      >,
  ) => {
    if (
      state &&
      (
        nextPage ===
          'complexity' ||
        nextPage ===
          'sources'
      )
    ) {
      setDraftState(
        draftFromSettings(
          state.selectionSettings,
        ),
      );
    }
    setSettingsError(false);
    setExportError(false);
    setPage(nextPage);
  };
  const backToIndex = () => {
    setSettingsError(false);
    setExportError(false);
    setPage('index');
  };
  const toggleLanguage = () => {
    setLanguage((current) => {
      const next =
        current === 'te'
          ? 'en'
          : 'te';
      saveSettingsLanguage(
        next,
      );
      return next;
    });
  };
  const saveComplexitySettings =
    async () => {
      if (
        !profileCode ||
        !state ||
        !draft
      ) {
        return;
      }
      const target =
        Number(
          draft.targetPercent,
        ) / 100;
      const spread =
        Number(
          draft.spreadPercent,
        ) / 100;
      const valid =
        Number.isFinite(
          target,
        ) &&
        target >= 0 &&
        target <= 1 &&
        Number.isFinite(
          spread,
        ) &&
        spread > 0;
      if (!valid) {
        setSettingsError(true);
        return;
      }
      setSettingsSaving(true);
      setSettingsError(false);
      try {
        const saved =
          await updateSelectionSettings(
            profileCode,
            {
              sourceWeights:
                state
                  .selectionSettings
                  .sourceWeights,
              complexityPercentileTarget:
                target,
              complexityPercentileSpread:
                spread,
            },
          );
        onSettingsSaved(saved);
        setDraftState(
          draftFromSettings(
            saved,
          ),
        );
        setPreparedExport(null);
      } catch {
        setSettingsError(true);
      } finally {
        setSettingsSaving(false);
      }
    };
  const saveSourceSettings =
    async () => {
      if (
        !profileCode ||
        !state ||
        !draft
      ) {
        return;
      }
      const sourceWeights =
        Object.fromEntries(
          Object.entries(
            draft.sourceWeights,
          ).map(
            (
              [
                sourceId,
                value,
              ],
            ) => [
              sourceId,
              Number(value),
            ],
          ),
        );
      const weights =
        Object.values(
          sourceWeights,
        );
      const valid =
        weights.length > 0 &&
        weights.every(
          (value) =>
            Number.isFinite(
              value,
            ) &&
            value >= 0 &&
            value <= 1,
        ) &&
        Math.max(
          ...weights,
        ) === 1;
      if (!valid) {
        setSettingsError(true);
        return;
      }
      setSettingsSaving(true);
      setSettingsError(false);
      try {
        const saved =
          await updateSelectionSettings(
            profileCode,
            {
              sourceWeights,
              complexityPercentileTarget:
                state
                  .selectionSettings
                  .complexityPercentileTarget,
              complexityPercentileSpread:
                state
                  .selectionSettings
                  .complexityPercentileSpread,
            },
          );
        onSettingsSaved(saved);
        setDraftState(
          draftFromSettings(
            saved,
          ),
        );
        setPreparedExport(null);
      } catch {
        setSettingsError(true);
      } finally {
        setSettingsSaving(false);
      }
    };
  const setExportCount = (
    count: string,
  ) => {
    setExportCountState(count);
    setPreparedExport(null);
    setExportError(false);
  };
  const startExport =
    async () => {
      if (!profileCode) return;
      const count =
        Number(exportCount);
      if (
        !Number.isInteger(
          count,
        ) ||
        count <= 0
      ) {
        setPreparedExport(null);
        setExportError(true);
        return;
      }
      setExporting(true);
      setExportError(false);
      setPreparedExport(null);
      try {
        const result =
          await generateExport(
            profileCode,
            { count },
          );
        setPreparedExport(
          result,
        );
      } catch {
        setExportError(true);
      } finally {
        setExporting(false);
      }
    };
  return {
    page,
    language,
    draft,
    settingsSaving,
    settingsError,
    exportCount,
    exporting,
    exportError,
    preparedExport,
    prepareOpen,
    enterPage,
    backToIndex,
    toggleLanguage,
    setDraft:
      setDraftState,
    clearSettingsError:
      () =>
        setSettingsError(
          false,
        ),
    saveComplexitySettings,
    saveSourceSettings,
    setExportCount,
    startExport,
  };
}

frontend/src/settings/SettingsView.tsx

import type {
  ProfileStateResponse,
} from '../../../shared/contracts';
import {
  t,
} from './language';
import {
  SettingsShell,
} from './SettingsShell';
import type {
  SettingsController,
} from './useSettingsController';
import {
  ComplexityPage,
} from './pages/ComplexityPage';
import {
  DiagnosticPage,
} from './pages/DiagnosticPage';
import {
  ExportPage,
} from './pages/ExportPage';
import {
  SettingsIndex,
} from './pages/SettingsIndex';
import {
  SourceWeightsPage,
} from './pages/SourceWeightsPage';
interface SettingsViewProps {
  state: ProfileStateResponse;
  controller:
    SettingsController;
  onClose: () => void;
}
export function SettingsView({
  state,
  controller,
  onClose,
}: SettingsViewProps) {
  const {
    page,
    language,
    draft,
    settingsSaving,
    settingsError,
    exportCount,
    exporting,
    exportError,
    preparedExport,
  } = controller;
  const shellProps = {
    language,
    onClose,
    onToggleLanguage:
      controller.toggleLanguage,
  };
  if (page === 'index') {
    return (
      <SettingsShell
        {...shellProps}
        title={
          t(
            language,
            'settings',
          )
        }
      >
        <SettingsIndex
          language={language}
          onNavigate={
            controller.enterPage
          }
        />
      </SettingsShell>
    );
  }
  if (!draft) {
    return null;
  }
  if (page === 'complexity') {
    return (
      <SettingsShell
        {...shellProps}
        title={
          t(
            language,
            'complexity',
          )
        }
        onBack={
          controller.backToIndex
        }
      >
        <ComplexityPage
          language={language}
          draft={draft}
          saving={
            settingsSaving
          }
          error={
            settingsError
          }
          onDraftChange={
            controller.setDraft
          }
          onClearError={
            controller
              .clearSettingsError
          }
          onSave={() =>
            void controller
              .saveComplexitySettings()
          }
        />
      </SettingsShell>
    );
  }
  if (page === 'sources') {
    return (
      <SettingsShell
        {...shellProps}
        title={
          t(
            language,
            'sourceWeights',
          )
        }
        onBack={
          controller.backToIndex
        }
      >
        <SourceWeightsPage
          language={language}
          draft={draft}
          saving={
            settingsSaving
          }
          error={
            settingsError
          }
          onDraftChange={
            controller.setDraft
          }
          onClearError={
            controller
              .clearSettingsError
          }
          onSave={() =>
            void controller
              .saveSourceSettings()
          }
        />
      </SettingsShell>
    );
  }
  if (page === 'diagnostic') {
    return (
      <SettingsShell
        {...shellProps}
        title={
          t(
            language,
            'diagnostic',
          )
        }
        onBack={
          controller.backToIndex
        }
      >
        <DiagnosticPage
          state={state}
          language={language}
        />
      </SettingsShell>
    );
  }
  return (
    <SettingsShell
      {...shellProps}
      title={
        t(
          language,
          'export',
        )
      }
      onBack={
        controller.backToIndex
      }
    >
      <ExportPage
        language={language}
        count={exportCount}
        exporting={exporting}
        error={exportError}
        preparedExport={
          preparedExport
        }
        onCountChange={
          controller.setExportCount
        }
        onExport={() =>
          void controller
            .startExport()
        }
      />
    </SettingsShell>
  );
}

frontend/src/settings/pages/SettingsIndex.tsx

import {
  t,
} from '../language';
import type {
  SettingsPage,
  UiLanguage,
} from '../types';
interface SettingsIndexProps {
  language: UiLanguage;
  onNavigate:
    (
      page:
        Exclude<
          SettingsPage,
          'index'
        >,
    ) => void;
}
export function SettingsIndex({
  language,
  onNavigate,
}: SettingsIndexProps) {
  const entries:
    Array<{
      page:
        Exclude<
          SettingsPage,
          'index'
        >;
      label:
        | 'complexity'
        | 'sourceWeights'
        | 'diagnostic'
        | 'export';
    }> = [
      {
        page: 'complexity',
        label: 'complexity',
      },
      {
        page: 'sources',
        label: 'sourceWeights',
      },
      {
        page: 'diagnostic',
        label: 'diagnostic',
      },
      {
        page: 'export',
        label: 'export',
      },
    ];
  return (
    <nav
      className="settings-index"
      aria-label={
        t(
          language,
          'settings',
        )
      }
    >
      {entries.map(
        ({
          page,
          label,
        }) => (
          <button
            key={page}
            type="button"
            onClick={() =>
              onNavigate(page)
            }
          >
            <span>
              {t(
                language,
                label,
              )}
            </span>
            <span aria-hidden="true">
              ›
            </span>
          </button>
        ),
      )}
    </nav>
  );
}

frontend/src/settings/pages/ComplexityPage.tsx

import type {
  ChangeEvent,
} from 'react';
import {
  t,
} from '../language';
import type {
  SettingsDraft,
  UiLanguage,
} from '../types';
interface ComplexityPageProps {
  language: UiLanguage;
  draft: SettingsDraft;
  saving: boolean;
  error: boolean;
  onDraftChange:
    (
      draft:
        SettingsDraft,
    ) => void;
  onClearError:
    () => void;
  onSave:
    () => void;
}
export function ComplexityPage({
  language,
  draft,
  saving,
  error,
  onDraftChange,
  onClearError,
  onSave,
}: ComplexityPageProps) {
  return (
    <div className="settings-form">
      <label>
        <span>
          {t(
            language,
            'target',
          )}
        </span>
        <input
          type="number"
          min="0"
          max="100"
          step="0.1"
          value={
            draft.targetPercent
          }
          onChange={(
            event:
              ChangeEvent<HTMLInputElement>,
          ) => {
            onClearError();
            onDraftChange({
              ...draft,
              targetPercent:
                event.target.value,
            });
          }}
        />
      </label>
      <label>
        <span>
          {t(
            language,
            'spread',
          )}
        </span>
        <input
          type="number"
          min="0.000001"
          step="0.1"
          value={
            draft.spreadPercent
          }
          onChange={(
            event:
              ChangeEvent<HTMLInputElement>,
          ) => {
            onClearError();
            onDraftChange({
              ...draft,
              spreadPercent:
                event.target.value,
            });
          }}
        />
      </label>
      {error ? (
        <div className="settings-error">
          {t(
            language,
            'invalidValues',
          )}
        </div>
      ) : null}
      <button
        className="primary-action"
        type="button"
        disabled={saving}
        onClick={onSave}
      >
        {saving
          ? t(
              language,
              'saving',
            )
          : t(
              language,
              'save',
            )}
      </button>
    </div>
  );
}

frontend/src/settings/pages/SourceWeightsPage.tsx

import type {
  ChangeEvent,
} from 'react';
import {
  t,
} from '../language';
import {
  sourceDisplayName,
} from '../settings-utils';
import type {
  SettingsDraft,
  UiLanguage,
} from '../types';
interface SourceWeightsPageProps {
  language: UiLanguage;
  draft: SettingsDraft;
  saving: boolean;
  error: boolean;
  onDraftChange:
    (
      draft:
        SettingsDraft,
    ) => void;
  onClearError:
    () => void;
  onSave:
    () => void;
}
export function SourceWeightsPage({
  language,
  draft,
  saving,
  error,
  onDraftChange,
  onClearError,
  onSave,
}: SourceWeightsPageProps) {
  return (
    <div className="settings-form">
      {Object.keys(
        draft.sourceWeights,
      )
        .sort()
        .map((sourceId) => (
          <label key={sourceId}>
            <span>
              {sourceDisplayName(
                sourceId,
              )}
            </span>
            <input
              type="number"
              min="0"
              max="1"
              step="0.01"
              value={
                draft
                  .sourceWeights[
                  sourceId
                ] ?? ''
              }
              onChange={(
                event:
                  ChangeEvent<HTMLInputElement>,
              ) => {
                onClearError();
                onDraftChange({
                  ...draft,
                  sourceWeights: {
                    ...draft
                      .sourceWeights,
                    [sourceId]:
                      event
                        .target
                        .value,
                  },
                });
              }}
            />
          </label>
        ))}
      {error ? (
        <div className="settings-error">
          {t(
            language,
            'invalidValues',
          )}
        </div>
      ) : null}
      <button
        className="primary-action"
        type="button"
        disabled={saving}
        onClick={onSave}
      >
        {saving
          ? t(
              language,
              'saving',
            )
          : t(
              language,
              'save',
            )}
      </button>
    </div>
  );
}

frontend/src/settings/pages/DiagnosticPage.tsx

import type {
  ProfileStateResponse,
} from '../../../../shared/contracts';
import {
  buildDiagnosticRows,
  diagnosticLabel,
} from '../diagnostic';
import type {
  UiLanguage,
} from '../types';
interface DiagnosticPageProps {
  state: ProfileStateResponse;
  language: UiLanguage;
}
export function DiagnosticPage({
  state,
  language,
}: DiagnosticPageProps) {
  const rows =
    buildDiagnosticRows(
      state,
      language,
    );
  if (!rows) {
    return (
      <div className="diagnostic-empty">
        ...
      </div>
    );
  }
  return (
    <div className="diagnostic-table-wrap">
      <table className="diagnostic-table">
        <tbody>
          {rows.map(
            (row) => (
              <tr key={row.key}>
                <th scope="row">
                  {diagnosticLabel(
                    language,
                    row.key,
                  )}
                </th>
                <td>
                  {row.value}
                </td>
              </tr>
            ),
          )}
        </tbody>
      </table>
    </div>
  );
}

frontend/src/settings/pages/ExportPage.tsx

import type {
  ChangeEvent,
} from 'react';
import type {
  ExportResponse,
} from '../../../../shared/contracts';
import {
  downloadExportHtml,
} from '../../export-html';
import {
  t,
} from '../language';
import type {
  UiLanguage,
} from '../types';
interface ExportPageProps {
  language: UiLanguage;
  count: string;
  exporting: boolean;
  error: boolean;
  preparedExport:
    ExportResponse | null;
  onCountChange:
    (count: string) => void;
  onExport:
    () => void;
}
export function ExportPage({
  language,
  count,
  exporting,
  error,
  preparedExport,
  onCountChange,
  onExport,
}: ExportPageProps) {
  return (
    <div className="export-page">
      <input
        type="number"
        min="1"
        step="1"
        inputMode="numeric"
        aria-label={
          t(
            language,
            'count',
          )
        }
        placeholder={
          t(
            language,
            'count',
          )
        }
        value={count}
        disabled={exporting}
        onChange={(
          event:
            ChangeEvent<HTMLInputElement>,
        ) =>
          onCountChange(
            event.target.value,
          )
        }
      />
      <button
        className="primary-action"
        type="button"
        disabled={exporting}
        onClick={onExport}
      >
        {exporting
          ? t(
              language,
              'exporting',
            )
          : t(
              language,
              'export',
            )}
      </button>
      <button
        className="secondary-action"
        type="button"
        disabled={
          exporting ||
          preparedExport === null
        }
        onClick={() => {
          if (preparedExport) {
            downloadExportHtml(
              preparedExport,
            );
          }
        }}
      >
        {t(
          language,
          'download',
        )}
      </button>
      {preparedExport ? (
        <div
          className="export-ready"
          role="status"
        >
          {t(
            language,
            'ready',
          )}
          :{' '}
          {
            preparedExport
              .entries.length
          }
        </div>
      ) : null}
      {error ? (
        <div className="settings-error">
          {t(
            language,
            'invalidExport',
          )}
        </div>
      ) : null}
    </div>
  );
}

frontend/src/styles/base.css

:root {
  font-family:
    "Noto Sans Telugu",
    "Nirmala UI",
    "Gautami",
    sans-serif;
  color: #171717;
  background: #707070;
  font-synthesis: none;
  text-rendering: optimizeLegibility;
}
* {
  box-sizing: border-box;
}
html,
body,
#root {
  width: 100%;
  height: 100%;
  margin: 0;
  overflow: hidden;
}
button,
input {
  font: inherit;
}
button {
  -webkit-tap-highlight-color:
    transparent;
}
.app-shell {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 100dvh;
  overflow: hidden;
  background:
    radial-gradient(
      circle at 50% 35%,
      rgba(
        255,
        255,
        255,
        0.22
      ),
      transparent 42%
    ),
    linear-gradient(
      145deg,
      #9a9a9a 0%,
      #707070 48%,
      #515151 100%
    );
}
.control-icon {
  width: 1.35rem;
  height: 1.35rem;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.7;
  stroke-linecap: round;
  stroke-linejoin: round;
}

frontend/src/styles/profile.css

.entry-screen {
  position: fixed;
  inset: 0 auto auto 0;
  display: block;
  width: 100%;
  height:
    var(
      --entry-layout-height
    );
  min-height:
    var(
      --entry-layout-height
    );
  max-height:
    var(
      --entry-layout-height
    );
}
.entry-wrap {
  position: absolute;
  top: 50%;
  left: 50%;
  display: grid;
  place-items: center;
  gap: 0.8rem;
  transform:
    translate(
      -50%,
      -50%
    );
}
.profile-input {
  width:
    min(
      11rem,
      55vw
    );
  height: 2.5rem;
  padding: 0 1rem;
  border: 0;
  border-radius: 999px;
  outline: none;
  background:
    rgba(
      30,
      30,
      30,
      0.3
    );
  color:
    rgba(
      18,
      18,
      18,
      0.92
    );
  caret-color:
    rgba(
      18,
      18,
      18,
      0.92
    );
  box-shadow:
    0
    0.15rem
    0.7rem
    rgba(
      0,
      0,
      0,
      0.14
    );
  text-align: center;
  font-family:
    system-ui,
    sans-serif;
  font-size: 1.5rem;
  font-variant-numeric:
    tabular-nums;
  letter-spacing: 0.65rem;
  text-indent: 0.65rem;
}
.profile-input:focus {
  background:
    rgba(
      24,
      24,
      24,
      0.38
    );
  box-shadow:
    0
    0
    0
    1px
    rgba(
      20,
      20,
      20,
      0.12
    ),
    0
    0.18rem
    0.8rem
    rgba(
      0,
      0,
      0,
      0.16
    );
}
.telugu-error {
  min-height: 1.2rem;
  font-size: 0.92rem;
  line-height: 1.2rem;
  color:
    rgba(
      22,
      22,
      22,
      0.9
    );
  text-align: center;
}

frontend/src/styles/observation.css

.observation-screen {
  display: grid;
  grid-template-columns:
    minmax(
      3.5rem,
      16vw
    )
    1fr
    minmax(
      3.5rem,
      16vw
    );
  cursor: default;
}
.observation-center {
  z-index: 2;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-width: 0;
  min-height: 0;
  padding: 2rem 0.5rem;
  text-align: center;
}
.observation-text {
  width: 100%;
  max-width:
    min(
      82vw,
      70rem
    );
  line-height: 1.3;
  overflow-wrap: anywhere;
  user-select: none;
  transition:
    opacity
    80ms
    linear;
}
.observation-placeholder {
  color:
    rgba(
      20,
      20,
      20,
      0.55
    );
  font-family:
    system-ui,
    sans-serif;
  font-size:
    clamp(
      3rem,
      9vw,
      6rem
    );
  line-height: 1;
  letter-spacing: 0.15em;
  user-select: none;
}
.nav-zone,
.settings-trigger {
  opacity: 0;
  pointer-events: none;
  transition:
    opacity
      140ms
      ease,
    color
      140ms
      ease,
    background
      140ms
      ease;
}
.controls-visible
.nav-zone,
.controls-visible
.settings-trigger {
  opacity: 1;
  pointer-events: auto;
}
.nav-zone {
  z-index: 3;
  border: 0;
  background: transparent;
  color:
    rgba(
      20,
      20,
      20,
      0.46
    );
  font-family:
    system-ui,
    sans-serif;
  font-size:
    clamp(
      2.2rem,
      6vw,
      4rem
    );
  cursor: pointer;
}
.controls-visible
.nav-zone:disabled {
  opacity: 0.22;
  color:
    rgba(
      20,
      20,
      20,
      0.38
    );
  cursor: default;
}
.nav-zone:not(
  :disabled
):active {
  color:
    rgba(
      10,
      10,
      10,
      0.75
    );
}
.settings-trigger {
  position: absolute;
  z-index: 4;
  right:
    max(
      1rem,
      env(
        safe-area-inset-right
      )
    );
  bottom:
    max(
      1rem,
      env(
        safe-area-inset-bottom
      )
    );
  display: grid;
  place-items: center;
  width: 2.8rem;
  height: 2.8rem;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background:
    rgba(
      35,
      35,
      35,
      0.1
    );
  color:
    rgba(
      20,
      20,
      20,
      0.55
    );
  cursor: pointer;
}
.settings-trigger:active {
  background:
    rgba(
      35,
      35,
      35,
      0.18
    );
}
@media (
  max-width:
    600px
) {
  .observation-screen {
    grid-template-columns:
      13vw
      1fr
      13vw;
  }
}

frontend/src/styles/settings.css

.settings-screen {
  display: grid;
  grid-template-rows:
    auto
    minmax(
      0,
      1fr
    );
  overflow: hidden;
}
.settings-header {
  display: grid;
  grid-template-columns:
    3rem
    minmax(
      0,
      1fr
    )
    3rem;
  align-items: center;
  gap: 0.5rem;
  min-height: 4.25rem;
  padding:
    max(
      0.65rem,
      env(
        safe-area-inset-top
      )
    )
    max(
      0.75rem,
      env(
        safe-area-inset-right
      )
    )
    0.45rem
    max(
      0.75rem,
      env(
        safe-area-inset-left
      )
    );
  border-bottom:
    1px
    solid
    rgba(
      30,
      30,
      30,
      0.1
    );
}
.settings-header h1 {
  min-width: 0;
  margin: 0;
  color:
    rgba(
      20,
      20,
      20,
      0.88
    );
  text-align: center;
  font-size:
    clamp(
      1.15rem,
      4.8vw,
      1.55rem
    );
  font-weight: 600;
  overflow-wrap: anywhere;
}
.settings-header-side {
  display: flex;
  align-items: center;
  justify-content:
    flex-start;
}
.settings-header-side-right {
  justify-content: flex-end;
}
.settings-back,
.settings-close {
  display: grid;
  place-items: center;
  width: 2.8rem;
  height: 2.8rem;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color:
    rgba(
      20,
      20,
      20,
      0.62
    );
  font-family:
    system-ui,
    sans-serif;
  font-size: 2rem;
  line-height: 1;
  cursor: pointer;
}
.settings-back:active,
.settings-close:active,
.language-toggle:active {
  background:
    rgba(
      35,
      35,
      35,
      0.12
    );
}
.settings-page-content {
  width:
    min(
      52rem,
      100%
    );
  min-height: 0;
  margin: 0 auto;
  overflow: auto;
  padding:
    1rem
    max(
      1rem,
      env(
        safe-area-inset-right
      )
    )
    max(
      5.5rem,
      calc(
        env(
          safe-area-inset-bottom
        )
        + 4.5rem
      )
    )
    max(
      1rem,
      env(
        safe-area-inset-left
      )
    );
}
.settings-index {
  display: grid;
  overflow: hidden;
  border:
    1px
    solid
    rgba(
      30,
      30,
      30,
      0.11
    );
  border-radius: 1rem;
  background:
    rgba(
      255,
      255,
      255,
      0.12
    );
}
.settings-index button {
  display: flex;
  align-items: center;
  justify-content:
    space-between;
  gap: 1rem;
  min-height: 3.6rem;
  padding: 0.8rem 1rem;
  border: 0;
  border-bottom:
    1px
    solid
    rgba(
      30,
      30,
      30,
      0.09
    );
  background: transparent;
  color:
    rgba(
      20,
      20,
      20,
      0.88
    );
  text-align: left;
  cursor: pointer;
}
.settings-index
button:last-child {
  border-bottom: 0;
}
.settings-index
button:active {
  background:
    rgba(
      255,
      255,
      255,
      0.12
    );
}
.settings-index
button
span:last-child {
  color:
    rgba(
      20,
      20,
      20,
      0.4
    );
  font-family:
    system-ui,
    sans-serif;
  font-size: 1.65rem;
}
.settings-form,
.export-page {
  display: grid;
  gap: 1rem;
}
.settings-form label {
  display: grid;
  grid-template-columns:
    minmax(
      0,
      1fr
    )
    minmax(
      8rem,
      11rem
    );
  align-items: center;
  gap: 1rem;
}
.settings-form input,
.export-page input {
  width: 100%;
  min-width: 0;
  padding:
    0.7rem
    0.8rem;
  border:
    1px
    solid
    rgba(
      30,
      30,
      30,
      0.16
    );
  border-radius: 0.7rem;
  outline: none;
  background:
    rgba(
      255,
      255,
      255,
      0.25
    );
  color: #171717;
  font-family:
    system-ui,
    sans-serif;
}
.settings-form
input:focus,
.export-page
input:focus {
  border-color:
    rgba(
      20,
      20,
      20,
      0.34
    );
  background:
    rgba(
      255,
      255,
      255,
      0.38
    );
}
.primary-action,
.secondary-action {
  min-height: 2.8rem;
  padding:
    0.6rem
    1rem;
  border: 0;
  border-radius: 0.75rem;
  color:
    rgba(
      20,
      20,
      20,
      0.88
    );
  cursor: pointer;
}
.primary-action {
  background:
    rgba(
      30,
      30,
      30,
      0.16
    );
}
.secondary-action {
  background:
    rgba(
      255,
      255,
      255,
      0.2
    );
  box-shadow:
    inset
    0
    0
    0
    1px
    rgba(
      30,
      30,
      30,
      0.12
    );
}
.primary-action:disabled,
.secondary-action:disabled,
.export-page
input:disabled {
  opacity: 0.42;
  cursor: default;
}
.settings-error {
  color:
    rgba(
      80,
      15,
      15,
      0.9
    );
  font-size: 0.9rem;
}
.export-ready {
  color:
    rgba(
      20,
      20,
      20,
      0.68
    );
  font-size: 0.9rem;
}
.language-toggle {
  position: absolute;
  right:
    max(
      1rem,
      env(
        safe-area-inset-right
      )
    );
  bottom:
    max(
      1rem,
      env(
        safe-area-inset-bottom
      )
    );
  z-index: 4;
  display: grid;
  place-items: center;
  width: 3rem;
  height: 3rem;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background:
    rgba(
      35,
      35,
      35,
      0.1
    );
  color:
    rgba(
      20,
      20,
      20,
      0.55
    );
  cursor: pointer;
}
.diagnostic-empty {
  display: grid;
  min-height: 14rem;
  place-items: center;
  color:
    rgba(
      20,
      20,
      20,
      0.5
    );
  font-family:
    system-ui,
    sans-serif;
  font-size: 2rem;
}
.diagnostic-table-wrap {
  overflow-x: auto;
  border:
    1px
    solid
    rgba(
      30,
      30,
      30,
      0.11
    );
  border-radius: 0.9rem;
  background:
    rgba(
      255,
      255,
      255,
      0.13
    );
}
.diagnostic-table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
  color:
    rgba(
      20,
      20,
      20,
      0.78
    );
  font-family:
    ui-monospace,
    SFMono-Regular,
    Menlo,
    Consolas,
    monospace;
  font-size: 0.78rem;
  line-height: 1.45;
}
.diagnostic-table th,
.diagnostic-table td {
  padding:
    0.7rem
    0.75rem;
  border-bottom:
    1px
    solid
    rgba(
      30,
      30,
      30,
      0.08
    );
  vertical-align: top;
  overflow-wrap: anywhere;
}
.diagnostic-table
tr:last-child
th,
.diagnostic-table
tr:last-child
td {
  border-bottom: 0;
}
.diagnostic-table th {
  width: 46%;
  color:
    rgba(
      20,
      20,
      20,
      0.6
    );
  text-align: left;
  font-weight: 600;
}
.diagnostic-table td {
  width: 54%;
  font-variant-numeric:
    tabular-nums;
}
@media (
  max-width:
    600px
) {
  .settings-page-content {
    padding-inline: 0.8rem;
  }
  .settings-form label {
    grid-template-columns: 1fr;
    gap: 0.45rem;
  }
  .diagnostic-table {
    table-layout: auto;
  }
  .diagnostic-table th {
    width: 44%;
  }
  .diagnostic-table td {
    width: 56%;
  }
}

tests/repository-contract.test.ts

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  spawnSync,
} from 'node:child_process';
import test from 'node:test';
import {
  fileURLToPath,
} from 'node:url';
const root = path.resolve(
  path.dirname(
    fileURLToPath(
      import.meta.url,
    ),
  ),
  '..',
);
function read(
  relativePath: string,
): string {
  return fs.readFileSync(
    path.join(
      root,
      relativePath,
    ),
    'utf8',
  );
}
test(
  'Iteration 2 controller is control.sh with no stale control-project.sh surface',
  () => {
    const control =
      path.join(
        root,
        'control.sh',
      );
    assert.equal(
      fs.existsSync(control),
      true,
    );
    assert.equal(
      fs.existsSync(
        path.join(
          root,
          'control-project.sh',
        ),
      ),
      false,
    );
    assert.ok(
      (
        fs.statSync(
          control,
        ).mode &
        0o111
      ) !== 0,
      'control.sh should remain executable',
    );
    const syntax =
      spawnSync(
        'bash',
        [
          '-n',
          control,
        ],
        {
          encoding: 'utf8',
        },
      );
    assert.equal(
      syntax.status,
      0,
      syntax.stderr,
    );
    const readme =
      read('README.md');
    assert.equal(
      readme.includes(
        'control-project.sh',
      ),
      false,
    );
    assert.ok(
      readme.includes(
        './control.sh',
      ),
    );
    assert.equal(
      fs.existsSync(
        path.join(
          root,
          'VALIDATION.md',
        ),
      ),
      false,
    );
    assert.equal(
      readme.includes(
        'VALIDATION.md',
      ),
      false,
    );
  },
);
test(
  'Iteration 2 frontend is split by profile, observation, settings, and shared UI ownership',
  () => {
    const requiredFiles = [
      'frontend/src/components/icons.tsx',
      'frontend/src/profile/ProfileEntry.tsx',
      'frontend/src/profile/useProfileSession.ts',
      'frontend/src/observation/ObservationView.tsx',
      'frontend/src/observation/useObservationTypography.ts',
      'frontend/src/settings/types.ts',
      'frontend/src/settings/language.ts',
      'frontend/src/settings/settings-utils.ts',
      'frontend/src/settings/diagnostic.ts',
      'frontend/src/settings/SettingsShell.tsx',
      'frontend/src/settings/SettingsView.tsx',
      'frontend/src/settings/useSettingsController.ts',
      'frontend/src/settings/pages/SettingsIndex.tsx',
      'frontend/src/settings/pages/ComplexityPage.tsx',
      'frontend/src/settings/pages/SourceWeightsPage.tsx',
      'frontend/src/settings/pages/DiagnosticPage.tsx',
      'frontend/src/settings/pages/ExportPage.tsx',
      'frontend/src/styles/base.css',
      'frontend/src/styles/profile.css',
      'frontend/src/styles/observation.css',
      'frontend/src/styles/settings.css',
    ];
    for (
      const relativePath
      of requiredFiles
    ) {
      assert.equal(
        fs.existsSync(
          path.join(
            root,
            relativePath,
          ),
        ),
        true,
        `${relativePath} should exist`,
      );
    }
    const app =
      read(
        'frontend/src/App.tsx',
      );
    assert.ok(
      app.includes(
        "from './profile/ProfileEntry'",
      ),
    );
    assert.ok(
      app.includes(
        "from './profile/useProfileSession'",
      ),
    );
    assert.ok(
      app.includes(
        "from './observation/ObservationView'",
      ),
    );
    assert.ok(
      app.includes(
        "from './settings/SettingsView'",
      ),
    );
    assert.ok(
      app.includes(
        "from './settings/useSettingsController'",
      ),
    );
    assert.equal(
      app.includes(
        'settings-modal',
      ),
      false,
    );
    assert.equal(
      app.includes(
        'section-toggle',
      ),
      false,
    );
    assert.equal(
      app.includes(
        'className="diagnostic-table"',
      ),
      false,
    );
    assert.equal(
      app.includes(
        'chooseRandomObservationFont',
      ),
      false,
    );
    assert.ok(
      app.split('\n').length <
        100,
      'App.tsx should remain composition-focused',
    );
  },
);
test(
  'Iteration 2 Settings contract remains page-based with table diagnostics and two-stage export',
  () => {
    const settingsTypes =
      read(
        'frontend/src/settings/types.ts',
      );
    const settingsView =
      read(
        'frontend/src/settings/SettingsView.tsx',
      );
    const shell =
      read(
        'frontend/src/settings/SettingsShell.tsx',
      );
    const diagnosticPage =
      read(
        'frontend/src/settings/pages/DiagnosticPage.tsx',
      );
    const exportPage =
      read(
        'frontend/src/settings/pages/ExportPage.tsx',
      );
    const settingsController =
      read(
        'frontend/src/settings/useSettingsController.ts',
      );
    const styles =
      read(
        'frontend/src/styles/settings.css',
      );
    const readme =
      read('README.md');
    assert.ok(
      settingsTypes.includes(
        "| 'complexity'",
      ),
    );
    assert.ok(
      settingsTypes.includes(
        "| 'sources'",
      ),
    );
    assert.ok(
      settingsTypes.includes(
        "| 'diagnostic'",
      ),
    );
    assert.ok(
      settingsTypes.includes(
        "| 'export'",
      ),
    );
    assert.ok(
      settingsView.includes(
        '<SettingsIndex',
      ),
    );
    assert.ok(
      settingsView.includes(
        '<ComplexityPage',
      ),
    );
    assert.ok(
      settingsView.includes(
        '<SourceWeightsPage',
      ),
    );
    assert.ok(
      settingsView.includes(
        '<DiagnosticPage',
      ),
    );
    assert.ok(
      settingsView.includes(
        '<ExportPage',
      ),
    );
    assert.ok(
      shell.includes(
        'className="language-toggle"',
      ),
    );
    assert.ok(
      diagnosticPage.includes(
        'className="diagnostic-table"',
      ),
    );
    assert.ok(
      exportPage.includes(
        'downloadExportHtml(preparedExport)',
      ),
    );
    assert.ok(
      settingsController.includes(
        'preparedExport',
      ),
    );
    assert.ok(
      settingsController.includes(
        'setPreparedExport(null)',
      ),
    );
    assert.ok(
      styles.includes(
        '.settings-screen',
      ),
    );
    assert.ok(
      styles.includes(
        '.diagnostic-table',
      ),
    );
    assert.equal(
      readme.includes(
        'collapsed settings modal',
      ),
      false,
    );
    assert.equal(
      readme.includes(
        'collapsed sections',
      ),
      false,
    );
    assert.ok(
      readme.includes(
        'full-page Settings',
      ),
    );
    assert.ok(
      readme.includes(
        'Export first generates the batch',
      ),
    );
  },
);
test(
  'Iteration 2 presentation alterations remain monochrome, keyboard-stable, and activation-randomized after modularization',
  () => {
    const icons =
      read(
        'frontend/src/components/icons.tsx',
      );
    const profileEntry =
      read(
        'frontend/src/profile/ProfileEntry.tsx',
      );
    const observationView =
      read(
        'frontend/src/observation/ObservationView.tsx',
      );
    const typography =
      read(
        'frontend/src/observation/useObservationTypography.ts',
      );
    const presentation =
      read(
        'frontend/src/presentation.ts',
      );
    const baseStyles =
      read(
        'frontend/src/styles/base.css',
      );
    const profileStyles =
      read(
        'frontend/src/styles/profile.css',
      );
    const observationStyles =
      read(
        'frontend/src/styles/observation.css',
      );
    const html =
      read(
        'frontend/index.html',
      );
    assert.ok(
      icons.includes(
        'export function SettingsIcon',
      ),
    );
    assert.ok(
      icons.includes(
        'export function LanguageIcon',
      ),
    );
    assert.equal(
      icons.includes('⚙'),
      false,
    );
    assert.equal(
      icons.includes('🌐'),
      false,
    );
    assert.ok(
      baseStyles.includes(
        'stroke: currentColor',
      ),
    );
    assert.ok(
      profileEntry.includes(
        "'--entry-layout-height'",
      ),
    );
    assert.ok(
      profileStyles.includes(
        'height: var(--entry-layout-height)',
      ),
    );
    assert.ok(
      observationView.includes(
        '<SettingsIcon />',
      ),
    );
    assert.ok(
      observationView.includes(
        'className="observation-placeholder"',
      ),
    );
    assert.ok(
      observationView.includes(
        'useObservationTypography(observation)',
      ),
    );
    assert.ok(
      typography.includes(
        'chooseRandomObservationFont()',
      ),
    );
    assert.ok(
      typography.includes(
        'presentation.observationId',
      ),
    );
    assert.ok(
      typography.includes(
        'preferredObservationFontSizePx(',
      ),
    );
    assert.ok(
      typography.includes(
        'document.fonts.load(',
      ),
    );
    assert.ok(
      observationStyles.includes(
        '.controls-visible .nav-zone',
      ),
    );
    assert.ok(
      observationStyles.includes(
        '.nav-zone:disabled',
      ),
    );
    assert.ok(
      observationStyles.includes(
        '.settings-trigger',
      ),
    );
    assert.ok(
      observationStyles.includes(
        'bottom:',
      ),
    );
    for (
      const family of [
        'Noto Sans Telugu',
        'Noto Serif Telugu',
        'Mandali',
        'Ramabhadra',
        'NTR',
        'Peddana',
        'Ramaraja',
        'Sree Krushnadevaraya',
        'Suranna',
        'Tenali Ramakrishna',
      ]
    ) {
      assert.ok(
        presentation.includes(
          `'${family}'`,
        ),
      );
    }
    assert.ok(
      html.includes(
        'fonts.googleapis.com/css2?',
      ),
    );
    assert.ok(
      html.includes(
        'Tenali+Ramakrishna',
      ),
    );
  },
);