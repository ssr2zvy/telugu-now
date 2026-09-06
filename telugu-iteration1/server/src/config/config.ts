import path from 'node:path';

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function parseProfileCodes(value: string | undefined): Set<string> {
  const raw = value ?? '001';
  return new Set(
    raw
      .split(',')
      .map((item) => item.trim())
      .filter((item) => /^\d{3}$/.test(item)),
  );
}

const databasePath = process.env.DATABASE_PATH ?? './data/app.sqlite';

export const config = {
  port: parsePositiveInt(process.env.PORT, 8080),
  devPort: parsePositiveInt(process.env.API_DEV_PORT, 8787),
  databasePath: path.resolve(databasePath),
  profileCodes: parseProfileCodes(process.env.PROFILE_CODES),
  mockDelayMinMs: parsePositiveInt(process.env.MOCK_DELAY_MIN_MS, 1_000),
  mockDelayMaxMs: parsePositiveInt(process.env.MOCK_DELAY_MAX_MS, 60_000),
};

if (config.mockDelayMaxMs < config.mockDelayMinMs) {
  throw new Error('MOCK_DELAY_MAX_MS must be greater than or equal to MOCK_DELAY_MIN_MS.');
}
