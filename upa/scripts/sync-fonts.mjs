import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(root, 'frontend', 'font-assets.json');
const fontDirectory = path.join(root, 'frontend', 'public', 'fonts');
const licenseDirectory = path.join(fontDirectory, 'licenses');
const lockPath = path.join(fontDirectory, 'font-assets.lock.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const browserHeaders = {
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
};
function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}
async function readJsonIfPresent(filePath) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    throw error;
  }
}
async function fetchBytes(url) {
  const response = await fetch(url, { headers: browserHeaders });
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
  }
  return Buffer.from(await response.arrayBuffer());
}
async function fetchText(url) {
  const response = await fetch(url, { headers: browserHeaders });
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
  }
  return response.text();
}
function parseTeluguWoff2Sources(cssText) {
  const found = new Map();
  const facePattern = /(?:\/\*\s*([^*]+?)\s*\*\/\s*)?@font-face\s*\{([\s\S]*?)\}/g;
  let match;
  while ((match = facePattern.exec(cssText)) !== null) {
    const label = (match[1] ?? '').trim().toLowerCase();
    const body = match[2] ?? '';
    const familyMatch = /font-family:\s*['"]([^'"]+)['"]\s*;/.exec(body);
    const sourceMatch = /src:\s*url\((https:\/\/fonts\.gstatic\.com\/[^)]+\.woff2)\)\s*format\(['"]woff2['"]\)/.exec(
      body,
    );
    const rangeMatch = /unicode-range:\s*([^;]+);/i.exec(body);
    const unicodeRange = rangeMatch?.[1] ?? '';
    const isTelugu = label === 'telugu' || /U\+0C(?:[0-9A-F?]{2})/i.test(unicodeRange);
    if (isTelugu && familyMatch && sourceMatch) {
      found.set(familyMatch[1], sourceMatch[1]);
    }
  }
  return found;
}
async function verifyOrRestoreFromLock(lock) {
  if (!lock || !Array.isArray(lock.fonts)) return false;
  const byFamily = new Map(lock.fonts.map((entry) => [entry.family, entry]));
  for (const asset of manifest) {
    const locked = byFamily.get(asset.family);
    if (!locked) return false;
    const fontPath = path.join(fontDirectory, asset.fileName);
    const licensePath = path.join(licenseDirectory, asset.licenseFileName);
    let fontBytes;
    try {
      fontBytes = await readFile(fontPath);
    } catch (error) {
      if (!error || error.code !== 'ENOENT') throw error;
      fontBytes = await fetchBytes(locked.fontSourceUrl);
      await writeFile(fontPath, fontBytes);
    }
    if (sha256(fontBytes) !== locked.fontSha256) {
      throw new Error(`Font asset hash mismatch: ${asset.fileName}`);
    }
    let licenseBytes;
    try {
      licenseBytes = await readFile(licensePath);
    } catch (error) {
      if (!error || error.code !== 'ENOENT') throw error;
      licenseBytes = Buffer.from(await fetchText(locked.licenseSourceUrl), 'utf8');
      await writeFile(licensePath, licenseBytes);
    }
    if (sha256(licenseBytes) !== locked.licenseSha256) {
      throw new Error(`Font license hash mismatch: ${asset.licenseFileName}`);
    }
  }
  return true;
}
await mkdir(fontDirectory, { recursive: true });
await mkdir(licenseDirectory, { recursive: true });
const existingLock = await readJsonIfPresent(lockPath);
if (await verifyOrRestoreFromLock(existingLock)) {
  console.log('Observation font assets verified.');
  process.exit(0);
}
const cssUrl = new URL('https://fonts.googleapis.com/css2');
for (const asset of manifest) {
  cssUrl.searchParams.append('family', `${asset.family}:wght@400`);
}
cssUrl.searchParams.set('display', 'swap');
const cssText = await fetchText(cssUrl.toString());
const woff2Sources = parseTeluguWoff2Sources(cssText);
const lockEntries = [];
for (const asset of manifest) {
  const fontSourceUrl = woff2Sources.get(asset.family);
  if (!fontSourceUrl) {
    throw new Error(`Google Fonts did not return a Telugu WOFF2 face for ${asset.family}.`);
  }
  const licenseSourceUrl =
    `https://raw.githubusercontent.com/google/fonts/main/ofl/${asset.googleFontsFolder}/OFL.txt`;
  const [fontBytes, licenseText] = await Promise.all([
    fetchBytes(fontSourceUrl),
    fetchText(licenseSourceUrl),
  ]);
  const licenseBytes = Buffer.from(licenseText, 'utf8');
  await writeFile(path.join(fontDirectory, asset.fileName), fontBytes);
  await writeFile(path.join(licenseDirectory, asset.licenseFileName), licenseBytes);
  lockEntries.push({
    family: asset.family,
    fileName: asset.fileName,
    fontSourceUrl,
    fontSha256: sha256(fontBytes),
    licenseFileName: asset.licenseFileName,
    licenseSourceUrl,
    licenseSha256: sha256(licenseBytes),
  });
}
await writeFile(
  lockPath,
  `${JSON.stringify({ version: 1, fonts: lockEntries }, null, 2)}\n`,
  'utf8',
);
console.log('Observation font assets downloaded and locked.');
