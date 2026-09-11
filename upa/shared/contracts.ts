export type PreparationGroupKind = 'launch-fill' | 'rolling-replenishment';
export type AcquisitionTriggerKind = 'initial-fill' | 'observation-consumed';
export type ObservationStatus = 'pending' | 'preparing' | 'ready';
export type ComplexityMetric = 'word-count' | 'grapheme-count';

export interface ProfileSelectionSettings {
  sourceWeights: Record<string, number>;
  complexityPercentileTarget: number;
  complexityPercentileSpread: number;
  complexityReferenceVersion: number;
}

export interface UpdateSelectionSettingsRequest {
  sourceWeights: Record<string, number>;
  complexityPercentileTarget: number;
  complexityPercentileSpread: number;
}

export interface ProfileAudioSettings {
  playbackRate: number;
}

export interface UpdateAudioSettingsRequest {
  playbackRate: number;
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
}

export interface ObservationAudio {
  url: string;
  mimeType: string;
  durationSeconds: number;
}

export interface DisplayObservation {
  id: string;
  sourceId: string;
  sourceKey: string;
  text: string;
  audio: ObservationAudio | null;
  diagnostic: ObservationDiagnostic;
}

export interface QueueSummary {
  unseenCount: number;
  readyCount: number;
  preparingCount: number;
  pendingCount: number;
}

export interface TimingSummary {
  tailPosition: number | null;
  absoluteElapsedMs: number;
  visibleElapsedMs: number;
  finalized: boolean;
}

export interface ProfileStateResponse {
  profileCode: string;
  currentPosition: number | null;
  historyLength: number;
  currentObservation: DisplayObservation | null;
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
  selection: SelectionSnapshot;
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
