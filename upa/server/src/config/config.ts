import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

function parseNonNegativeInt(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function parseFiniteNumber(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseUnitInterval(value: string | undefined, fallback: number): number {
  const parsed = parseFiniteNumber(value, fallback);
  return parsed >= 0 && parsed <= 1 ? parsed : fallback;
}

function parsePositiveNumber(value: string | undefined, fallback: number): number {
  const parsed = parseFiniteNumber(value, fallback);
  return parsed > 0 ? parsed : fallback;
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

let repositoryDirectory = path.dirname(fileURLToPath(import.meta.url));
while (!fs.existsSync(path.join(repositoryDirectory, 'control.sh'))) {
  const parent = path.dirname(repositoryDirectory);
  if (parent === repositoryDirectory) throw new Error('Could not locate the repository data directory.');
  repositoryDirectory = parent;
}
const dataDirectory = path.join(repositoryDirectory, 'data');

export function resolveDataPath(value: string | undefined, fallback: string): string {
  const resolved = value === undefined ? path.join(dataDirectory, fallback) : path.resolve(value);
  const relative = path.relative(dataDirectory, resolved);
  if (process.env.NODE_ENV !== 'test' && (relative === '' || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))) {
    throw new Error('Persistent user and global data must stay under the repository data directory.');
  }
  return resolved;
}

const databasePath = resolveDataPath(process.env.DATABASE_PATH, 'users.sqlite');
const corpusDatabasePath = resolveDataPath(process.env.CORPUS_DATABASE_PATH, 'corpus/corpus.sqlite');
const corpusObjectsPath = resolveDataPath(process.env.CORPUS_OBJECTS_PATH, 'corpus/objects');
const defaultSourceWeights = {
  source1: parseUnitInterval(process.env.SOURCE1_WEIGHT, 1),
  source2: parseUnitInterval(process.env.SOURCE2_WEIGHT, 1),
  source3: parseUnitInterval(process.env.SOURCE3_WEIGHT, 1),
  'fleurs-te': parseUnitInterval(process.env.FLEURS_TE_WEIGHT, 1),
  'shrutilipi-te': parseUnitInterval(process.env.SHRUTILIPI_TE_WEIGHT, 1),
  'indicvoices-te': parseUnitInterval(process.env.INDICVOICES_TE_WEIGHT, 1),
};

if (Math.max(...Object.values(defaultSourceWeights)) !== 1) {
  throw new Error('At least one default source weight must equal 1.');
}

export const config = {
  port: parseNonNegativeInt(process.env.PORT, 8080),
  devPort: parseNonNegativeInt(process.env.API_DEV_PORT, 8787),
  databasePath: path.resolve(databasePath),
  corpusDatabasePath: path.resolve(corpusDatabasePath),
  corpusObjectsPath: path.resolve(corpusObjectsPath),
  profileCodes: parseProfileCodes(process.env.PROFILE_CODES),
  mockDelayMinMs: parseNonNegativeInt(process.env.MOCK_DELAY_MIN_MS, 1_000),
  mockDelayMaxMs: parseNonNegativeInt(process.env.MOCK_DELAY_MAX_MS, 15_000),
  defaultSourceWeights,
  defaultComplexityPercentileTarget: parseUnitInterval(
    process.env.COMPLEXITY_PERCENTILE_TARGET,
    0.5,
  ),
  defaultComplexityPercentileSpread: parsePositiveNumber(
    process.env.COMPLEXITY_PERCENTILE_SPREAD,
    0.25,
  ),
  defaultAudioPlaybackRate: (() => {
    const parsed = parseFiniteNumber(process.env.AUDIO_PLAYBACK_RATE_DEFAULT, 1);
    return parsed >= 0.1 && parsed <= 1.5 ? parsed : 1;
  })(),
  maxExportCount: Math.max(1, parseNonNegativeInt(process.env.MAX_EXPORT_COUNT, 500)),
};

if (config.mockDelayMaxMs < config.mockDelayMinMs) {
  throw new Error('MOCK_DELAY_MAX_MS must be greater than or equal to MOCK_DELAY_MIN_MS.');
}
