import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  ProfileSelectionSettings,
  ProfileStateResponse,
  SelectionSnapshot,
} from '../../shared/contracts';
import {
  generateExport,
  getProfileState,
  loadProfile,
  navigate,
  setVisibility,
  updateSelectionSettings,
} from './api';
import { downloadExportHtml } from './export-html';
import './styles.css';

type SettingsSection = 'complexity' | 'sources' | 'diagnostic' | 'export';

interface SettingsDraft {
  targetPercent: string;
  spreadPercent: string;
  sourceWeights: Record<string, string>;
}

function formatTime(timestamp: number | null): string {
  if (timestamp === null) return '—';
  return new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(4)}%`;
}

function formatNumber(value: number): string {
  if (value === 0) return '0';
  if (Math.abs(value) < 0.000001) return value.toExponential(6);
  return value.toFixed(8).replace(/0+$/, '').replace(/\.$/, '');
}

function draftFromSettings(settings: ProfileSelectionSettings): SettingsDraft {
  return {
    targetPercent: String(settings.complexityPercentileTarget * 100),
    spreadPercent: String(settings.complexityPercentileSpread * 100),
    sourceWeights: Object.fromEntries(
      Object.entries(settings.sourceWeights).map(([sourceId, weight]) => [sourceId, String(weight)]),
    ),
  };
}

function sourceDisplayName(sourceId: string): string {
  const match = /^source(\d+)$/.exec(sourceId);
  return match?.[1] ?? sourceId;
}

function SelectionDiagnosticView({ selection }: { selection: SelectionSnapshot }) {
  return (
    <>
      <div>source weights {JSON.stringify(selection.sourceWeights)}</div>
      <div>source {selection.sourceId}</div>
      <div>source rows {selection.sourceRowCount}</div>
      <div>source weight {selection.sourceWeight}</div>
      <div>source mass {formatNumber(selection.sourceMass)}</div>
      <div>total source mass {formatNumber(selection.totalSourceMass)}</div>
      <div>source probability {formatPercent(selection.sourceProbability)}</div>
      <div>row {selection.sourceKey}</div>
      <div>word count {selection.wordCount}</div>
      <div>complexity reference v{selection.complexityReferenceVersion}</div>
      <div>complexity target {formatPercent(selection.complexityPercentileTarget)}</div>
      <div>complexity spread ±{formatPercent(selection.complexityPercentileSpread)}</div>
      <div>derived sigma {formatNumber(selection.derivedStandardDeviation)}</div>
      <div>
        global percentile interval {formatPercent(selection.globalPercentileStart)}–{formatPercent(selection.globalPercentileEnd)}
      </div>
      <div>global interval mass {formatNumber(selection.globalIntervalMass)}</div>
      <div>global rows at word count {selection.globalRowsAtWordCount}</div>
      <div>global per-row complexity mass {formatNumber(selection.globalPerRowComplexityMass)}</div>
      <div>source rows at word count {selection.selectedSourceRowsAtWordCount}</div>
      <div>source complexity denominator {formatNumber(selection.selectedSourceNormalizationDenominator)}</div>
      <div>row probability within source {formatPercent(selection.rowProbabilityWithinSource)}</div>
      <div>overall probability {formatPercent(selection.overallProbability)}</div>
    </>
  );
}

function Diagnostic({ state }: { state: ProfileStateResponse }) {
  const diagnostic = state.currentObservation?.diagnostic;
  if (!diagnostic) return <div className="diagnostic-empty">—</div>;

  return (
    <div className="diagnostic" aria-hidden="true">
      <div>acquisition #{diagnostic.acquisitionNumber}</div>
      <div>
        {diagnostic.triggerKind === 'initial-fill'
          ? 'initial fill'
          : `triggered by acquisition #${diagnostic.triggeredByAcquisitionNumber ?? '—'} / history #${diagnostic.triggeredByHistoryPosition ?? '—'}`}
      </div>
      <div>trigger {formatTime(diagnostic.triggeredAt)}</div>
      <div>waiting ahead {diagnostic.waitingAheadAtTrigger}</div>
      <div>preparation in flight {diagnostic.preparationInFlightAtTrigger ? 'yes' : 'no'}</div>
      <div>cache hit {diagnostic.cacheHit === null ? '—' : diagnostic.cacheHit ? 'yes' : 'no'}</div>
      <div>request start {formatTime(diagnostic.requestStartedAt)}</div>
      <div>request end {formatTime(diagnostic.requestCompletedAt)}</div>
      <div>request duration {diagnostic.requestDurationMs ?? '—'} ms</div>
      {diagnostic.selection ? <SelectionDiagnosticView selection={diagnostic.selection} /> : <div>selection snapshot legacy/unavailable</div>}
    </div>
  );
}


export function App() {
  const [codeInput, setCodeInput] = useState('');
  const [profileCode, setProfileCode] = useState<string | null>(null);
  const [state, setState] = useState<ProfileStateResponse | null>(null);
  const [invalidCode, setInvalidCode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [expanded, setExpanded] = useState<Record<SettingsSection, boolean>>({
    complexity: false,
    sources: false,
    diagnostic: false,
    export: false,
  });
  const [draft, setDraft] = useState<SettingsDraft | null>(null);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsError, setSettingsError] = useState(false);
  const [exportCount, setExportCount] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState(false);
  const activeCodeRef = useRef<string | null>(null);

  useEffect(() => {
    activeCodeRef.current = profileCode;
  }, [profileCode]);

  useEffect(() => {
    if (!profileCode) return;

    let cancelled = false;
    const refresh = async () => {
      try {
        const next = await getProfileState(profileCode, document.visibilityState === 'visible');
        if (!cancelled) setState(next);
      } catch {
        // Keep the last known state. The next poll will retry.
      }
    };

    void refresh();
    const interval = window.setInterval(() => void refresh(), 1_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [profileCode]);

  useEffect(() => {
    const onVisibility = () => {
      const code = activeCodeRef.current;
      if (!code) return;
      void setVisibility(code, { visible: document.visibilityState === 'visible' });
    };

    const onPageHide = () => {
      const code = activeCodeRef.current;
      if (!code) return;
      const body = new Blob([JSON.stringify({ visible: false })], { type: 'application/json' });
      navigator.sendBeacon(`/api/profiles/${code}/visibility`, body);
    };

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, []);

  const canBack = Boolean(state?.canBack) && !busy;
  const canNext = Boolean(state?.canNext) && !busy;

  const observationStyle = useMemo(() => {
    const length = state?.currentObservation?.text.length ?? 0;
    const size = length <= 8
      ? 'clamp(4rem, 13vw, 10rem)'
      : length <= 36
        ? 'clamp(2.8rem, 8vw, 6rem)'
        : 'clamp(2rem, 5.5vw, 4.4rem)';
    return { fontSize: size };
  }, [state?.currentObservation?.text]);

  const submitCode = async (value: string) => {
    if (!/^\d{3}$/.test(value)) return;
    setBusy(true);
    setInvalidCode(false);
    try {
      const loaded = await loadProfile({
        code: value,
        visible: document.visibilityState === 'visible',
      });
      setProfileCode(value);
      setState(loaded);
      setControlsVisible(false);
    } catch {
      setInvalidCode(true);
      setCodeInput('');
    } finally {
      setBusy(false);
    }
  };

  const move = async (direction: 'back' | 'next') => {
    if (!profileCode) return;
    setBusy(true);
    try {
      const next = await navigate(profileCode, direction, {
        visible: document.visibilityState === 'visible',
      });
      setState(next);
      setControlsVisible(false);
    } catch {
      // Polling refreshes readiness/state; no English error is exposed to the user.
    } finally {
      setBusy(false);
    }
  };

  const openSettings = () => {
    if (!state) return;
    setDraft(draftFromSettings(state.selectionSettings));
    setExpanded({ complexity: false, sources: false, diagnostic: false, export: false });
    setSettingsError(false);
    setExportError(false);
    setSettingsOpen(true);
  };

  const toggleSection = (section: SettingsSection) => {
    setExpanded((current) => ({ ...current, [section]: !current[section] }));
  };

  const saveSettings = async () => {
    if (!profileCode || !draft || !state) return;
    const target = Number(draft.targetPercent) / 100;
    const spread = Number(draft.spreadPercent) / 100;
    const sourceWeights = Object.fromEntries(
      Object.entries(draft.sourceWeights).map(([sourceId, value]) => [sourceId, Number(value)]),
    );
    const weights = Object.values(sourceWeights);
    const valid = Number.isFinite(target)
      && target >= 0
      && target <= 1
      && Number.isFinite(spread)
      && spread > 0
      && weights.length > 0
      && weights.every((value) => Number.isFinite(value) && value >= 0 && value <= 1)
      && Math.max(...weights) === 1;

    if (!valid) {
      setSettingsError(true);
      return;
    }

    setSettingsSaving(true);
    setSettingsError(false);
    try {
      const saved = await updateSelectionSettings(profileCode, {
        sourceWeights,
        complexityPercentileTarget: target,
        complexityPercentileSpread: spread,
      });
      setState((current) => current ? { ...current, selectionSettings: saved } : current);
      setDraft(draftFromSettings(saved));
    } catch {
      setSettingsError(true);
    } finally {
      setSettingsSaving(false);
    }
  };

  const startExport = async () => {
    if (!profileCode) return;
    const count = Number(exportCount);
    if (!Number.isInteger(count) || count <= 0) {
      setExportError(true);
      return;
    }

    setExporting(true);
    setExportError(false);
    try {
      const result = await generateExport(profileCode, { count });
      downloadExportHtml(result);
    } catch {
      setExportError(true);
    } finally {
      setExporting(false);
    }
  };

  if (!profileCode) {
    return (
      <main className="app-shell entry-screen">
        <div className="entry-wrap">
          <input
            className="profile-input"
            aria-label="ప్రొఫైల్ కోడ్"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={3}
            value={codeInput}
            onChange={(event) => {
              const next = event.target.value.replace(/\D/g, '').slice(0, 3);
              setCodeInput(next);
              setInvalidCode(false);
              if (next.length === 3) void submitCode(next);
            }}
          />
          <div className="telugu-error" role={invalidCode ? 'status' : undefined}>
            {invalidCode ? 'చెల్లని కోడ్' : '\u00A0'}
          </div>
        </div>
      </main>
    );
  }

  return (
    <main
      className={`app-shell observation-screen ${controlsVisible ? 'controls-visible' : ''}`}
      onClick={() => {
        if (!settingsOpen) setControlsVisible((visible) => !visible);
      }}
    >
      <button
        className="nav-zone nav-zone-left"
        type="button"
        aria-label="వెనుక"
        disabled={!canBack}
        onClick={(event) => {
          event.stopPropagation();
          void move('back');
        }}
      >
        ‹
      </button>

      <section className="observation-center">
        {state?.currentObservation ? (
          <div className="observation-text" style={observationStyle}>
            {state.currentObservation.text}
          </div>
        ) : null}
      </section>

      <button
        className="nav-zone nav-zone-right"
        type="button"
        aria-label="తర్వాత"
        disabled={!canNext}
        onClick={(event) => {
          event.stopPropagation();
          void move('next');
        }}
      >
        ›
      </button>

      <button
        className="settings-trigger"
        type="button"
        aria-label="సెట్టింగులు"
        onClick={(event) => {
          event.stopPropagation();
          openSettings();
        }}
      >
        ⚙
      </button>

      {settingsOpen && state && draft ? (
        <div className="settings-backdrop" onClick={(event) => event.stopPropagation()}>
          <section className="settings-modal" role="dialog" aria-modal="true" aria-label="సెట్టింగులు">
            <button
              className="modal-close"
              type="button"
              aria-label="మూసివేయి"
              onClick={() => setSettingsOpen(false)}
            >
              ×
            </button>

            <div className="settings-sections">
              <div className="settings-section">
                <button className="section-toggle" type="button" onClick={() => toggleSection('complexity')}>
                  <span>సంక్లిష్టత</span><span>{expanded.complexity ? '⌃' : '⌄'}</span>
                </button>
                {expanded.complexity ? (
                  <div className="section-body settings-fields">
                    <label>
                      <span>లక్ష్యం (%)</span>
                      <input
                        type="number"
                        min="0"
                        max="100"
                        step="0.1"
                        value={draft.targetPercent}
                        onChange={(event) => setDraft((current) => current ? { ...current, targetPercent: event.target.value } : current)}
                      />
                    </label>
                    <label>
                      <span>వ్యాప్తి (%)</span>
                      <input
                        type="number"
                        min="0.000001"
                        step="0.1"
                        value={draft.spreadPercent}
                        onChange={(event) => setDraft((current) => current ? { ...current, spreadPercent: event.target.value } : current)}
                      />
                    </label>
                  </div>
                ) : null}
              </div>

              <div className="settings-section">
                <button className="section-toggle" type="button" onClick={() => toggleSection('sources')}>
                  <span>మూల బరువులు</span><span>{expanded.sources ? '⌃' : '⌄'}</span>
                </button>
                {expanded.sources ? (
                  <div className="section-body settings-fields">
                    {Object.keys(draft.sourceWeights).sort().map((sourceId) => (
                      <label key={sourceId}>
                        <span>{sourceDisplayName(sourceId)}</span>
                        <input
                          type="number"
                          min="0"
                          max="1"
                          step="0.01"
                          value={draft.sourceWeights[sourceId] ?? ''}
                          onChange={(event) => setDraft((current) => current ? {
                            ...current,
                            sourceWeights: { ...current.sourceWeights, [sourceId]: event.target.value },
                          } : current)}
                        />
                      </label>
                    ))}
                  </div>
                ) : null}
              </div>

              <div className="settings-section">
                <button className="section-toggle" type="button" onClick={() => toggleSection('diagnostic')}>
                  <span>నిర్ధారణ</span><span>{expanded.diagnostic ? '⌃' : '⌄'}</span>
                </button>
                {expanded.diagnostic ? (
                  <div className="section-body diagnostic-wrap">
                    <Diagnostic state={state} />
                  </div>
                ) : null}
              </div>

              <div className="settings-section">
                <button className="section-toggle" type="button" onClick={() => toggleSection('export')}>
                  <span>ఎగుమతి</span><span>{expanded.export ? '⌃' : '⌄'}</span>
                </button>
                {expanded.export ? (
                  <div className="section-body export-fields">
                    <input
                      type="number"
                      min="1"
                      step="1"
                      inputMode="numeric"
                      aria-label="సంఖ్య"
                      placeholder="సంఖ్య"
                      value={exportCount}
                      disabled={exporting}
                      onChange={(event) => {
                        setExportCount(event.target.value);
                        setExportError(false);
                      }}
                    />
                    <button type="button" disabled={exporting} onClick={() => void startExport()}>
                      {exporting ? 'సిద్ధమవుతోంది…' : 'దింపు'}
                    </button>
                    {exportError ? <div className="settings-error">చెల్లని విలువ లేదా ఎగుమతి విఫలమైంది</div> : null}
                  </div>
                ) : null}
              </div>
            </div>

            <div className="settings-footer">
              {settingsError ? <div className="settings-error">చెల్లని విలువలు</div> : null}
              <button type="button" disabled={settingsSaving} onClick={() => void saveSettings()}>
                {settingsSaving ? 'భద్రపరుస్తోంది…' : 'భద్రపరచు'}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
