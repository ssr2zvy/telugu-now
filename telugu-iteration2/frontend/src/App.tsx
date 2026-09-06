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
