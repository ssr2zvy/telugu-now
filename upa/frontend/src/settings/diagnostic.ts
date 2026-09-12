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
export interface DiagnosticSection {
  key: DiagnosticSectionKey;
  rows: DiagnosticRow[];
}
export type DiagnosticSectionKey =
  | 'trigger'
  | 'source'
  | 'complexity'
  | 'global';
const DIAGNOSTIC_SECTION_LABELS = {
  trigger: {
    en: 'Trigger & acquisition',
    te: 'ట్రిగర్ & సేకరణ',
  },
  source: {
    en: 'Source',
    te: 'మూల సమాచారం',
  },
  complexity: {
    en: 'Complexity',
    te: 'సంక్లిష్టత',
  },
  global: {
    en: 'Summary',
    te: 'సారాంశం',
  },
} as const;
export function diagnosticSectionLabel(
  language: UiLanguage,
  key: DiagnosticSectionKey,
): string {
  return DIAGNOSTIC_SECTION_LABELS[
    key
  ][language];
}
const DIAGNOSTIC_LABELS = {
  recordingRepeat: { en: 'Repeat recording?', te: 'రికార్డింగ్ పునరావృతమా?' },
  recordingOccurrence: { en: 'Times shown (recorded)', te: 'నమోదైన ప్రదర్శనల సంఖ్య' },
  recordingPreviousSeen: { en: 'Previously shown', te: 'గత ప్రదర్శన' },
  sameTextOtherRecordings: { en: 'Same text in another recording?', te: 'అదే వచనం మరో రికార్డింగ్‌లో వచ్చిందా?' },
  sameTextOtherCount: { en: 'Other-recording appearances', te: 'ఇతర రికార్డింగ్‌ల ప్రదర్శనలు' },
  sameTextOtherSeen: { en: 'Other recording last shown', te: 'ఇతర రికార్డింగ్ గత ప్రదర్శన' },
  preparationError: { en: 'Queue preparation error', te: 'క్యూ సిద్ధీకరణ లోపం' },
  observationId: {
    en: 'Observation ID',
    te: 'పరిశీలన ఐడీ',
  },
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
  complexityMetric: { en: 'Complexity metric', te: 'సంక్లిష్టత ప్రమాణం' },
  intrinsicComplexityValue: { en: 'Complexity value', te: 'సంక్లిష్టత విలువ' },
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
  globalRowsAtComplexityValue: { en: 'Global rows at complexity value', te: 'ఆ సంక్లిష్టత విలువలో ప్రపంచ వరుసలు' },
  globalPerRowComplexityMass: {
    en: 'Global per-row complexity mass',
    te: 'వరుసకు ప్రపంచ సంక్లిష్టత మాస్',
  },
  selectedSourceRowsAtComplexityValue: { en: 'Source rows at complexity value', te: 'ఆ సంక్లిష్టత విలువలో మూల వరుసలు' },
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
function sourceInfoRows(
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
  ];
}
function complexityInfoRows(
  selection:
    SelectionSnapshot,
): DiagnosticRow[] {
  return [
    {
      key: 'complexityMetric',
      value: selection.complexityMetric,
    },
    {
      key: 'intrinsicComplexityValue',
      value: String(selection.intrinsicComplexityValue),
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
        'globalRowsAtComplexityValue',
      value:
        String(
          selection
            .globalRowsAtComplexityValue,
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
        'selectedSourceRowsAtComplexityValue',
      value:
        String(
          selection
            .selectedSourceRowsAtComplexityValue,
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
  ];
}
export function buildDiagnosticSections(
  state: ProfileStateResponse,
  language: UiLanguage,
): DiagnosticSection[] | null {
  const observation =
    state
      .currentObservation;
  const diagnostic =
    observation
      ?.diagnostic;
  if (!observation || !diagnostic) {
    return null;
  }
  const triggerRows:
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
  const repeat = diagnostic.repeat;
  const date = (value: number | null | undefined) => value == null ? '—' : new Date(value).toLocaleString();
  if (repeat) triggerRows.splice(1, 0,
    { key: 'recordingRepeat', value: t(language, repeat.recording.knownOccurrenceCount > 1 ? 'yes' : 'no') },
    { key: 'recordingOccurrence', value: String(repeat.recording.knownOccurrenceCount) },
    { key: 'recordingPreviousSeen', value: date(repeat.recording.previousSeenAt) },
    { key: 'sameTextOtherRecordings', value: t(language, repeat.sameTextOtherRecordings.knownPreviousDisplayCount > 0 ? 'yes' : 'no') },
    { key: 'sameTextOtherCount', value: String(repeat.sameTextOtherRecordings.knownPreviousDisplayCount) },
    { key: 'sameTextOtherSeen', value: date(repeat.sameTextOtherRecordings.previousSeenAt) },
  );
  if (state.queue.preparationError) triggerRows.push({
    key: 'preparationError',
    value: `${state.queue.preparationError.code} · ${state.queue.preparationError.attempts}/3${
      state.queue.preparationError.retryAt ? ` · ${date(state.queue.preparationError.retryAt)}`
        : language === 'te' ? ' · సిద్ధీకరణ ఆగిపోయింది; మూల లభ్యతను తనిఖీ చేసి క్యూ రీసెట్ చేయండి'
          : ' · preparation stopped; check source availability and reset queue to retry'
    }`,
  });
  const sections:
    DiagnosticSection[] = [
    { key: 'trigger', rows: triggerRows },
  ];
  const selection =
    diagnostic.selection;
  sections.push({
    key: 'source',
    rows: selection
      ? sourceInfoRows(selection)
      : [{
          key: 'selectionSnapshot',
          value: t(language, 'unavailable'),
        }],
  });
  sections.push({
    key: 'complexity',
    rows: selection
      ? complexityInfoRows(selection)
      : [{
          key: 'selectionSnapshot',
          value: t(language, 'unavailable'),
        }],
  });
  sections.push({
    key: 'global',
    rows: [
      {
        key: 'observationId',
        value: observation.id,
      },
      {
        key: 'overallProbability',
        value:
          selection
            ? formatPercent(selection.overallProbability)
            : t(language, 'unavailable'),
      },
    ],
  });
  return sections;
}
