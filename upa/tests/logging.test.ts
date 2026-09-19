import assert from 'node:assert/strict';
import test from 'node:test';
import { parseClientTelemetry } from '../server/src/services/client-telemetry-service';
import { errorCategory, logger, withRequestContext } from '../server/src/services/logger';

test('structured logs include correlation IDs and preserve reserved fields', () => {
  const lines: string[] = [];
  const original = process.stdout.write;
  process.stdout.write = ((chunk: string | Uint8Array) => {
    lines.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  try {
    withRequestContext('request-1', () => logger.info('queue_test', {
      event: 'overridden',
      level: 'fatal',
      requestId: 'overridden',
      depth: 10,
    }));
  } finally {
    process.stdout.write = original;
  }
  assert.equal(lines.length, 1);
  const event = JSON.parse(lines[0]!) as Record<string, unknown>;
  assert.equal(event.event, 'queue_test');
  assert.equal(event.level, 'info');
  assert.equal(event.requestId, 'request-1');
  assert.equal(event.depth, 10);
});

test('client telemetry accepts only bounded, allow-listed fields', () => {
  assert.deepEqual(parseClientTelemetry({
    event: 'observation_ready',
    clientId: '12345678-1234-1234-1234-123456789abc',
    observationId: 'observation-1',
    durationMs: 12.6,
    ignored: 'not logged',
  }), {
    event: 'observation_ready',
    clientId: '12345678-1234-1234-1234-123456789abc',
    observationId: 'observation-1',
    durationMs: 13,
  });

  assert.equal(parseClientTelemetry({ event: 'unknown', clientId: '12345678-1234-1234-1234-123456789abc' }), null);
  assert.equal(parseClientTelemetry({ event: 'observation_ready', clientId: 'short' }), null);
  assert.equal(parseClientTelemetry({
    event: 'observation_ready',
    clientId: '12345678-1234-1234-1234-123456789abc',
    durationMs: Number.POSITIVE_INFINITY,
  }), null);
});

test('server errors use stable actionable categories without exposing messages', () => {
  assert.equal(errorCategory(new Error('CORPUS_AVAILABILITY_MISSING_OR_INCOMPATIBLE')), 'corpus-availability-missing-or-incompatible');
  assert.equal(errorCategory(Object.assign(new Error('database is locked'), { code: 'SQLITE_BUSY' })), 'sqlite-failure');
  assert.equal(errorCategory(new TypeError('secret upstream response')), 'type');
  assert.equal(errorCategory(new Error('secret upstream response')), 'unexpected-error');
});
