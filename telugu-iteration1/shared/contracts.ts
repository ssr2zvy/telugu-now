export type PreparationGroupKind = 'launch-fill' | 'rolling-replenishment';
export type AcquisitionTriggerKind = 'initial-fill' | 'observation-consumed';
export type ObservationStatus = 'pending' | 'preparing' | 'ready';

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
}

export interface DisplayObservation {
  id: string;
  sourceId: string;
  sourceKey: string;
  text: string;
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

export interface ApiErrorResponse {
  error: string;
}
