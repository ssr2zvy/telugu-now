import fs from 'node:fs';
import path from 'node:path';
import type { VersionInformation } from '../../../shared/contracts';

const STARTED_AT = Date.now();

function readJson(file: string): Record<string, unknown> {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>; }
  catch { return {}; }
}

function text(value: string | undefined): string {
  return value?.trim() ?? '';
}

/**
 * What is actually running. The commit and build time are stamped into the image
 * by `ci-cd/deploy.sh`, so a deployed machine can report the revision it serves.
 */
export function versionInformation(root = path.resolve(import.meta.dirname, '..', '..', '..')): VersionInformation {
  const packageJson = readJson(path.join(root, 'package.json'));
  const frontend = readJson(path.join(root, 'dist', 'client', 'version.json'));
  const backend = readJson(path.join(root, 'dist', 'server', 'version.json'));
  const commit = text(process.env.GIT_COMMIT);
  return {
    appVersion: typeof packageJson.version === 'string' ? packageJson.version : 'unknown',
    frontendVersion: typeof frontend.version === 'string' ? frontend.version : 'unknown',
    backendVersion: typeof backend.version === 'string' ? backend.version : 'unknown',
    commit: commit || 'unknown',
    shortCommit: commit ? commit.slice(0, 7) : 'unknown',
    commitSubject: text(process.env.GIT_COMMIT_SUBJECT),
    branch: text(process.env.GIT_BRANCH),
    buildTime: text(process.env.BUILD_TIME),
    flyAppName: text(process.env.FLY_APP_NAME),
    flyRegion: text(process.env.FLY_REGION),
    flyMachineId: text(process.env.FLY_MACHINE_ID),
    flyImageRef: text(process.env.FLY_IMAGE_REF),
    serverStartedAt: STARTED_AT,
    serverTime: Date.now(),
  };
}
