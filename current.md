frontend/index.html

<!doctype html>
<html lang="te">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <meta name="theme-color" content="#707070" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      rel="stylesheet"
      href="https://fonts.googleapis.com/css2?family=Mandali&family=NTR&family=Noto+Sans+Telugu:wght@400;600&family=Noto+Serif+Telugu:wght@400;600&family=Peddana&family=Ramabhadra&family=Ramaraja&family=Sree+Krushnadevaraya&family=Suranna&family=Tenali+Ramakrishna&display=swap"
    />
    <title>తెలుగు</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>

frontend/src/presentation.ts

export const OBSERVATION_FONTS = [
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
] as const;
export type ObservationFontFamily = (typeof OBSERVATION_FONTS)[number];
function clamp(minimum: number, maximum: number, value: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
export function chooseRandomObservationFont(
  random: () => number = Math.random,
): ObservationFontFamily {
  const raw = random();
  const normalized = Number.isFinite(raw)
    ? clamp(0, 0.9999999999999999, raw)
    : 0;
  const index = Math.floor(normalized * OBSERVATION_FONTS.length);
  return OBSERVATION_FONTS[index];
}
export function preferredObservationFontSizePx(
  text: string,
  containerWidth: number,
  containerHeight: number,
): number {
  const normalized = text.trim().replace(/\s+/g, ' ');
  if (!normalized) return 64;
  const words = normalized.split(' ').length;
  const nonWhitespaceCharacters = Array.from(
    normalized.replace(/\s/g, ''),
  ).length;
  const contentLoad = Math.max(
    1,
    words + nonWhitespaceCharacters / 12,
  );
  const heightBase = clamp(112, 160, containerHeight * 0.28);
  const widthScale = clamp(0.86, 1.08, containerWidth / 650);
  const size = (heightBase * widthScale) / Math.pow(contentLoad, 0.33);
  return clamp(24, 160, size);
}

frontend/src/App.tsx

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { ExportResponse, ProfileSelectionSettings, ProfileStateResponse, SelectionSnapshot, } from '../../shared/contracts';
import { generateExport, getProfileState, loadProfile, navigate, setVisibility, updateSelectionSettings, } from './api';
import { downloadExportHtml } from './export-html';
import { chooseRandomObservationFont, preferredObservationFontSizePx, type ObservationFontFamily } from './presentation';
import './styles.css';
type SettingsPage = 'index' | 'complexity' | 'sources' | 'diagnostic' | 'export';
type UiLanguage = 'en' | 'te';
interface SettingsDraft {
    targetPercent: string;
    spreadPercent: string;
    sourceWeights: Record<string, string>;
}
interface DiagnosticRow {
    key: string;
    value: string;
}
const SETTINGS_LANGUAGE_KEY = 'telugu-now-settings-language';
const COPY = {
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
        invalidValues: 'Invalid values',
        count: 'Count',
        exporting: 'Exporting…',
        download: 'Download',
        ready: 'Ready',
        invalidExport: 'Invalid count or export failed',
        close: 'Close',
        back: 'Back',
        language: 'Switch language',
        yes: 'Yes',
        no: 'No',
        unavailable: 'Unavailable',
        initialFill: 'Initial fill',
        observationConsumed: 'Observation consumed',
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
        invalidValues: 'చెల్లని విలువలు',
        count: 'సంఖ్య',
        exporting: 'ఎగుమతి అవుతోంది…',
        download: 'డౌన్‌లోడ్',
        ready: 'సిద్ధం',
        invalidExport: 'చెల్లని సంఖ్య లేదా ఎగుమతి విఫలమైంది',
        close: 'మూసివేయి',
        back: 'వెనుక',
        language: 'భాష మార్చు',
        yes: 'అవును',
        no: 'కాదు',
        unavailable: 'అందుబాటులో లేదు',
        initialFill: 'ప్రారంభ నింపుదల',
        observationConsumed: 'పరిశీలన వినియోగం',
    },
} as const;
const DIAGNOSTIC_LABELS = {
    acquisitionNumber: { en: 'Acquisition', te: 'సేకరణ' },
    triggerKind: { en: 'Trigger kind', te: 'ట్రిగర్ రకం' },
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
    triggeredAt: { en: 'Trigger time', te: 'ట్రిగర్ సమయం' },
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
type DiagnosticLabelKey = keyof typeof DIAGNOSTIC_LABELS;
function t(language: UiLanguage, key: keyof typeof COPY.en): string {
    return COPY[language][key];
}
function diagnosticLabel(language: UiLanguage, key: DiagnosticLabelKey): string {
    return DIAGNOSTIC_LABELS[key][language];
}
function formatTime(timestamp: number | null): string {
    if (timestamp === null)
        return '—';
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
    if (value === 0)
        return '0';
    if (Math.abs(value) < 0.000001) {
        return value.toExponential(6);
    }
    return value
        .toFixed(8)
        .replace(/0+$/, '')
        .replace(/\.$/, '');
}
function draftFromSettings(settings: ProfileSelectionSettings): SettingsDraft {
    return {
        targetPercent: String(settings.complexityPercentileTarget * 100),
        spreadPercent: String(settings.complexityPercentileSpread * 100),
        sourceWeights: Object.fromEntries(
            Object.entries(settings.sourceWeights).map(([sourceId, weight]) => [
                sourceId,
                String(weight),
            ]),
        ),
    };
}
function sourceDisplayName(sourceId: string): string {
    const match = /^source(\d+)$/.exec(sourceId);
    return match?.[1] ?? sourceId;
}
function formatSourceWeights(weights: Record<string, number>): string {
    return Object.entries(weights)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([sourceId, weight]) => `${sourceDisplayName(sourceId)}: ${formatNumber(weight)}`)
        .join(' · ');
}
function selectionRows(selection: SelectionSnapshot): DiagnosticRow[] {
    return [
        {
            key: 'sourceWeights',
            value: formatSourceWeights(selection.sourceWeights),
        },
        {
            key: 'sourceId',
            value: selection.sourceId,
        },
        {
            key: 'sourceRowCount',
            value: String(selection.sourceRowCount),
        },
        {
            key: 'sourceWeight',
            value: formatNumber(selection.sourceWeight),
        },
        {
            key: 'sourceMass',
            value: formatNumber(selection.sourceMass),
        },
        {
            key: 'totalSourceMass',
            value: formatNumber(selection.totalSourceMass),
        },
        {
            key: 'sourceProbability',
            value: formatPercent(selection.sourceProbability),
        },
        {
            key: 'sourceKey',
            value: selection.sourceKey,
        },
        {
            key: 'wordCount',
            value: String(selection.wordCount),
        },
        {
            key: 'complexityReferenceVersion',
            value: `v${selection.complexityReferenceVersion}`,
        },
        {
            key: 'complexityPercentileTarget',
            value: formatPercent(selection.complexityPercentileTarget),
        },
        {
            key: 'complexityPercentileSpread',
            value: `±${formatPercent(selection.complexityPercentileSpread)}`,
        },
        {
            key: 'derivedStandardDeviation',
            value: formatNumber(selection.derivedStandardDeviation),
        },
        {
            key: 'globalPercentileInterval',
            value: `${formatPercent(selection.globalPercentileStart)}–${formatPercent(selection.globalPercentileEnd)}`,
        },
        {
            key: 'globalIntervalMass',
            value: formatNumber(selection.globalIntervalMass),
        },
        {
            key: 'globalRowsAtWordCount',
            value: String(selection.globalRowsAtWordCount),
        },
        {
            key: 'globalPerRowComplexityMass',
            value: formatNumber(selection.globalPerRowComplexityMass),
        },
        {
            key: 'selectedSourceRowsAtWordCount',
            value: String(selection.selectedSourceRowsAtWordCount),
        },
        {
            key: 'selectedSourceNormalizationDenominator',
            value: formatNumber(selection.selectedSourceNormalizationDenominator),
        },
        {
            key: 'rowProbabilityWithinSource',
            value: formatPercent(selection.rowProbabilityWithinSource),
        },
        {
            key: 'overallProbability',
            value: formatPercent(selection.overallProbability),
        },
    ];
}
function DiagnosticTable({
    state,
    language,
}: {
    state: ProfileStateResponse;
    language: UiLanguage;
}) {
    const diagnostic = state.currentObservation?.diagnostic;
    if (!diagnostic) {
        return (
            <div className="diagnostic-empty">
                ...
            </div>
        );
    }
    const rows: DiagnosticRow[] = [
        {
            key: 'acquisitionNumber',
            value: `#${diagnostic.acquisitionNumber}`,
        },
        {
            key: 'triggerKind',
            value: diagnostic.triggerKind === 'initial-fill'
                ? t(language, 'initialFill')
                : t(language, 'observationConsumed'),
        },
        {
            key: 'triggeredByObservationId',
            value: diagnostic.triggeredByObservationId ?? '—',
        },
        {
            key: 'triggeredByAcquisitionNumber',
            value: diagnostic.triggeredByAcquisitionNumber === null
                ? '—'
                : `#${diagnostic.triggeredByAcquisitionNumber}`,
        },
        {
            key: 'triggeredByHistoryPosition',
            value: diagnostic.triggeredByHistoryPosition === null
                ? '—'
                : String(diagnostic.triggeredByHistoryPosition),
        },
        {
            key: 'triggeredAt',
            value: formatTime(diagnostic.triggeredAt),
        },
        {
            key: 'waitingAheadAtTrigger',
            value: String(diagnostic.waitingAheadAtTrigger),
        },
        {
            key: 'preparationInFlightAtTrigger',
            value: diagnostic.preparationInFlightAtTrigger
                ? t(language, 'yes')
                : t(language, 'no'),
        },
        {
            key: 'cacheHit',
            value: diagnostic.cacheHit === null
                ? '—'
                : diagnostic.cacheHit
                    ? t(language, 'yes')
                    : t(language, 'no'),
        },
        {
            key: 'requestStartedAt',
            value: formatTime(diagnostic.requestStartedAt),
        },
        {
            key: 'requestCompletedAt',
            value: formatTime(diagnostic.requestCompletedAt),
        },
        {
            key: 'requestDurationMs',
            value: diagnostic.requestDurationMs === null
                ? '—'
                : `${diagnostic.requestDurationMs} ms`,
        },
    ];
    if (diagnostic.selection) {
        rows.push(...selectionRows(diagnostic.selection));
    } else {
        rows.push({
            key: 'selectionSnapshot',
            value: t(language, 'unavailable'),
        });
    }
    return (
        <div className="diagnostic-table-wrap">
            <table className="diagnostic-table">
                <tbody>
                    {rows.map((row) => (
                        <tr key={row.key}>
                            <th scope="row">
                                {diagnosticLabel(
                                    language,
                                    row.key as DiagnosticLabelKey,
                                )}
                            </th>
                            <td>{row.value}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
function SettingsIcon() {
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
function LanguageIcon() {
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
function SettingsShell({
    language,
    title,
    onBack,
    onClose,
    onToggleLanguage,
    children,
}: {
    language: UiLanguage;
    title: string;
    onBack?: () => void;
    onClose: () => void;
    onToggleLanguage: () => void;
    children: ReactNode;
}) {
    return (
        <main className="app-shell settings-screen">
            <header className="settings-header">
                <div className="settings-header-side">
                    {onBack ? (
                        <button
                            className="settings-back"
                            type="button"
                            aria-label={t(language, 'back')}
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
                        aria-label={t(language, 'close')}
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
                aria-label={t(language, 'language')}
                onClick={onToggleLanguage}
            >
                <LanguageIcon />
            </button>
        </main>
    );
}
export function App() {
    const [codeInput, setCodeInput] = useState('');
    const [profileCode, setProfileCode] = useState<string | null>(null);
    const [state, setState] = useState<ProfileStateResponse | null>(null);
    const [invalidCode, setInvalidCode] = useState(false);
    const [busy, setBusy] = useState(false);
    const [controlsVisible, setControlsVisible] = useState(false);
    const [settingsPage, setSettingsPage] = useState<SettingsPage | null>(null);
    const [settingsLanguage, setSettingsLanguage] = useState<UiLanguage>('te');
    const [draft, setDraft] = useState<SettingsDraft | null>(null);
    const [settingsSaving, setSettingsSaving] = useState(false);
    const [settingsError, setSettingsError] = useState(false);
    const [exportCount, setExportCount] = useState('');
    const [exporting, setExporting] = useState(false);
    const [exportError, setExportError] = useState(false);
    const [preparedExport, setPreparedExport] = useState<ExportResponse | null>(null);
    const activeCodeRef = useRef<string | null>(null);
    const settingsOpenRef = useRef(false);
    const settingsOpen = settingsPage !== null;
    const entryLayoutHeightRef = useRef<number>(window.innerHeight);
    const observationCenterRef = useRef<HTMLElement | null>(null);
    const observationTextRef = useRef<HTMLDivElement | null>(null);
    const [observationPresentation, setObservationPresentation] = useState<{
        observationId: string | null;
        fontFamily: ObservationFontFamily;
    }>({
        observationId: null,
        fontFamily: chooseRandomObservationFont(),
    });
    const [observationFontSizePx, setObservationFontSizePx] = useState(64);
    const [typographyReady, setTypographyReady] = useState(false);
    useEffect(() => {
        activeCodeRef.current = profileCode;
    }, [profileCode]);
    useEffect(() => {
        settingsOpenRef.current = settingsOpen;
    }, [settingsOpen]);
    useEffect(() => {
        const stored = window.localStorage.getItem(SETTINGS_LANGUAGE_KEY);
        if (stored === 'en' || stored === 'te') {
            setSettingsLanguage(stored);
        }
    }, []);
    useEffect(() => {
        if (!profileCode)
            return;
        let cancelled = false;
        const refresh = async () => {
            try {
                const observationVisible =
                    document.visibilityState === 'visible' &&
                    !settingsOpen;
                const next = await getProfileState(
                    profileCode,
                    observationVisible,
                );
                if (!cancelled) {
                    setState(next);
                }
            } catch {
                // Keep the last known state.
                // The next poll will retry.
            }
        };
        void refresh();
        const interval = window.setInterval(
            () => void refresh(),
            1000,
        );
        return () => {
            cancelled = true;
            window.clearInterval(interval);
        };
    }, [profileCode, settingsOpen]);
    useEffect(() => {
        const onVisibility = () => {
            const code = activeCodeRef.current;
            if (!code)
                return;
            void setVisibility(code, {
                visible:
                    document.visibilityState === 'visible' &&
                    !settingsOpenRef.current,
            });
        };
        const onPageHide = () => {
            const code = activeCodeRef.current;
            if (!code)
                return;
            const body = new Blob(
                [
                    JSON.stringify({
                        visible: false,
                    }),
                ],
                {
                    type: 'application/json',
                },
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
    const canBack = Boolean(state?.canBack) && !busy;
    const canNext = Boolean(state?.canNext) && !busy;
    useEffect(() => {
        const observationId = state?.currentObservation?.id ?? null;
        if (settingsOpen)
            return;
        if (observationId === observationPresentation.observationId)
            return;
        setObservationPresentation({
            observationId,
            fontFamily: chooseRandomObservationFont(),
        });
    }, [
        state?.currentObservation?.id,
        settingsOpen,
        observationPresentation.observationId,
    ]);
    useLayoutEffect(() => {
        const observation = state?.currentObservation;
        const container = observationCenterRef.current;
        const element = observationTextRef.current;
        if (!observation || !container || !element || settingsOpen)
            return;
        let cancelled = false;
        let resizeObserver: ResizeObserver | null = null;
        const fit = async () => {
            setTypographyReady(false);
            const containerRect = container.getBoundingClientRect();
            const availableHeight = Math.max(
                1,
                containerRect.height - 64,
            );
            const desired = preferredObservationFontSizePx(
                observation.text,
                containerRect.width,
                availableHeight,
            );
            try {
                await document.fonts.load(
                    `400 ${Math.max(24, desired)}px "${observationPresentation.fontFamily}"`,
                    observation.text.slice(0, 64),
                );
            } catch {
                // Fallback fonts remain usable if a webfont cannot be loaded.
            }
            if (cancelled)
                return;
            let low = 12;
            let high = desired;
            let best = Math.min(low, desired);
            for (let iteration = 0; iteration < 10; iteration += 1) {
                const candidate = (low + high) / 2;
                element.style.fontSize = `${candidate}px`;
                const fitsWidth =
                    element.scrollWidth <=
                    element.clientWidth + 1;
                const fitsHeight =
                    element.scrollHeight <=
                    availableHeight + 1;
                if (fitsWidth && fitsHeight) {
                    best = candidate;
                    low = candidate;
                } else {
                    high = candidate;
                }
            }
            const finalSize = Math.max(
                12,
                Math.min(desired, best),
            );
            element.style.fontSize = `${finalSize}px`;
            setObservationFontSizePx(finalSize);
            setTypographyReady(true);
        };
        void fit();
        resizeObserver = new ResizeObserver(() => {
            void fit();
        });
        resizeObserver.observe(container);
        return () => {
            cancelled = true;
            resizeObserver?.disconnect();
        };
    }, [
        state?.currentObservation?.id,
        state?.currentObservation?.text,
        observationPresentation.fontFamily,
        settingsOpen,
    ]);
    const observationStyle: CSSProperties = {
        fontFamily:
            `"${observationPresentation.fontFamily}", ` +
            `"Noto Sans Telugu", "Nirmala UI", sans-serif`,
        fontSize: `${observationFontSizePx}px`,
        opacity: typographyReady ? 1 : 0,
    };
    const submitCode = async (value: string) => {
        if (!/^\d{3}$/.test(value)) {
            return;
        }
        setBusy(true);
        setInvalidCode(false);
        try {
            const loaded = await loadProfile({
                code: value,
                visible:
                    document.visibilityState ===
                    'visible',
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
    const move = async (
        direction: 'back' | 'next',
    ) => {
        if (!profileCode)
            return;
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
            setControlsVisible(false);
        } catch {
            // Polling refreshes readiness/state.
        } finally {
            setBusy(false);
        }
    };
    const openSettings = () => {
        if (!profileCode || !state) {
            return;
        }
        setDraft(
            draftFromSettings(
                state.selectionSettings,
            ),
        );
        setSettingsError(false);
        setExportError(false);
        setSettingsPage('index');
        void setVisibility(profileCode, {
            visible: false,
        });
    };
    const closeSettings = () => {
        if (!profileCode)
            return;
        const observationId =
            state?.currentObservation?.id ??
            null;
        setObservationPresentation({
            observationId,
            fontFamily: chooseRandomObservationFont(),
        });
        setSettingsPage(null);
        setSettingsError(false);
        setExportError(false);
        void setVisibility(profileCode, {
            visible:
                document.visibilityState ===
                'visible',
        });
    };
    const enterSettingsPage = (
        page: Exclude<SettingsPage, 'index'>,
    ) => {
        if (
            state &&
            (
                page === 'complexity' ||
                page === 'sources'
            )
        ) {
            setDraft(
                draftFromSettings(
                    state.selectionSettings,
                ),
            );
        }
        setSettingsError(false);
        setExportError(false);
        setSettingsPage(page);
    };
    const backToSettingsIndex = () => {
        setSettingsError(false);
        setExportError(false);
        setSettingsPage('index');
    };
    const toggleSettingsLanguage = () => {
        setSettingsLanguage((current) => {
            const next =
                current === 'te'
                    ? 'en'
                    : 'te';
            window.localStorage.setItem(
                SETTINGS_LANGUAGE_KEY,
                next,
            );
            return next;
        });
    };
    const saveComplexitySettings = async () => {
        if (
            !profileCode ||
            !draft ||
            !state
        ) {
            return;
        }
        const target =
            Number(draft.targetPercent) /
            100;
        const spread =
            Number(draft.spreadPercent) /
            100;
        const valid =
            Number.isFinite(target) &&
            target >= 0 &&
            target <= 1 &&
            Number.isFinite(spread) &&
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
                            state.selectionSettings
                                .sourceWeights,
                        complexityPercentileTarget:
                            target,
                        complexityPercentileSpread:
                            spread,
                    },
                );
            setState((current) =>
                current
                    ? {
                        ...current,
                        selectionSettings: saved,
                    }
                    : current,
            );
            setDraft(
                draftFromSettings(saved),
            );
            setPreparedExport(null);
        } catch {
            setSettingsError(true);
        } finally {
            setSettingsSaving(false);
        }
    };
    const saveSourceSettings = async () => {
        if (
            !profileCode ||
            !draft ||
            !state
        ) {
            return;
        }
        const sourceWeights =
            Object.fromEntries(
                Object.entries(
                    draft.sourceWeights,
                ).map(
                    ([sourceId, value]) => [
                        sourceId,
                        Number(value),
                    ],
                ),
            );
        const weights =
            Object.values(sourceWeights);
        const valid =
            weights.length > 0 &&
            weights.every(
                (value) =>
                    Number.isFinite(value) &&
                    value >= 0 &&
                    value <= 1,
            ) &&
            Math.max(...weights) === 1;
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
                            state.selectionSettings
                                .complexityPercentileTarget,
                        complexityPercentileSpread:
                            state.selectionSettings
                                .complexityPercentileSpread,
                    },
                );
            setState((current) =>
                current
                    ? {
                        ...current,
                        selectionSettings: saved,
                    }
                    : current,
            );
            setDraft(
                draftFromSettings(saved),
            );
            setPreparedExport(null);
        } catch {
            setSettingsError(true);
        } finally {
            setSettingsSaving(false);
        }
    };
    const startExport = async () => {
        if (!profileCode)
            return;
        const count = Number(exportCount);
        if (
            !Number.isInteger(count) ||
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
                    {
                        count,
                    },
                );
            setPreparedExport(result);
        } catch {
            setExportError(true);
        } finally {
            setExporting(false);
        }
    };
    if (!profileCode) {
        return (
            <main
                className="app-shell entry-screen"
                style={{
                    '--entry-layout-height':
                        `${entryLayoutHeightRef.current}px`,
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
                        onChange={(event) => {
                            const next =
                                event.target.value
                                    .replace(/\D/g, '')
                                    .slice(0, 3);
                            setCodeInput(next);
                            setInvalidCode(false);
                            if (next.length === 3) {
                                void submitCode(next);
                            }
                        }}
                    />
                    <div
                        className="telugu-error"
                        role={
                            invalidCode
                                ? 'status'
                                : undefined
                        }
                    >
                        {invalidCode
                            ? 'చెల్లని కోడ్'
                            : '\u00A0'}
                    </div>
                </div>
            </main>
        );
    }
    if (
        settingsPage &&
        state &&
        draft
    ) {
        const common = {
            language: settingsLanguage,
            onClose: closeSettings,
            onToggleLanguage:
                toggleSettingsLanguage,
        };
        if (settingsPage === 'index') {
            return (
                <SettingsShell
                    {...common}
                    title={t(
                        settingsLanguage,
                        'settings',
                    )}
                >
                    <nav
                        className="settings-index"
                        aria-label={t(
                            settingsLanguage,
                            'settings',
                        )}
                    >
                        <button
                            type="button"
                            onClick={() =>
                                enterSettingsPage(
                                    'complexity',
                                )
                            }
                        >
                            <span>
                                {t(
                                    settingsLanguage,
                                    'complexity',
                                )}
                            </span>
                            <span aria-hidden="true">
                                ›
                            </span>
                        </button>
                        <button
                            type="button"
                            onClick={() =>
                                enterSettingsPage(
                                    'sources',
                                )
                            }
                        >
                            <span>
                                {t(
                                    settingsLanguage,
                                    'sourceWeights',
                                )}
                            </span>
                            <span aria-hidden="true">
                                ›
                            </span>
                        </button>
                        <button
                            type="button"
                            onClick={() =>
                                enterSettingsPage(
                                    'diagnostic',
                                )
                            }
                        >
                            <span>
                                {t(
                                    settingsLanguage,
                                    'diagnostic',
                                )}
                            </span>
                            <span aria-hidden="true">
                                ›
                            </span>
                        </button>
                        <button
                            type="button"
                            onClick={() =>
                                enterSettingsPage(
                                    'export',
                                )
                            }
                        >
                            <span>
                                {t(
                                    settingsLanguage,
                                    'export',
                                )}
                            </span>
                            <span aria-hidden="true">
                                ›
                            </span>
                        </button>
                    </nav>
                </SettingsShell>
            );
        }
        if (settingsPage === 'complexity') {
            return (
                <SettingsShell
                    {...common}
                    title={t(
                        settingsLanguage,
                        'complexity',
                    )}
                    onBack={
                        backToSettingsIndex
                    }
                >
                    <div className="settings-form">
                        <label>
                            <span>
                                {t(
                                    settingsLanguage,
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
                                onChange={(event) => {
                                    setSettingsError(
                                        false,
                                    );
                                    setDraft(
                                        (current) =>
                                            current
                                                ? {
                                                    ...current,
                                                    targetPercent:
                                                        event.target.value,
                                                }
                                                : current,
                                    );
                                }}
                            />
                        </label>
                        <label>
                            <span>
                                {t(
                                    settingsLanguage,
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
                                onChange={(event) => {
                                    setSettingsError(
                                        false,
                                    );
                                    setDraft(
                                        (current) =>
                                            current
                                                ? {
                                                    ...current,
                                                    spreadPercent:
                                                        event.target.value,
                                                }
                                                : current,
                                    );
                                }}
                            />
                        </label>
                        {settingsError ? (
                            <div className="settings-error">
                                {t(
                                    settingsLanguage,
                                    'invalidValues',
                                )}
                            </div>
                        ) : null}
                        <button
                            className="primary-action"
                            type="button"
                            disabled={settingsSaving}
                            onClick={() =>
                                void saveComplexitySettings()
                            }
                        >
                            {settingsSaving
                                ? t(
                                    settingsLanguage,
                                    'saving',
                                )
                                : t(
                                    settingsLanguage,
                                    'save',
                                )}
                        </button>
                    </div>
                </SettingsShell>
            );
        }
        if (settingsPage === 'sources') {
            return (
                <SettingsShell
                    {...common}
                    title={t(
                        settingsLanguage,
                        'sourceWeights',
                    )}
                    onBack={
                        backToSettingsIndex
                    }
                >
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
                                        onChange={(event) => {
                                            setSettingsError(
                                                false,
                                            );
                                            setDraft(
                                                (current) =>
                                                    current
                                                        ? {
                                                            ...current,
                                                            sourceWeights:
                                                            {
                                                                ...current.sourceWeights,
                                                                [sourceId]:
                                                                    event.target.value,
                                                            },
                                                        }
                                                        : current,
                                            );
                                        }}
                                    />
                                </label>
                            ))}
                        {settingsError ? (
                            <div className="settings-error">
                                {t(
                                    settingsLanguage,
                                    'invalidValues',
                                )}
                            </div>
                        ) : null}
                        <button
                            className="primary-action"
                            type="button"
                            disabled={settingsSaving}
                            onClick={() =>
                                void saveSourceSettings()
                            }
                        >
                            {settingsSaving
                                ? t(
                                    settingsLanguage,
                                    'saving',
                                )
                                : t(
                                    settingsLanguage,
                                    'save',
                                )}
                        </button>
                    </div>
                </SettingsShell>
            );
        }
        if (settingsPage === 'diagnostic') {
            return (
                <SettingsShell
                    {...common}
                    title={t(
                        settingsLanguage,
                        'diagnostic',
                    )}
                    onBack={
                        backToSettingsIndex
                    }
                >
                    <DiagnosticTable
                        state={state}
                        language={
                            settingsLanguage
                        }
                    />
                </SettingsShell>
            );
        }
        return (
            <SettingsShell
                {...common}
                title={t(
                    settingsLanguage,
                    'export',
                )}
                onBack={
                    backToSettingsIndex
                }
            >
                <div className="export-page">
                    <input
                        type="number"
                        min="1"
                        step="1"
                        inputMode="numeric"
                        aria-label={t(
                            settingsLanguage,
                            'count',
                        )}
                        placeholder={t(
                            settingsLanguage,
                            'count',
                        )}
                        value={exportCount}
                        disabled={exporting}
                        onChange={(event) => {
                            setExportCount(
                                event.target.value,
                            );
                            setPreparedExport(
                                null,
                            );
                            setExportError(
                                false,
                            );
                        }}
                    />
                    <button
                        className="primary-action"
                        type="button"
                        disabled={exporting}
                        onClick={() =>
                            void startExport()
                        }
                    >
                        {exporting
                            ? t(
                                settingsLanguage,
                                'exporting',
                            )
                            : t(
                                settingsLanguage,
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
                            settingsLanguage,
                            'download',
                        )}
                    </button>
                    {preparedExport ? (
                        <div
                            className="export-ready"
                            role="status"
                        >
                            {t(
                                settingsLanguage,
                                'ready',
                            )}
                            :{' '}
                            {
                                preparedExport
                                    .entries.length
                            }
                        </div>
                    ) : null}
                    {exportError ? (
                        <div className="settings-error">
                            {t(
                                settingsLanguage,
                                'invalidExport',
                            )}
                        </div>
                    ) : null}
                </div>
            </SettingsShell>
        );
    }
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
                onClick={(event) => {
                    event.stopPropagation();
                    if (canBack) {
                        void move('back');
                    }
                }}
            >
                ‹
            </button>
            <section
                ref={observationCenterRef}
                className="observation-center"
            >
                {state?.currentObservation ? (
                    <div
                        ref={observationTextRef}
                        className="observation-text"
                        style={observationStyle}
                    >
                        {
                            state
                                .currentObservation
                                .text
                        }
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
                onClick={(event) => {
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
                onClick={(event) => {
                    event.stopPropagation();
                    openSettings();
                }}
            >
                <SettingsIcon />
            </button>
        </main>
    );
}

frontend/src/styles.css

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
  -webkit-tap-highlight-color: transparent;
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
      rgba(255, 255, 255, 0.22),
      transparent 42%
    ),
    linear-gradient(
      145deg,
      #9a9a9a 0%,
      #707070 48%,
      #515151 100%
    );
}
.entry-screen {
  position: fixed;
  inset: 0 auto auto 0;
  display: block;
  width: 100%;
  height: var(--entry-layout-height);
  min-height: var(--entry-layout-height);
  max-height: var(--entry-layout-height);
}
.entry-wrap {
  position: absolute;
  top: 50%;
  left: 50%;
  display: grid;
  place-items: center;
  gap: 0.8rem;
  transform: translate(-50%, -50%);
}
.profile-input {
  width: min(11rem, 55vw);
  height: 2.5rem;
  padding: 0 1rem;
  border: 0;
  border-radius: 999px;
  outline: none;
  background: rgba(30, 30, 30, 0.3);
  color: rgba(18, 18, 18, 0.92);
  caret-color: rgba(18, 18, 18, 0.92);
  box-shadow:
    0 0.15rem 0.7rem
    rgba(0, 0, 0, 0.14);
  text-align: center;
  font-family:
    system-ui,
    sans-serif;
  font-size: 1.5rem;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.65rem;
  text-indent: 0.65rem;
}
.profile-input:focus {
  background:
    rgba(24, 24, 24, 0.38);
  box-shadow:
    0 0 0 1px
      rgba(20, 20, 20, 0.12),
    0 0.18rem 0.8rem
      rgba(0, 0, 0, 0.16);
}
.telugu-error {
  min-height: 1.2rem;
  font-size: 0.92rem;
  line-height: 1.2rem;
  color: rgba(22, 22, 22, 0.9);
  text-align: center;
}
.observation-screen {
  display: grid;
  grid-template-columns:
    minmax(3.5rem, 16vw)
    1fr
    minmax(3.5rem, 16vw);
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
  max-width: min(82vw, 70rem);
  line-height: 1.3;
  overflow-wrap: anywhere;
  user-select: none;
  transition: opacity 80ms linear;
}
.observation-placeholder {
  color: rgba(20, 20, 20, 0.55);
  font-family:
    system-ui,
    sans-serif;
  font-size:
    clamp(3rem, 9vw, 6rem);
  line-height: 1;
  letter-spacing: 0.15em;
  user-select: none;
}
.nav-zone,
.settings-trigger {
  opacity: 0;
  pointer-events: none;
  transition:
    opacity 140ms ease,
    color 140ms ease,
    background 140ms ease;
}
.controls-visible .nav-zone,
.controls-visible .settings-trigger {
  opacity: 1;
  pointer-events: auto;
}
.nav-zone {
  z-index: 3;
  border: 0;
  background: transparent;
  color:
    rgba(20, 20, 20, 0.46);
  font-family:
    system-ui,
    sans-serif;
  font-size:
    clamp(2.2rem, 6vw, 4rem);
  cursor: pointer;
}
.controls-visible
.nav-zone:disabled {
  opacity: 0.22;
  color:
    rgba(20, 20, 20, 0.38);
  cursor: default;
}
.nav-zone:not(:disabled):active {
  color:
    rgba(10, 10, 10, 0.75);
}
.settings-trigger {
  position: absolute;
  z-index: 4;
  right:
    max(
      1rem,
      env(safe-area-inset-right)
    );
  bottom:
    max(
      1rem,
      env(safe-area-inset-bottom)
    );
  display: grid;
  place-items: center;
  width: 2.8rem;
  height: 2.8rem;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background:
    rgba(35, 35, 35, 0.1);
  color:
    rgba(20, 20, 20, 0.55);
  cursor: pointer;
}
.settings-trigger:active {
  background:
    rgba(35, 35, 35, 0.18);
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
.settings-screen {
  display: grid;
  grid-template-rows:
    auto minmax(0, 1fr);
  overflow: hidden;
}
.settings-header {
  display: grid;
  grid-template-columns:
    3rem minmax(0, 1fr) 3rem;
  align-items: center;
  gap: 0.5rem;
  min-height: 4.25rem;
  padding:
    max(
      0.65rem,
      env(safe-area-inset-top)
    )
    max(
      0.75rem,
      env(safe-area-inset-right)
    )
    0.45rem
    max(
      0.75rem,
      env(safe-area-inset-left)
    );
  border-bottom:
    1px solid
    rgba(30, 30, 30, 0.1);
}
.settings-header h1 {
  min-width: 0;
  margin: 0;
  color:
    rgba(20, 20, 20, 0.88);
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
  justify-content: flex-start;
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
    rgba(20, 20, 20, 0.62);
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
    rgba(35, 35, 35, 0.12);
}
.settings-page-content {
  width: min(52rem, 100%);
  min-height: 0;
  margin: 0 auto;
  overflow: auto;
  padding:
    1rem
    max(
      1rem,
      env(safe-area-inset-right)
    )
    max(
      5.5rem,
      calc(
        env(safe-area-inset-bottom)
        + 4.5rem
      )
    )
    max(
      1rem,
      env(safe-area-inset-left)
    );
}
.settings-index {
  display: grid;
  overflow: hidden;
  border:
    1px solid
    rgba(30, 30, 30, 0.11);
  border-radius: 1rem;
  background:
    rgba(255, 255, 255, 0.12);
}
.settings-index button {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  min-height: 3.6rem;
  padding: 0.8rem 1rem;
  border: 0;
  border-bottom:
    1px solid
    rgba(30, 30, 30, 0.09);
  background: transparent;
  color:
    rgba(20, 20, 20, 0.88);
  text-align: left;
  cursor: pointer;
}
.settings-index button:last-child {
  border-bottom: 0;
}
.settings-index button:active {
  background:
    rgba(255, 255, 255, 0.12);
}
.settings-index
button span:last-child {
  color:
    rgba(20, 20, 20, 0.4);
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
    minmax(0, 1fr)
    minmax(8rem, 11rem);
  align-items: center;
  gap: 1rem;
}
.settings-form input,
.export-page input {
  width: 100%;
  min-width: 0;
  padding: 0.7rem 0.8rem;
  border:
    1px solid
    rgba(30, 30, 30, 0.16);
  border-radius: 0.7rem;
  outline: none;
  background:
    rgba(255, 255, 255, 0.25);
  color: #171717;
  font-family:
    system-ui,
    sans-serif;
}
.settings-form input:focus,
.export-page input:focus {
  border-color:
    rgba(20, 20, 20, 0.34);
  background:
    rgba(255, 255, 255, 0.38);
}
.primary-action,
.secondary-action {
  min-height: 2.8rem;
  padding: 0.6rem 1rem;
  border: 0;
  border-radius: 0.75rem;
  color:
    rgba(20, 20, 20, 0.88);
  cursor: pointer;
}
.primary-action {
  background:
    rgba(30, 30, 30, 0.16);
}
.secondary-action {
  background:
    rgba(255, 255, 255, 0.2);
  box-shadow:
    inset 0 0 0 1px
    rgba(30, 30, 30, 0.12);
}
.primary-action:disabled,
.secondary-action:disabled,
.export-page input:disabled {
  opacity: 0.42;
  cursor: default;
}
.settings-error {
  color:
    rgba(80, 15, 15, 0.9);
  font-size: 0.9rem;
}
.export-ready {
  color:
    rgba(20, 20, 20, 0.68);
  font-size: 0.9rem;
}
.language-toggle {
  position: absolute;
  right:
    max(
      1rem,
      env(safe-area-inset-right)
    );
  bottom:
    max(
      1rem,
      env(safe-area-inset-bottom)
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
    rgba(35, 35, 35, 0.1);
  color:
    rgba(20, 20, 20, 0.55);
  cursor: pointer;
}
.diagnostic-empty {
  display: grid;
  min-height: 14rem;
  place-items: center;
  color:
    rgba(20, 20, 20, 0.5);
  font-family:
    system-ui,
    sans-serif;
  font-size: 2rem;
}
.diagnostic-table-wrap {
  overflow-x: auto;
  border:
    1px solid
    rgba(30, 30, 30, 0.11);
  border-radius: 0.9rem;
  background:
    rgba(255, 255, 255, 0.13);
}
.diagnostic-table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
  color:
    rgba(20, 20, 20, 0.78);
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
  padding: 0.7rem 0.75rem;
  border-bottom:
    1px solid
    rgba(30, 30, 30, 0.08);
  vertical-align: top;
  overflow-wrap: anywhere;
}
.diagnostic-table
tr:last-child th,
.diagnostic-table
tr:last-child td {
  border-bottom: 0;
}
.diagnostic-table th {
  width: 46%;
  color:
    rgba(20, 20, 20, 0.6);
  text-align: left;
  font-weight: 600;
}
.diagnostic-table td {
  width: 54%;
  font-variant-numeric:
    tabular-nums;
}
@media (max-width: 600px) {
  .observation-screen {
    grid-template-columns:
      13vw 1fr 13vw;
  }
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

tests/presentation.test.ts

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  OBSERVATION_FONTS,
  chooseRandomObservationFont,
  preferredObservationFontSizePx,
} from '../frontend/src/presentation';
test('observation font collection is the fixed curated Telugu set', () => {
  assert.deepEqual(OBSERVATION_FONTS, [
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
  ]);
});
test('random font selection maps the full random interval onto the curated collection', () => {
  assert.equal(chooseRandomObservationFont(() => 0), 'Noto Sans Telugu');
  assert.equal(chooseRandomObservationFont(() => 0.099999), 'Noto Sans Telugu');
  assert.equal(chooseRandomObservationFont(() => 0.1), 'Noto Serif Telugu');
  assert.equal(chooseRandomObservationFont(() => 0.999999), 'Tenali Ramakrishna');
});
test('preferred font size decreases smoothly as observation content grows', () => {
  const width = 700;
  const height = 700;
  const short = preferredObservationFontSizePx(
    'తెలుగు',
    width,
    height,
  );
  const medium = preferredObservationFontSizePx(
    'తెలుగు భాషలో కొన్ని పదాలు కలిసి ఒక వాక్యంగా కనిపిస్తున్నాయి',
    width,
    height,
  );
  const long = preferredObservationFontSizePx(
    Array.from(
      { length: 40 },
      (_, index) => `పదం${index + 1}`,
    ).join(' '),
    width,
    height,
  );
  assert.ok(short > medium);
  assert.ok(medium > long);
  assert.ok(long >= 24);
  assert.ok(short <= 160);
});
test('preferred font size responds to available observation width without buckets', () => {
  const text =
    'ఇది ఒక మధ్యస్థ పొడవు గల తెలుగు పరిశీలన వాక్యం';
  const narrow =
    preferredObservationFontSizePx(
      text,
      240,
      700,
    );
  const wide =
    preferredObservationFontSizePx(
      text,
      900,
      700,
    );
  assert.ok(wide > narrow);
});

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
    fileURLToPath(import.meta.url),
  ),
  '..',
);
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
        fs.statSync(control).mode &
        0o111
      ) !== 0,
      'control.sh should remain executable',
    );
    const syntax =
      spawnSync(
        'bash',
        ['-n', control],
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
      fs.readFileSync(
        path.join(
          root,
          'README.md',
        ),
        'utf8',
      );
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
  'Iteration 2 frontend contract uses Settings pages, table diagnostics, and two-stage export',
  () => {
    const app =
      fs.readFileSync(
        path.join(
          root,
          'frontend/src/App.tsx',
        ),
        'utf8',
      );
    const styles =
      fs.readFileSync(
        path.join(
          root,
          'frontend/src/styles.css',
        ),
        'utf8',
      );
    const readme =
      fs.readFileSync(
        path.join(
          root,
          'README.md',
        ),
        'utf8',
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
    assert.ok(
      app.includes(
        "type SettingsPage = 'index' | 'complexity' | 'sources' | 'diagnostic' | 'export'",
      ),
    );
    assert.ok(
      app.includes(
        'className="diagnostic-table"',
      ),
    );
    assert.ok(
      app.includes(
        'className="language-toggle"',
      ),
    );
    assert.ok(
      app.includes(
        'className="observation-placeholder"',
      ),
    );
    assert.ok(
      app.includes(
        'preparedExport',
      ),
    );
    assert.ok(
      app.includes(
        'downloadExportHtml(',
      ),
    );
    assert.ok(
      styles.includes(
        '.controls-visible',
      ),
    );
    assert.ok(
      styles.includes(
        '.nav-zone:disabled',
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
  'Iteration 2 presentation alterations keep controls monochrome, entry position stable, and typography activation-based',
  () => {
    const app =
      fs.readFileSync(
        path.join(
          root,
          'frontend/src/App.tsx',
        ),
        'utf8',
      );
    const styles =
      fs.readFileSync(
        path.join(
          root,
          'frontend/src/styles.css',
        ),
        'utf8',
      );
    const html =
      fs.readFileSync(
        path.join(
          root,
          'frontend/index.html',
        ),
        'utf8',
      );
    const presentation =
      fs.readFileSync(
        path.join(
          root,
          'frontend/src/presentation.ts',
        ),
        'utf8',
      );
    assert.ok(
      app.includes(
        '<SettingsIcon />',
      ),
    );
    assert.ok(
      app.includes(
        '<LanguageIcon />',
      ),
    );
    assert.equal(
      app.includes('⚙'),
      false,
    );
    assert.equal(
      app.includes('🌐'),
      false,
    );
    assert.equal(
      (
        app.match(
          /chooseRandomObservationFont\(\)/g,
        ) ?? []
      ).length,
      3,
    );
    assert.ok(
      app.includes(
        'observationPresentation.observationId',
      ),
    );
    assert.ok(
      app.includes(
        'preferredObservationFontSizePx(',
      ),
    );
    assert.ok(
      app.includes(
        'document.fonts.load(',
      ),
    );
    assert.ok(
      app.includes(
        "'--entry-layout-height'",
      ),
    );
    assert.ok(
      styles.includes(
        '.settings-trigger',
      ),
    );
    assert.ok(
      styles.includes(
        'bottom:',
      ),
    );
    assert.ok(
      styles.includes(
        '.control-icon',
      ),
    );
    assert.ok(
      styles.includes(
        'stroke: currentColor',
      ),
    );
    assert.ok(
      styles.includes(
        'height: var(--entry-layout-height)',
      ),
    );
    assert.ok(
      styles.includes(
        '.observation-text',
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

README.md

# Implementation Iteration 2
This repository contains Implementation Iteration 2 of the Telugu observation app. Iteration 1's persistent history/timing model, ten-item future queue, continuous one-for-one replenishment, sequential live preparation, and SQLite persistence remain the foundation.
Iteration 2 adds the source/complexity selection engine, persistent profile settings, repeatable source-record caching, tap-revealed controls, full-page Settings navigation, bilingual Settings labels, structured diagnostics, activation-time randomized Telugu typography, and standalone batch export. The actual external Telugu datasets are still mocked by three deterministic local sources.
## Stack
- TypeScript
- React + Vite
- Hono + Node.js
- SQLite (`better-sqlite3`)
## Project controller
The root `control.sh` is the normal development entry point.
Install dependencies on a new checkout:
```bash
./control.sh deps --option install

Once a package-lock.json exists, dependency installation uses npm ci. An installed dependency tree can be reinstalled with:

./control.sh deps --option reinstall

Start development:

./control.sh dev

Choose start. Development runs in the foreground with normal Vite/Hono output attached to the terminal; Ctrl+C stops it. A second terminal can run ./control.sh dev and choose stop to terminate the running dev process group.

The browser app is served by Vite on port 5173. The Hono API runs on 127.0.0.1:8787. Vite binds to 0.0.0.0 so development-container/Codespaces forwarding can expose the UI.

The configured prototype profile code is 001.

Build and tests

./control.sh build --option start
./control.sh test --option start

The test suite preserves the accepted Iteration 1 queue/history/timing invariants and adds checks for Iteration 2 catalogs, global percentile calibration, canonical source weights, probability snapshots, repeats, settings isolation, shared source-record caching, batch export isolation, migration from the accepted Iteration 1 schema, numerical edge cases in the normal-distribution selector, standalone export behavior, and the control.sh repository contract.

Selection is also checked against an independently implemented numerical probability oracle, a deterministic 100-selection black-box audit, injected random-number boundary cases, and a seeded 50,000-selection Monte Carlo comparison against the full expected source+row distribution.

The frontend contract tests guard page-based Settings, mapping-table diagnostics, the ... empty observation state, permanently positioned revealed navigation arrows, two-stage Export/Download behavior, monochrome application-rendered Settings/language controls, the stable profile-entry viewport anchor, and the curated observation-font collection. Presentation tests independently verify deterministic boundaries of the random font selector and the continuous length-based preferred-size function.

Deterministic dummy sources

Iteration 2 has exactly three selectable dummy sources:

* source1: 12 rows
* source2: 24 rows
* source3: 36 rows

Their literal Telugu rows live under server/src/sources/dummy/data/. Each row has a stable source key.

The fixture lengths were sampled once from fixed-seed right-skewed distributions and then committed literally; they are never regenerated at runtime. source1 is shorter on average, source2 is moderate, and source3 is longer and broader.

Across the 72 rows the current committed fixture spans 1 through 40 words, so the complexity system is not shaped around a six-word mock ceiling.

An uncached dummy source retrieval waits 1–15 seconds by default. The delay can be overridden in the environment for local testing.

Source selection

Each profile stores one source weight per selectable source. Every weight is in [0,1], and at least one weight must be exactly 1; configurations with every weight below 1 are rejected rather than normalized.

For source i, with N_i selectable rows and profile weight w_i:

source mass = N_i * w_i
P(source i) = (N_i * w_i) / sum_j(N_j * w_j)

With all source weights at 1, source probability is proportional to source row count.

Global complexity reference

Iteration 2 uses word count only as the intrinsic measurement used to build one global complexity reference from all 72 selectable dummy rows. The user does not configure a target word count.

For each word count k, tied rows occupy their empirical global percentile interval [a_k,b_k].

The reference is versioned as:

complexity_reference_version = 1

Profile source weights never change this reference.

Each profile configures:

* global complexity percentile target T in [0,1];
* global complexity percentile spread R > 0.

The desired complexity curve is a normal distribution centered at T. R is the half-width corresponding to the central 98% reference interval, so:

sigma = R / 2.326347874

The normal is truncated and renormalized to the valid percentile domain [0,1]. Its probability mass over each tied word-count percentile interval is divided by the global number of rows with that word count to produce a per-row global complexity mass. Once a source has been selected, those masses are normalized across the rows actually available in that source.

Source probability, conditional row probability, and overall source+row probability remain distinct and are stored in every normal acquisition’s immutable selection snapshot.

Repeats and shared source-record cache

Selections are independent and with replacement. The same (source_id, source_key) can therefore appear in multiple acquisitions.

A stable source record and an acquisition are separate concepts:

* a source record is the underlying source row and normalized retrieved content;
* an acquisition is one particular probabilistic selection event.

source_records is the shared persistent cache, keyed by (source_id, source_key). Once either the live queue or Export retrieves a source record, later live/export selections of that row reuse the cached content without another source request.

Queue behavior

The live profile still maintains ten selected unseen observations. Initial load fills a short queue to ten. Every first-time consumption moves one observation into history and atomically reserves exactly one replacement at the tail of the future queue.

Back/forward movement through already-seen history does not consume the queue and creates no replacement. Live source-record preparation remains sequential and queue order remains authoritative regardless of later settings changes, cache-hit speed, or source latency.

Saved source/complexity settings affect only acquisitions selected after the save. Existing history, existing unseen selections, and already-pending preparation work are not resampled.

Observation controls

Back, Next, and the bottom-right Settings icon are hidden by default. A single tap on the ordinary observation surface reveals all three controls; another background tap hides them. A successful Back/Next navigation hides them again.

Whenever controls are revealed, both Back and Next remain in their fixed positions. If either direction is unavailable, its arrow is visibly greyed out and disabled rather than disappearing.

The Settings control and the Settings-language control are application-rendered monochrome SVGs that inherit the same grey UI color through currentColor. Platform emoji glyphs are not used for either control.

When a valid profile has no current observation yet, the observation area displays:

...

This is only a UI placeholder. It does not create a history entry, acquisition, source record, or timing record.

Stable profile-code entry

The initial three-digit profile-code input is anchored to the viewport height captured when the entry screen first renders. The entry screen uses that fixed layout height rather than the keyboard-responsive dynamic viewport height.

Opening the software keyboard therefore does not recenter, shrink, or push the profile-code input upward as the mobile visual viewport changes. The bar stays at its original physical vertical position for that entry-screen session.

Observation typography

Each time an observation becomes the actively displayed observation, the client randomly chooses one font from this fixed curated collection:

* Noto Sans Telugu
* Noto Serif Telugu
* Mandali
* Ramabhadra
* NTR
* Peddana
* Ramaraja
* Sree Krushnadevaraya
* Suranna
* Tenali Ramakrishna

Font selection is presentation-only. It is not persisted in history, the acquisition, the source record, or the selection snapshot.

Navigating away from an observation and later returning to it chooses again. Closing Settings and returning to the observation also chooses again. A browser reload/new presentation session may choose again. Polling, timing refreshes, queue-readiness changes, and ordinary React rerenders do not reroll the font while the same observation remains continuously active.

The preferred observation font size is derived continuously from text load rather than from a few hardcoded sentence-length buckets. Short observations receive a larger preferred size and progressively longer observations receive progressively smaller sizes.

After the font is chosen, the browser loads that specific family and measures the rendered observation. The fit pass reduces the preferred size only as necessary to fit the available observation width and height. The order is:

observation becomes active
        ↓
choose random font
        ↓
derive preferred size from observation length
        ↓
load and measure that font
        ↓
reduce only if necessary to fit
        ↓
display

Iteration 2 loads the curated prototype font collection through Google Fonts so these families are actually available rather than depending on device-installed fonts. The selection remains application-controlled. Before a production/offline release, the same licensed font assets should be bundled/self-hosted by the application so runtime typography no longer depends on remote font delivery.

Full-page Settings

Settings replaces the observation view while it is open; it is not a modal. The Settings root page links to four child pages:

1. Complexity
2. Source weights
3. Diagnostic
4. Export

Every child page has a Back control that returns to the Settings root. The × control exits the entire Settings hierarchy and returns to the same observation.

Because the observation is not visible while a Settings page is displayed, opening Settings pauses the current observation’s visible-time accumulation. The history-tail absolute timer continues according to the accepted Iteration 1 timing rules. Closing Settings resumes visible-time accumulation if the observation is otherwise visible and creates a fresh typography activation for that observation.

A monochrome language control remains fixed in the bottom-right throughout the Settings hierarchy. It switches all Settings labels, including diagnostic field names, between Telugu and English. The preference is presentation-only and is persisted locally in the browser. It does not change selection settings, queue state, acquisition snapshots, or export probabilities.

Complexity and source-weight pages

The Complexity page edits the global percentile target and spread. The Source weights page edits one canonical weight for each source. Both persist through the existing profile-settings API and backend validation remains authoritative.

Saving either page affects only future selections. Already-selected unseen observations, history, and already-pending preparation work remain unchanged.

Diagnostic

Diagnostic has its own full page and renders the current acquisition as a two-column mapping table rather than free-form diagnostic text.

The table preserves the Iteration 1 trigger/preparation fields and adds the complete persisted Iteration 2 selection snapshot, including source weights, source probability, row key, word count, global percentile interval, target/spread/reference version, conditional row probability, overall probability, and cache-hit/request information.

If there is no current acquisition, the Diagnostic page displays ... rather than fabricating values.

Export

Export is not a history export and does not simulate repeated Next presses.

The user enters a positive integer N. Export snapshots the profile’s current source weights, complexity target/spread, and complexity-reference version once, then performs exactly N independent fresh selections using the same source and complexity selection engine used by normal acquisitions.

Export does not:

* advance the current history cursor;
* append profile history;
* consume or replenish the live ten-item queue;
* consume normal acquisition numbers;
* alter observation timing.

Export does use and populate the normal persistent source_records cache. Selected uncached rows are resolved sequentially through the source adapter; cached rows are reused immediately.

The Export page uses two explicit stages. Export first generates the batch. While generation is running, Download is disabled. After all N rows are selected and resolved, the generated ExportResponse is retained in the browser and Download becomes available.

Download only serializes that already-completed result into the self-contained HTML file; it performs no new source selections or source retrievals.

Editing the export count invalidates the prepared Download. Successfully saving new complexity or source-weight settings also invalidates any prepared Download, so the visible count/settings cannot disagree with the batch being downloaded.

The browser builds one self-contained .html file in memory containing all selected Telugu observations, inline CSS/JavaScript, and each export item’s diagnostic mapping table. The downloaded file needs no app server, SQLite, Node.js, APIs, or external JavaScript libraries and can browse only its embedded sequence.

Persistence and migration

The default SQLite file is:

./data/app.sqlite

Override it with DATABASE_PATH.

Iteration 2 performs a non-destructive schema upgrade for Iteration 1 databases. In particular, it removes Iteration 1’s observation-level uniqueness on (source_id, source_key) so repeats can create distinct acquisitions, creates the stable shared source_records cache, adds profile selection settings/weights, and adds persisted selection snapshots.

Already-ready Iteration 1 observations are backfilled into the shared source-record cache. A compatibility-only disabled Iteration 1 mock resolver remains available for old pending mock rows but is not part of the three selectable Iteration 2 sources.

Environment defaults

See .env.example. Important defaults are:

SOURCE1_WEIGHT=1
SOURCE2_WEIGHT=1
SOURCE3_WEIGHT=1
COMPLEXITY_PERCENTILE_TARGET=0.5
COMPLEXITY_PERCENTILE_SPREAD=0.25
MOCK_DELAY_MIN_MS=1000
MOCK_DELAY_MAX_MS=15000
MAX_EXPORT_COUNT=500