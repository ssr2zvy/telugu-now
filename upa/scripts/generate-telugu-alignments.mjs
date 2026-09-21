import { createHash } from 'node:crypto';
import { access, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { createServer as createViteServer } from 'vite';

const VERSION = 2;
const SIMPLE_FORM_COUNT = [...'కఖగఘఙచఛజఝఞటఠడఢణతథదధనపఫబభమయరఱలళవశషసహ'].length
  * [...'ాిీుూృౄౢౣెేైొోౌ'].length;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const frontend = path.join(root, 'frontend');
const manifestPath = path.join(frontend, 'src', 'generated', 'telugu-font-model-manifest.json');
const modelDirectory = path.join(frontend, 'public', 'font-models');
const lock = JSON.parse(await readFile(path.join(frontend, 'public', 'fonts', 'font-assets.lock.json'), 'utf8'));
const fontHashes = Object.fromEntries(lock.fonts.map(font => [font.family, font.fontSha256]));

try {
  const existing = JSON.parse(await readFile(manifestPath, 'utf8'));
  const current = existing.version === VERSION
    && existing.simpleFormCount === SIMPLE_FORM_COUNT
    && await Promise.all(Object.entries(fontHashes).map(async ([family, hash]) => {
      const entry = existing.fonts?.[family];
      if (entry?.fontSha256 !== hash || !/^\/font-models\/[a-f0-9]{64}\.json$/.test(entry.url ?? '')) return false;
      try { await access(path.join(frontend, 'public', entry.url)); return true; } catch { return false; }
    })).then(results => results.every(Boolean));
  if (current) {
    console.log('Telugu font model assets verified.');
    process.exit(0);
  }
} catch (error) {
  if (!error || error.code !== 'ENOENT') throw error;
}

const vite = await createViteServer({
  root: frontend,
  configFile: false,
  server: { middlewareMode: true },
});
const server = http.createServer((request, response) => vite.middlewares(request, response));
await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});
const address = server.address();
if (!address || typeof address === 'string') throw new Error('Could not allocate alignment generator port.');
const browser = await chromium.launch({ headless: true });
try {
  const fonts = {};
  const generatedFiles = new Set();
  await mkdir(modelDirectory, { recursive: true });
  for (const font of lock.fonts) {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${address.port}/alignment-generator.html`);
    await page.waitForFunction(() => typeof window.generateTeluguFontModelArtifact === 'function');
    const artifact = await page.evaluate(
      async ({ family, hash }) => window.generateTeluguFontModelArtifact(family, hash),
      { family: font.family, hash: font.fontSha256 },
    );
    await page.close();
    const serialized = `${JSON.stringify(artifact)}\n`;
    const contentHash = createHash('sha256').update(serialized).digest('hex');
    const fileName = `${contentHash}.json`;
    await writeFile(path.join(modelDirectory, fileName), serialized, 'utf8');
    generatedFiles.add(fileName);
    fonts[font.family] = { fontSha256: font.fontSha256, url: `/font-models/${fileName}` };
    console.log(`Generated Telugu font model: ${font.family}`);
  }
  const manifest = { version: VERSION, simpleFormCount: SIMPLE_FORM_COUNT, fonts };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  for (const fileName of await readdir(modelDirectory)) {
    if (fileName.endsWith('.json') && !generatedFiles.has(fileName)) await rm(path.join(modelDirectory, fileName));
  }
  console.log(`Generated ${Object.keys(fontHashes).length * SIMPLE_FORM_COUNT} Telugu simple alignments.`);
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
  await vite.close();
}
