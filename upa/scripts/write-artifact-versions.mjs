import { mkdir, readFile, writeFile } from 'node:fs/promises';

const appRoot = new URL('../', import.meta.url);
const artifacts = new Map([
  ['frontend', ['frontend/version.json', 'dist/client/version.json']],
  ['backend', ['server/version.json', 'dist/server/version.json']],
  ['worker', ['server/availability-worker.version.json', 'dist/server/availability-worker.version.json']],
]);
const requested = process.argv.slice(2);
if (requested.length === 0) throw new Error('Specify at least one artifact: frontend, backend, worker.');
const files = requested.map(artifact => {
  const paths = artifacts.get(artifact);
  if (!paths) throw new Error(`Unknown artifact: ${artifact}`);
  return paths;
});

const deployedAt = new Date().toISOString();
for (const [source, destination] of files) {
  const sourceUrl = new URL(source, appRoot);
  const destinationUrl = new URL(destination, appRoot);
  const metadata = JSON.parse(await readFile(sourceUrl, 'utf8'));
  await mkdir(new URL('./', destinationUrl), { recursive: true });
  await writeFile(destinationUrl, `${JSON.stringify({ ...metadata, deployedAt }, null, 2)}\n`);
}
