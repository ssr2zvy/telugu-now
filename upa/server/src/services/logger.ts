import { AsyncLocalStorage } from 'node:async_hooks';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

const requestContext = new AsyncLocalStorage<{ requestId: string }>();
const levels: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40, fatal: 50 };

function configuredLevel(): LogLevel {
  const value = process.env.LOG_LEVEL?.toLowerCase() as LogLevel | undefined;
  return value && value in levels ? value : 'info';
}

export function withRequestContext<T>(requestId: string, callback: () => T): T {
  return requestContext.run({ requestId }, callback);
}

export function errorCategory(error: unknown): string {
  if (!(error instanceof Error)) return 'unknown';
  const code = (error as Error & { code?: unknown }).code;
  if (typeof code === 'string' && /^SQLITE_/u.test(code)) return 'sqlite-failure';
  if (/^[A-Z][A-Z0-9_]+$/u.test(error.message)) return error.message.toLowerCase().replaceAll('_', '-');
  if (error.name !== 'Error') return error.name.replace(/Error$/u, '').replace(/([a-z])([A-Z])/gu, '$1-$2').toLowerCase();
  const message = error.message.toLowerCase();
  if (message.includes('database') || message.includes('sqlite')) return 'database-unavailable';
  if (message.includes('corpus') || message.includes('snapshot')) return 'corpus-unavailable';
  if (message.includes('config') || message.includes('environment')) return 'configuration-invalid';
  return 'unexpected-error';
}

export function log(level: LogLevel, event: string, fields: Record<string, unknown> = {}): void {
  if (levels[level] < levels[configuredLevel()]) return;
  const line = JSON.stringify({
    ...fields,
    timestamp: new Date().toISOString(),
    level,
    event,
    ...requestContext.getStore(),
  });
  if (level === 'warn' || level === 'error' || level === 'fatal') process.stderr.write(`${line}\n`);
  else process.stdout.write(`${line}\n`);
}

export const logger = {
  debug: (event: string, fields?: Record<string, unknown>) => log('debug', event, fields),
  info: (event: string, fields?: Record<string, unknown>) => log('info', event, fields),
  warn: (event: string, fields?: Record<string, unknown>) => log('warn', event, fields),
  error: (event: string, fields?: Record<string, unknown>) => log('error', event, fields),
  fatal: (event: string, fields?: Record<string, unknown>) => log('fatal', event, fields),
};
