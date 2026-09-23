import { mkdir, readFile, writeFile } from 'node:fs/promises';

const appRoot = new URL('../', import.meta.url);
const artifacts = new Map([
  ['frontend', ['frontend/version.json', 'dist/client/version.json']],
  ['backend', ['server/version.json', 'dist/server/version.json']],
]);
const requested = process.argv.slice(2);
if (requested.length === 0) throw new Error('Specify at least one artifact: frontend, backend.');
const files = requested.map(artifact => {
  const paths = artifacts.get(artifact);
  if (!paths) throw new Error(`Unknown artifact: ${artifact}`);
  return paths;
});

const deployedAt = process.env.BUILD_TIMESTAMP || new Date().toISOString();
const packageMetadata = JSON.parse(await readFile(new URL('package.json', appRoot), 'utf8'));
const revision = process.env.BUILD_REVISION || process.env.GITHUB_SHA || 'local';
const buildId = process.env.BUILD_ID || deployedAt.replace(/[^0-9]/g, '');
const version = `${packageMetadata.version}+${revision.slice(0, 8)}.${buildId}`;
for (const [source, destination] of files) {
  const sourceUrl = new URL(source, appRoot);
  const destinationUrl = new URL(destination, appRoot);
  const metadata = JSON.parse(await readFile(sourceUrl, 'utf8'));
  await mkdir(new URL('./', destinationUrl), { recursive: true });
  await writeFile(destinationUrl, `${JSON.stringify({ ...metadata, version, revision, buildId, deployedAt }, null, 2)}\n`);
}
