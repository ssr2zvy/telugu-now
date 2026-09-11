import { copyFile } from 'node:fs/promises';

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

for (const [source, destination] of files) {
  await copyFile(new URL(source, appRoot), new URL(destination, appRoot));
}
