import type { ClientTelemetryEvent, ClientTelemetryEventName } from '../../../shared/contracts';
import { logger } from './logger';

const allowedEvents = new Set<ClientTelemetryEventName>([
  'observation_load_started',
  'observation_audio_failed',
  'observation_render_failed',
  'observation_ready',
  'observation_preparation_waiting',
  'recording_failed',
]);

export function parseClientTelemetry(value: unknown): ClientTelemetryEvent | null {
  if (!value || typeof value !== 'object') return null;
  const event = value as Partial<ClientTelemetryEvent>;
  if (!event.event || !allowedEvents.has(event.event)
    || typeof event.clientId !== 'string' || !/^[a-f0-9-]{16,64}$/iu.test(event.clientId)
    || (event.observationId !== undefined && (typeof event.observationId !== 'string' || event.observationId.length > 128))
    || (event.stage !== undefined && (typeof event.stage !== 'string' || event.stage.length > 64))
    || (event.failureCategory !== undefined && (typeof event.failureCategory !== 'string' || event.failureCategory.length > 64))
    || (event.durationMs !== undefined && (!Number.isFinite(event.durationMs) || event.durationMs < 0 || event.durationMs > 3_600_000))) {
    return null;
  }
  return {
    event: event.event,
    clientId: event.clientId,
    ...(event.observationId ? { observationId: event.observationId } : {}),
    ...(event.stage ? { stage: event.stage } : {}),
    ...(event.failureCategory ? { failureCategory: event.failureCategory } : {}),
    ...(event.durationMs !== undefined ? { durationMs: Math.round(event.durationMs) } : {}),
  };
}

export function recordClientTelemetry(event: ClientTelemetryEvent): void {
  const { event: name, ...fields } = event;
  logger[name.endsWith('_failed') ? 'warn' : 'info'](name, { source: 'browser', ...fields });
}
