export type PreparationGroupKind = 'launch-fill' | 'rolling-replenishment';
export type AcquisitionTriggerKind = 'initial-fill' | 'observation-consumed';
export type ObservationStatus = 'pending' | 'preparing' | 'ready';
export type ComplexityMetric = 'word-count' | 'grapheme-count';
export type ObservationKind = 'normal' | 'question';
export type QuestionMode = 'audio-given' | 'text-given';
export type QuestionPool = 'seen' | 'unseen';
export type QuestionKeyboard = 'windows-inscript' | 'mac-standard' | 'chromebook-dictation';
export type QuestionPhase = 'question' | 'comparison' | 'observation';

export type ClientTelemetryEventName =
  | 'observation_load_started'
  | 'observation_audio_failed'
  | 'observation_render_failed'
  | 'observation_ready'
  | 'observation_preparation_waiting'
  | 'recording_failed';

export interface ClientTelemetryEvent {
  event: ClientTelemetryEventName;
  clientId: string;
  observationId?: string;
  stage?: string;
  failureCategory?: string;
  durationMs?: number;
}

export interface ProfileEon {
  id: string;
  name: string;
  startedAt: number;
  stoppedAt: number | null;
  observationCount: number;
}

export interface ProfileEonsResponse {
  activeEon: ProfileEon | null;
  eons: ProfileEon[];
}

export interface BlacklistEntry {
  text: string;
  createdAt: number;
}

export interface ProfileBlacklistResponse {
  entries: BlacklistEntry[];
}

export interface ProfileSelectionSettings {
  sourceWeights: Record<string, number>;
  complexityPercentileTarget: number;
  complexityPercentileSpread: number;
  questionProbability?: number;
  seenQuestionProbability?: number;
  audioGivenQuestionProbability?: number;
  complexityReferenceVersion: number;
}

export interface UpdateSelectionSettingsRequest {
  sourceWeights?: Record<string, number>;
  complexityPercentileTarget?: number;
  complexityPercentileSpread?: number;
  questionProbability?: number;
  seenQuestionProbability?: number;
  audioGivenQuestionProbability?: number;
}

export interface ProfileAudioSettings {
  playbackRate: number;
  autoplay: boolean;
}

export interface UpdateAudioSettingsRequest {
  playbackRate: number;
  autoplay?: boolean;
}

export interface SelectionSnapshot {
  sourceWeights: Record<string, number>;
  sourceId: string;
  sourceRowCount: number;
  sourceWeight: number;
  sourceMass: number;
  totalSourceMass: number;
  sourceProbability: number;
  sourceKey: string;
  complexityMetric: ComplexityMetric;
  intrinsicComplexityValue: number;
  complexityReferenceVersion: number;
  complexityPercentileTarget: number;
  complexityPercentileSpread: number;
  derivedStandardDeviation: number;
  globalPercentileStart: number;
  globalPercentileEnd: number;
  globalIntervalMass: number;
  globalRowsAtComplexityValue: number;
  globalPerRowComplexityMass: number;
  selectedSourceRowsAtComplexityValue: number;
  selectedSourceNormalizationDenominator: number;
  rowProbabilityWithinSource: number;
  overallProbability: number;

  // Persisted Iteration 2 snapshots may still contain these fields.
  wordCount?: number;
  globalRowsAtWordCount?: number;
  selectedSourceRowsAtWordCount?: number;
}

export interface TextMedia {
  kind: 'text';
  language: 'te';
  text: string;
}

export interface AudioMedia {
  kind: 'audio';
  objectKey: string;
  mimeType: string;
  durationSeconds: number;
  sha256: string;
}

export type MediaItem = TextMedia | AudioMedia;

export interface DataSourceInfo {
  sourceId: string;
  displayName: string;
  provider: string;
  license: string;
  upstreamUrl: string | null;
  catalogVersion: number;
  acceptedRows: number;
  rejectedRows: number;
  complexityMetric: ComplexityMetric;
  status: 'ready' | 'fixture' | 'invalid';
}

export interface DataSourcesResponse {
  sources: DataSourceInfo[];
}

export interface GrammarParserInfo {
  version?: string;
  adapterVersion?: string;
  targetSchemaVersion?: string;
  dictionaryId?: string;
  maxDepth?: number | null;
  maxStates?: number | null;
  nesting?: string;
  eligibilityPolicy?: string;
}

export interface GrammarParserDiagnostics {
  active: boolean;
  available: boolean;
  parser: GrammarParserInfo | null;
  policy: string | null;
  rulesSha256: string | null;
  inventoryId: string | null;
  stats: Record<string, number>;
  exclusions: Record<string, number>;
}

export interface ObservationDiagnostic {
  acquisitionNumber: number;
  triggerKind: AcquisitionTriggerKind;
  triggeredByObservationId: string | null;
  triggeredByAcquisitionNumber: number | null;
  triggeredByHistoryPosition: number | null;
  triggeredAt: number;
  waitingAheadAtTrigger: number;
  preparationInFlightAtTrigger: boolean;
  requestStartedAt: number | null;
  requestCompletedAt: number | null;
  requestDurationMs: number | null;
  cacheHit: boolean | null;
  selection: SelectionSnapshot | null;
  repeat?: DisplayRepeatDiagnostic | null;
}

export interface DisplayRepeatDiagnostic {
  firstDisplayedAt: number;
  recording: {
    isRepeat: boolean | null;
    occurrenceCount: number | null;
    knownOccurrenceCount: number;
    previousSeenAt: number | null;
  };
  sameTextOtherRecordings: {
    seenBefore: boolean | null;
    previousDisplayCount: number | null;
    knownPreviousDisplayCount: number;
    previousSeenAt: number | null;
  };
}

export interface ObservationAudio {
  url: string;
  mimeType: string;
  durationSeconds: number;
}

export type AudioAlignmentStatus = 'estimated' | 'needs_review';

export interface AlignedWordAudio {
  index: number;
  text: string;
  transcriptStart: number;
  transcriptEnd: number;
  status: AudioAlignmentStatus;
  audio: ObservationAudio;
}

export interface AlignedLetterAudio {
  text: string;
  word: string;
  graphemeIndex: number;
  status: AudioAlignmentStatus;
  audio: ObservationAudio;
  sourceId: string;
  sourceKey: string;
}

export interface GraphemeWord {
  word: string;
  complexity: number;
  wordGraphemeCount: number;
  sourceId: string;
  sourceKey: string;
  audio: ObservationAudio;
}

export interface DisplayObservation {
  grammar?: {target: Record<string,unknown>; result: boolean|null}|null;
  id: string;
  sourceId: string;
  sourceKey: string;
  text: string;
  audio: ObservationAudio | null;
  kind: ObservationKind;
  question: {
    mode: QuestionMode;
    requestedPool: QuestionPool | null;
    keyboard: QuestionKeyboard | null;
    phase: QuestionPhase;
    responseText: string;
    responseAudio: ObservationAudio | null;
  } | null;
  diagnostic: ObservationDiagnostic;
}

export interface UpdateQuestionResponseRequest {
  text: string;
}

export interface QueueSummary {
  unseenCount: number;
  readyCount: number;
  preparingCount: number;
  pendingCount: number;
  preparationError?: { code: string; attempts: number; retryAt: number | null } | null;
}

export type QueuePreparationPhase = 'empty' | 'pending' | 'retry-waiting' | 'preparing' | 'ready' | 'failed';

export interface QueueViewSlot {
  slot: number;
  phase: QueuePreparationPhase;
  queuePosition: number | null;
  observationId: string | null;
  sourceId: string | null;
  sourceKey: string | null;
  text: string | null;
  selectedAt: number | null;
  preparedAt: number | null;
  requestStartedAt: number | null;
  requestCompletedAt: number | null;
  requestDurationMs: number | null;
  cacheHit: boolean | null;
  preparationAttempts: number;
  preparationRetryAt: number | null;
  preparationError: string | null;
  acquisitionNumber: number | null;
  triggerKind: AcquisitionTriggerKind | null;
  observationKind: ObservationKind | null;
  questionMode: QuestionMode | null;
  hasAudio: boolean;
  fontRenderPhase: 'not-scheduled';
}

export interface QueueViewResponse {
  generatedAt: number;
  capacity: number;
  slots: QueueViewSlot[];
}

export interface TimingSummary {
  tailPosition: number | null;
  absoluteElapsedMs: number;
  visibleElapsedMs: number;
  finalized: boolean;
}

export interface UpcomingPresentationHint {
  id: string;
  text: string;
}

export interface ProfileStateResponse {
  grammarError?: string|null;
  grammarActive?: boolean;
  selectionMode?: 'weighted' | 'core' | 'random';
  grammarMigrationAvailable?: boolean;
  profileCode: string;
  currentPosition: number | null;
  historyLength: number;
  currentObservation: DisplayObservation | null;
  /** Ordered forward-history/ready-queue audio hints; never consumes a reservation. */
  upcomingAudio?: ObservationAudio[];
  /** The next displayable entry, used only for browser font and texture preparation. */
  upcomingPresentation?: UpcomingPresentationHint[];
  /** The prior history entry, used only for browser font and texture preparation. */
  previousPresentation?: UpcomingPresentationHint | null;
  canBack: boolean;
  canNext: boolean;
  nextStatus: ObservationStatus | null;
  queue: QueueSummary;
  timing: TimingSummary | null;
  selectionSettings: ProfileSelectionSettings;
  audioSettings: ProfileAudioSettings;
}

export interface LoadProfileRequest {
  code: string;
  visible: boolean;
}

export interface NavigationRequest {
  visible: boolean;
}

export interface VisibilityRequest {
  visible: boolean;
}

export interface ExportRequest {
  count: number;
}

export interface ExportEntryDiagnostic {
  selection: SelectionSnapshot | null;
  grammar?: Record<string,unknown>;
  cacheHit: boolean;
  requestStartedAt: number | null;
  requestCompletedAt: number | null;
  requestDurationMs: number | null;
}

export interface ExportEntry {
  position: number;
  sourceId: string;
  sourceKey: string;
  text: string;
  audio?: ObservationAudio | null;
  diagnostic: ExportEntryDiagnostic;
}

export interface ExportResponse {
  settings: ProfileSelectionSettings;
  entries: ExportEntry[];
}

export interface ApiErrorResponse {
  error: string;
}

export interface GrammarCategoryDiagnostics {
  available: boolean;
  position: number;
  completed: boolean;
  stateSource: 'batch' | 'progress' | 'initial';
  categories: Array<{ level: number; probability: number; initialProbability: number; reversal: number; targetCount: number }>;
  coreBases: Array<{ id: string; forms: string[]; examples: string[]; streak: number }>;
  singleModifiers: Array<{ id: string; forms: string[]; examples: string[]; streak: number }>;
}
