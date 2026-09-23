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

function parseBoolean(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value === undefined) return fallback;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`${name} must be true or false.`);
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

function defaultDataDirectory(): string {
  let directory = path.dirname(fileURLToPath(import.meta.url));
  while (path.dirname(directory) !== directory) {
    if (fs.existsSync(path.join(directory, 'package.json'))
      && (fs.existsSync(path.join(directory, 'server')) || fs.existsSync(path.join(directory, 'dist', 'server')))) {
      return path.resolve(directory, '..', 'local-machine', 'data');
    }
    directory = path.dirname(directory);
  }
  throw new Error('Could not locate the repository data directory. Set DATA_DIRECTORY explicitly.');
}

const dataDirectory = process.env.DATA_DIRECTORY === undefined
  ? defaultDataDirectory()
  : path.resolve(process.env.DATA_DIRECTORY);
if (process.env.DATA_DIRECTORY?.trim() === '') throw new Error('DATA_DIRECTORY must not be empty.');
if (fs.existsSync(dataDirectory) && !fs.statSync(dataDirectory).isDirectory()) {
  throw new Error('DATA_DIRECTORY must be a directory.');
}

export function resolveDataPath(value: string | undefined, fallback: string): string {
  const resolved = value === undefined ? path.join(dataDirectory, fallback) : path.resolve(value);
  const relative = path.relative(dataDirectory, resolved);
  if (process.env.NODE_ENV !== 'test' && (relative === '' || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))) {
    throw new Error('Persistent user and global data must stay under DATA_DIRECTORY (default: repository local-machine/data/).');
  }
  return resolved;
}

const corpusBackend = process.env.CORPUS_BACKEND ?? 'local';
if (corpusBackend !== 'local' && corpusBackend !== 'tigris') {
  throw new Error('CORPUS_BACKEND must be local or tigris.');
}
const databasePath = resolveDataPath(process.env.DATABASE_PATH, 'user/users.sqlite');
const corpusDatabasePath = resolveDataPath(process.env.CORPUS_DATABASE_PATH, 'corpus/corpus.sqlite');
const frequencyDatabasePath = resolveDataPath(process.env.FREQUENCY_DATABASE_PATH, 'corpus/frequency.sqlite');
const corpusAvailabilityPath = resolveDataPath(process.env.CORPUS_AVAILABILITY_PATH, 'corpus/availability.sqlite');
const audioValidationPath = resolveDataPath(
  process.env.AUDIO_VALIDATION_PATH ?? path.join(path.dirname(corpusAvailabilityPath), 'audio-validation.sqlite'),
  'corpus/audio-validation.sqlite',
);
const corpusObjectsPath = resolveDataPath(process.env.CORPUS_OBJECTS_PATH, 'corpus/objects');
if (new Set([databasePath, corpusDatabasePath, corpusAvailabilityPath, audioValidationPath, frequencyDatabasePath]).size !== 5) {
  throw new Error('User, corpus, frequency, availability, and audio validation databases must be separate files.');
}
const defaultSourceWeights = {
  'fleurs-te': 1,
  'shrutilipi-te': 1,
  'indicvoices-te': 1,
};

if (Math.max(...Object.values(defaultSourceWeights)) !== 1) {
  throw new Error('At least one default source weight must equal 1.');
}

export const config = {
  port: parseNonNegativeInt(process.env.PORT, 8080),
  devPort: parseNonNegativeInt(process.env.API_DEV_PORT, 8787),
  dataDirectory,
  corpusBackend,
  frequencyDatabasePath,
  databasePath: path.resolve(databasePath),
  corpusDatabasePath: path.resolve(corpusDatabasePath),
  corpusAvailabilityPath: path.resolve(corpusAvailabilityPath),
  audioValidationPath: path.resolve(audioValidationPath),
  corpusObjectsPath: path.resolve(corpusObjectsPath),
  corpusObjectsPrefix: process.env.CORPUS_OBJECTS_PREFIX ?? 'corpus/objects/',
  bucketName: process.env.BUCKET_NAME,
  awsEndpointUrlS3: process.env.AWS_ENDPOINT_URL_S3,
  awsRegion: process.env.AWS_REGION ?? 'auto',
  corpusAvailabilityRebuildOnStartup: parseBoolean('CORPUS_AVAILABILITY_REBUILD_ON_STARTUP', false),
  corpusCatalogForceRedownload: parseBoolean('CORPUS_CATALOG_FORCE_REDOWNLOAD', false),
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
