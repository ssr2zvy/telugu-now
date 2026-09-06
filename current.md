frontend/src/export-artifact.ts

export type ExportFormat = 'html' | 'epub';
export interface PreparedExportArtifact {
  format: ExportFormat;
  blob: Blob;
  fileName: string;
  entryCount: number;
}
export function downloadPreparedExportArtifact(
  prepared: PreparedExportArtifact,
): void {
  const url = URL.createObjectURL(prepared.blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = prepared.fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

frontend/src/export-viewer.ts

import type { ExportResponse } from '../../shared/contracts';
import { OBSERVATION_PRESENTATION } from './presentation';
function safeJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}
export function buildStandaloneViewerCss(fontFaceCss: string): string {
  return `${fontFaceCss}
html,body{margin:0;width:100%;height:100%;overflow:hidden;font-family:"Noto Sans Telugu","Nirmala UI",sans-serif;background:#707070;color:#171717}
*{box-sizing:border-box}
#viewer{position:relative;width:100%;height:100%;min-height:100vh;display:grid;grid-template-columns:minmax(3.5rem,16vw) 1fr minmax(3.5rem,16vw);background:radial-gradient(circle at 50% 35%,rgba(255,255,255,.22),transparent 42%),linear-gradient(145deg,#9a9a9a 0%,#707070 48%,#515151 100%)}
#text-wrap{display:flex;align-items:center;justify-content:center;min-width:0;min-height:0;padding:2rem .5rem;text-align:center}
#text{width:100%;max-width:min(82vw,70rem);line-height:${OBSERVATION_PRESENTATION.lineHeight};overflow-wrap:anywhere;user-select:none;opacity:0}
button{border:0;background:transparent;color:rgba(20,20,20,.48);font:inherit;cursor:pointer;-webkit-tap-highlight-color:transparent}
.nav{font-family:system-ui,sans-serif;font-size:clamp(2.2rem,6vw,4rem)}
button:disabled{opacity:.24;cursor:default}
#info{position:absolute;top:max(1rem,env(safe-area-inset-top));right:max(1rem,env(safe-area-inset-right));z-index:3;width:2.6rem;height:2.6rem;border-radius:50%;font-family:system-ui,sans-serif;font-weight:700}
#position{position:absolute;left:50%;bottom:max(1rem,env(safe-area-inset-bottom));transform:translateX(-50%);font:600 .8rem system-ui,sans-serif;color:rgba(20,20,20,.55)}
#diagnostic{position:absolute;inset:4.5rem 1rem 4rem 1rem;z-index:5;display:none;overflow:auto;padding:1rem;border-radius:1rem;background:rgba(220,220,220,.96);box-shadow:0 .5rem 2rem rgba(0,0,0,.2)}
#diagnostic.visible{display:block}
#diagnostic table{width:100%;border-collapse:collapse;table-layout:fixed;font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:rgba(20,20,20,.78)}
#diagnostic th,#diagnostic td{padding:.65rem .7rem;border-bottom:1px solid rgba(30,30,30,.1);vertical-align:top;overflow-wrap:anywhere}
#diagnostic tr:last-child th,#diagnostic tr:last-child td{border-bottom:0}
#diagnostic th{width:46%;text-align:left;color:rgba(20,20,20,.6);font-weight:600}
#diagnostic td{width:54%;font-variant-numeric:tabular-nums}
`;
}
export function buildStandaloneViewerMarkup(): string {
  return `<main id="viewer">
<button id="back" class="nav" type="button" aria-label="వెనుక">‹</button>
<div id="text-wrap"><div id="text"></div></div>
<button id="next" class="nav" type="button" aria-label="తర్వాత">›</button>
<button id="info" type="button" aria-label="సమాచారం">i</button>
<div id="position"></div>
<section id="diagnostic" aria-label="Diagnostic"><table><tbody id="diagnostic-body"></tbody></table></section>
</main>`;
}
export function buildStandaloneViewerScript(result: ExportResponse): string {
  const serialized = safeJson(result);
  const presentation = safeJson(OBSERVATION_PRESENTATION);
  return `const DATA=${serialized};
const PRESENTATION=${presentation};
let index=0;
let activeFontFamily=null;
let activationSerial=0;
let resizeFrame=null;
const textWrap=document.getElementById('text-wrap');
const text=document.getElementById('text');
const back=document.getElementById('back');
const next=document.getElementById('next');
const position=document.getElementById('position');
const diagnostic=document.getElementById('diagnostic');
const diagnosticBody=document.getElementById('diagnostic-body');
function clamp(minimum,maximum,value){return Math.min(maximum,Math.max(minimum,value))}
function number(value){if(value===0)return '0';if(Math.abs(value)<0.000001)return value.toExponential(6);return value.toFixed(8).replace(/0+$/,'').replace(/\\.$/,'')}
function percent(value){return (value*100).toFixed(4)+'%'}
function time(value){if(value===null)return '—';return new Date(value).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'})}
function sourceName(sourceId){const match=/^source(\\d+)$/.exec(sourceId);return match?match[1]:sourceId}
function sourceWeights(weights){return Object.entries(weights).sort(function(a,b){return a[0].localeCompare(b[0])}).map(function(pair){return sourceName(pair[0])+': '+number(pair[1])}).join(' · ')}
function escapeHtml(value){return String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;')}
function rowsFor(entry){
  const diagnosticValue=entry.diagnostic;
  const selection=diagnosticValue.selection;
  return [
    ['Export position',entry.position],
    ['Cache hit',diagnosticValue.cacheHit?'Yes':'No'],
    ['Request start',time(diagnosticValue.requestStartedAt)],
    ['Request end',time(diagnosticValue.requestCompletedAt)],
    ['Request duration',diagnosticValue.requestDurationMs===null?'—':diagnosticValue.requestDurationMs+' ms'],
    ['Source weights',sourceWeights(selection.sourceWeights)],
    ['Source',selection.sourceId],
    ['Source rows',selection.sourceRowCount],
    ['Source weight',number(selection.sourceWeight)],
    ['Source mass',number(selection.sourceMass)],
    ['Total source mass',number(selection.totalSourceMass)],
    ['Source probability',percent(selection.sourceProbability)],
    ['Row',selection.sourceKey],
    ['Word count',selection.wordCount],
    ['Complexity reference','v'+selection.complexityReferenceVersion],
    ['Complexity target',percent(selection.complexityPercentileTarget)],
    ['Complexity spread','±'+percent(selection.complexityPercentileSpread)],
    ['Derived sigma',number(selection.derivedStandardDeviation)],
    ['Global percentile interval',percent(selection.globalPercentileStart)+'–'+percent(selection.globalPercentileEnd)],
    ['Global interval mass',number(selection.globalIntervalMass)],
    ['Global rows at word count',selection.globalRowsAtWordCount],
    ['Global per-row complexity mass',number(selection.globalPerRowComplexityMass)],
    ['Source rows at word count',selection.selectedSourceRowsAtWordCount],
    ['Source complexity denominator',number(selection.selectedSourceNormalizationDenominator)],
    ['Row probability within source',percent(selection.rowProbabilityWithinSource)],
    ['Overall probability',percent(selection.overallProbability)]
  ];
}
function renderDiagnostic(entry){diagnosticBody.innerHTML=rowsFor(entry).map(function(row){return '<tr><th scope="row">'+escapeHtml(row[0])+'</th><td>'+escapeHtml(row[1])+'</td></tr>'}).join('')}
function preferredSize(value,width,height){
  const normalized=value.trim().replace(/\\s+/g,' ');
  if(!normalized)return PRESENTATION.emptyFontSizePx;
  const words=normalized.split(' ').length;
  const nonWhitespaceCharacters=Array.from(normalized.replace(/\\s/g,'')).length;
  const contentLoad=Math.max(1,words+nonWhitespaceCharacters/PRESENTATION.contentCharacterDivisor);
  const heightBase=clamp(PRESENTATION.heightBaseMinimumPx,PRESENTATION.heightBaseMaximumPx,height*PRESENTATION.heightFraction);
  const widthScale=clamp(PRESENTATION.widthScaleMinimum,PRESENTATION.widthScaleMaximum,width/PRESENTATION.widthReferencePx);
  const size=(heightBase*widthScale)/Math.pow(contentLoad,PRESENTATION.contentExponent);
  return clamp(PRESENTATION.preferredMinimumFontSizePx,PRESENTATION.preferredMaximumFontSizePx,size);
}
function chooseFont(){
  const raw=Math.random();
  const normalized=Number.isFinite(raw)?clamp(0,0.9999999999999999,raw):0;
  return PRESENTATION.fonts[Math.floor(normalized*PRESENTATION.fonts.length)];
}
function fitActive(){
  const entry=DATA.entries[index];
  if(!entry||!activeFontFamily)return;
  const rect=textWrap.getBoundingClientRect();
  const availableHeight=Math.max(1,rect.height-PRESENTATION.fitVerticalReservePx);
  const desired=preferredSize(entry.text,rect.width,availableHeight);
  let low=PRESENTATION.fitMinimumFontSizePx;
  let high=desired;
  let best=Math.min(low,desired);
  for(let iteration=0;iteration<PRESENTATION.fitIterations;iteration+=1){
    const candidate=(low+high)/2;
    text.style.fontSize=candidate+'px';
    const fitsWidth=text.scrollWidth<=text.clientWidth+1;
    const fitsHeight=text.scrollHeight<=availableHeight+1;
    if(fitsWidth&&fitsHeight){best=candidate;low=candidate}else{high=candidate}
  }
  const finalSize=Math.max(PRESENTATION.fitMinimumFontSizePx,Math.min(desired,best));
  text.style.fontSize=finalSize+'px';
}
async function activate(nextIndex){
  index=nextIndex;
  const serial=++activationSerial;
  const entry=DATA.entries[index];
  activeFontFamily=chooseFont();
  text.style.opacity='0';
  text.style.fontFamily='"'+activeFontFamily+'", "Noto Sans Telugu", "Nirmala UI", sans-serif';
  text.style.fontWeight=String(PRESENTATION.fontWeight);
  text.textContent=entry.text;
  back.disabled=index===0;
  next.disabled=index===DATA.entries.length-1;
  position.textContent=(index+1)+' / '+DATA.entries.length;
  renderDiagnostic(entry);
  diagnostic.classList.remove('visible');
  try{
    if(document.fonts&&document.fonts.load){
      await document.fonts.load(PRESENTATION.fontWeight+' '+PRESENTATION.preferredMinimumFontSizePx+'px "'+activeFontFamily+'"',entry.text.slice(0,64));
    }
  }catch{}
  if(serial!==activationSerial)return;
  fitActive();
  text.style.opacity='1';
}
back.addEventListener('click',function(event){event.preventDefault();event.stopPropagation();if(index>0)void activate(index-1)});
next.addEventListener('click',function(event){event.preventDefault();event.stopPropagation();if(index<DATA.entries.length-1)void activate(index+1)});
document.getElementById('info').addEventListener('click',function(event){event.preventDefault();event.stopPropagation();diagnostic.classList.toggle('visible')});
window.addEventListener('resize',function(){
  if(resizeFrame!==null&&window.cancelAnimationFrame)window.cancelAnimationFrame(resizeFrame);
  const schedule=window.requestAnimationFrame||function(callback){return window.setTimeout(callback,0)};
  resizeFrame=schedule(function(){resizeFrame=null;fitActive()});
});
if(DATA.entries.length>0){void activate(0)}else{text.textContent='...';text.style.opacity='1';back.disabled=true;next.disabled=true;position.textContent='0 / 0'}
`;
}

frontend/src/font-assets.ts

import rawFontAssets from '../font-assets.json' with { type: 'json' };
import {
  OBSERVATION_FONTS,
  OBSERVATION_PRESENTATION,
  type ObservationFontFamily,
} from './presentation';
export interface ObservationFontAsset {
  family: ObservationFontFamily;
  fileName: string;
  licenseFileName: string;
  googleFontsFolder: string;
}
export interface LoadedObservationFont {
  family: ObservationFontFamily;
  fileName: string;
  licenseFileName: string;
  bytes: Uint8Array;
  licenseText: string;
}
export interface ObservationFontBundle {
  fonts: readonly LoadedObservationFont[];
}
export interface EmbeddedObservationFont {
  family: ObservationFontFamily;
  dataUrl: string;
  licenseText: string;
}
export interface EmbeddedObservationFontBundle {
  fonts: readonly EmbeddedObservationFont[];
}
function isObservationFontFamily(value: string): value is ObservationFontFamily {
  return (OBSERVATION_FONTS as readonly string[]).includes(value);
}
function validateAsset(value: (typeof rawFontAssets)[number]): ObservationFontAsset {
  if (!isObservationFontFamily(value.family)) {
    throw new Error(`Unknown observation font family: ${value.family}`);
  }
  if (!/^[a-z0-9-]+\.woff2$/.test(value.fileName)) {
    throw new Error(`Invalid observation font file name: ${value.fileName}`);
  }
  if (!/^[a-z0-9-]+-OFL\.txt$/.test(value.licenseFileName)) {
    throw new Error(`Invalid observation font license file name: ${value.licenseFileName}`);
  }
  if (!/^[a-z0-9]+$/.test(value.googleFontsFolder)) {
    throw new Error(`Invalid Google Fonts folder: ${value.googleFontsFolder}`);
  }
  return {
    family: value.family,
    fileName: value.fileName,
    licenseFileName: value.licenseFileName,
    googleFontsFolder: value.googleFontsFolder,
  };
}
export const OBSERVATION_FONT_ASSETS: readonly ObservationFontAsset[] =
  rawFontAssets.map(validateAsset);
const assetFamilies = OBSERVATION_FONT_ASSETS.map((asset) => asset.family);
if (
  assetFamilies.length !== OBSERVATION_FONTS.length ||
  OBSERVATION_FONTS.some((family, index) => assetFamilies[index] !== family)
) {
  throw new Error('Observation font asset manifest must exactly match OBSERVATION_FONTS.');
}
function localFontUrl(fileName: string): string {
  return `/fonts/${fileName}`;
}
function localLicenseUrl(fileName: string): string {
  return `/fonts/licenses/${fileName}`;
}
function cssString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
export function observationFontFaceCss(
  sources: readonly { family: ObservationFontFamily; source: string }[],
): string {
  return sources
    .map(
      ({ family, source }) =>
        `@font-face{font-family:"${cssString(family)}";src:url("${source}") format("woff2");font-style:normal;font-weight:${OBSERVATION_PRESENTATION.fontWeight};font-display:swap}`,
    )
    .join('\n');
}
let liveFontFacesInstalled = false;
export function installLiveObservationFontFaces(
  documentValue: Document = document,
): void {
  if (
    liveFontFacesInstalled ||
    documentValue.getElementById('telugu-now-observation-fonts')
  ) {
    liveFontFacesInstalled = true;
    return;
  }
  const style = documentValue.createElement('style');
  style.id = 'telugu-now-observation-fonts';
  style.textContent = observationFontFaceCss(
    OBSERVATION_FONT_ASSETS.map((asset) => ({
      family: asset.family,
      source: localFontUrl(asset.fileName),
    })),
  );
  documentValue.head.appendChild(style);
  liveFontFacesInstalled = true;
}
function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length));
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}
async function fetchRequired(
  fetchValue: typeof fetch,
  url: string,
): Promise<Response> {
  const response = await fetchValue(url);
  if (!response.ok) {
    throw new Error(`Failed to load application font asset ${url}: ${response.status}`);
  }
  return response;
}
export async function loadObservationFontBundle(
  fetchValue: typeof fetch = fetch,
): Promise<ObservationFontBundle> {
  const fonts = await Promise.all(
    OBSERVATION_FONT_ASSETS.map(async (asset): Promise<LoadedObservationFont> => {
      const [fontResponse, licenseResponse] = await Promise.all([
        fetchRequired(fetchValue, localFontUrl(asset.fileName)),
        fetchRequired(fetchValue, localLicenseUrl(asset.licenseFileName)),
      ]);
      const [fontBuffer, licenseText] = await Promise.all([
        fontResponse.arrayBuffer(),
        licenseResponse.text(),
      ]);
      return {
        family: asset.family,
        fileName: asset.fileName,
        licenseFileName: asset.licenseFileName,
        bytes: new Uint8Array(fontBuffer),
        licenseText,
      };
    }),
  );
  return { fonts };
}
export function toEmbeddedObservationFontBundle(
  bundle: ObservationFontBundle,
): EmbeddedObservationFontBundle {
  return {
    fonts: bundle.fonts.map((font) => ({
      family: font.family,
      dataUrl: `data:font/woff2;base64,${bytesToBase64(font.bytes)}`,
      licenseText: font.licenseText,
    })),
  };
}
export async function loadEmbeddedObservationFontBundle(
  fetchValue: typeof fetch = fetch,
): Promise<EmbeddedObservationFontBundle> {
  return toEmbeddedObservationFontBundle(
    await loadObservationFontBundle(fetchValue),
  );
}
export function createPlaceholderEmbeddedObservationFontBundle(): EmbeddedObservationFontBundle {
  return {
    fonts: OBSERVATION_FONTS.map((family) => ({
      family,
      dataUrl: 'data:font/woff2;base64,',
      licenseText: '',
    })),
  };
}

frontend/src/export-html.ts

import type { ExportResponse } from '../../shared/contracts';
import type { PreparedExportArtifact } from './export-artifact';
import {
  createPlaceholderEmbeddedObservationFontBundle,
  loadEmbeddedObservationFontBundle,
  observationFontFaceCss,
  type EmbeddedObservationFontBundle,
} from './font-assets';
import {
  buildStandaloneViewerCss,
  buildStandaloneViewerMarkup,
  buildStandaloneViewerScript,
} from './export-viewer';
function safeJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}
function embeddedFontCss(bundle: EmbeddedObservationFontBundle): string {
  return observationFontFaceCss(
    bundle.fonts.map((font) => ({
      family: font.family,
      source: font.dataUrl,
    })),
  );
}
export function buildStandaloneExportHtml(
  result: ExportResponse,
  fontBundle: EmbeddedObservationFontBundle =
    createPlaceholderEmbeddedObservationFontBundle(),
): string {
  const fontFaces = embeddedFontCss(fontBundle);
  const viewerCss = buildStandaloneViewerCss(fontFaces);
  const viewerMarkup = buildStandaloneViewerMarkup();
  const viewerScript = buildStandaloneViewerScript(result);
  const licenseNotices = safeJson(
    fontBundle.fonts.map((font) => ({
      family: font.family,
      licenseText: font.licenseText,
    })),
  );
  return `<!doctype html>
<html lang="te">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>తెలుగు</title>
<style>${viewerCss}</style>
</head>
<body>
${viewerMarkup}
<script type="application/json" id="font-license-notices">${licenseNotices}</script>
<script>${viewerScript}</script>
</body>
</html>`;
}
export async function prepareHtmlExport(
  result: ExportResponse,
): Promise<PreparedExportArtifact> {
  const fontBundle = await loadEmbeddedObservationFontBundle();
  const html = buildStandaloneExportHtml(result, fontBundle);
  return {
    format: 'html',
    blob: new Blob([html], { type: 'text/html;charset=utf-8' }),
    fileName: `telugu-export-${result.entries.length}.html`,
    entryCount: result.entries.length,
  };
}

frontend/src/zip.ts

const UTF8_FLAG = 0x0800;
const STORE_METHOD = 0;
const DOS_TIME = 0;
const DOS_DATE = 0x0021;
export interface StoredZipEntry {
  name: string;
  data: Uint8Array | string;
}
function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}
function asBytes(value: Uint8Array | string): Uint8Array {
  return typeof value === 'string' ? utf8(value) : value;
}
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      const mask = -(crc & 1);
      crc = (crc >>> 1) ^ (0xedb88320 & mask);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function writeUint16(view: DataView, offset: number, value: number): void {
  view.setUint16(offset, value, true);
}
function writeUint32(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value >>> 0, true);
}
function concatenate(parts: readonly Uint8Array[]): Uint8Array {
  const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}
export function createStoredZip(entries: readonly StoredZipEntry[]): Uint8Array {
  if (entries.length === 0) {
    throw new Error('ZIP archive must contain at least one entry.');
  }
  if (entries.length > 0xffff) {
    throw new Error('ZIP64 is not supported.');
  }
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let localOffset = 0;
  for (const entry of entries) {
    if (!entry.name || entry.name.startsWith('/') || entry.name.includes('\\')) {
      throw new Error(`Invalid ZIP entry name: ${entry.name}`);
    }
    const nameBytes = utf8(entry.name);
    const data = asBytes(entry.data);
    if (nameBytes.length > 0xffff) {
      throw new Error(`ZIP entry name is too long: ${entry.name}`);
    }
    if (data.length > 0xffffffff) {
      throw new Error(`ZIP64 is required for entry: ${entry.name}`);
    }
    const checksum = crc32(data);
    const localHeader = new Uint8Array(30 + nameBytes.length);
    const localView = new DataView(localHeader.buffer);
    writeUint32(localView, 0, 0x04034b50);
    writeUint16(localView, 4, 20);
    writeUint16(localView, 6, UTF8_FLAG);
    writeUint16(localView, 8, STORE_METHOD);
    writeUint16(localView, 10, DOS_TIME);
    writeUint16(localView, 12, DOS_DATE);
    writeUint32(localView, 14, checksum);
    writeUint32(localView, 18, data.length);
    writeUint32(localView, 22, data.length);
    writeUint16(localView, 26, nameBytes.length);
    writeUint16(localView, 28, 0);
    localHeader.set(nameBytes, 30);
    localParts.push(localHeader, data);
    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(centralHeader.buffer);
    writeUint32(centralView, 0, 0x02014b50);
    writeUint16(centralView, 4, 20);
    writeUint16(centralView, 6, 20);
    writeUint16(centralView, 8, UTF8_FLAG);
    writeUint16(centralView, 10, STORE_METHOD);
    writeUint16(centralView, 12, DOS_TIME);
    writeUint16(centralView, 14, DOS_DATE);
    writeUint32(centralView, 16, checksum);
    writeUint32(centralView, 20, data.length);
    writeUint32(centralView, 24, data.length);
    writeUint16(centralView, 28, nameBytes.length);
    writeUint16(centralView, 30, 0);
    writeUint16(centralView, 32, 0);
    writeUint16(centralView, 34, 0);
    writeUint16(centralView, 36, 0);
    writeUint32(centralView, 38, 0);
    writeUint32(centralView, 42, localOffset);
    centralHeader.set(nameBytes, 46);
    centralParts.push(centralHeader);
    localOffset += localHeader.length + data.length;
    if (localOffset > 0xffffffff) {
      throw new Error('ZIP64 is required for this archive.');
    }
  }
  const centralDirectory = concatenate(centralParts);
  if (centralDirectory.length > 0xffffffff) {
    throw new Error('ZIP64 is required for this archive.');
  }
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  writeUint32(endView, 0, 0x06054b50);
  writeUint16(endView, 4, 0);
  writeUint16(endView, 6, 0);
  writeUint16(endView, 8, entries.length);
  writeUint16(endView, 10, entries.length);
  writeUint32(endView, 12, centralDirectory.length);
  writeUint32(endView, 16, localOffset);
  writeUint16(endView, 20, 0);
  return concatenate([...localParts, centralDirectory, end]);
}

frontend/src/export-epub.ts

import type { ExportResponse } from '../../shared/contracts';
import type { PreparedExportArtifact } from './export-artifact';
import {
  OBSERVATION_FONT_ASSETS,
  loadObservationFontBundle,
  observationFontFaceCss,
  type ObservationFontBundle,
} from './font-assets';
import {
  buildStandaloneViewerCss,
  buildStandaloneViewerMarkup,
  buildStandaloneViewerScript,
} from './export-viewer';
import { createStoredZip, type StoredZipEntry } from './zip';
export interface EpubBuildOptions {
  identifier?: string;
  modified?: string;
}
function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
function makeIdentifier(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `urn:uuid:${crypto.randomUUID()}`;
  }
  return `urn:telugu-now:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}
function epubModifiedNow(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}
function buildContainerXml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;
}
function buildNavXhtml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="te" xml:lang="te">
<head>
  <meta charset="utf-8" />
  <title>తెలుగు</title>
</head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>తెలుగు</h1>
    <ol>
      <li><a href="viewer.xhtml">తెలుగు</a></li>
    </ol>
  </nav>
  <nav epub:type="landmarks">
    <h2>Landmarks</h2>
    <ol>
      <li><a epub:type="bodymatter" href="viewer.xhtml">తెలుగు</a></li>
    </ol>
  </nav>
</body>
</html>`;
}
function buildViewerXhtml(): string {
  const markup = buildStandaloneViewerMarkup();
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="te" xml:lang="te">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover" />
  <title>తెలుగు</title>
  <link rel="stylesheet" type="text/css" href="viewer.css" />
</head>
<body>
${markup}
<script type="text/javascript" src="viewer.js"></script>
</body>
</html>`;
}
function buildPackageOpf(
  identifier: string,
  modified: string,
  fontBundle: ObservationFontBundle,
): string {
  const fontItems = fontBundle.fonts
    .map(
      (font, index) =>
        `    <item id="font-${index + 1}" href="fonts/${xmlEscape(font.fileName)}" media-type="font/woff2"/>`,
    )
    .join('\n');
  const licenseItems = fontBundle.fonts
    .map(
      (font, index) =>
        `    <item id="font-license-${index + 1}" href="licenses/${xmlEscape(font.licenseFileName)}" media-type="text/plain"/>`,
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id" xml:lang="te">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="pub-id">${xmlEscape(identifier)}</dc:identifier>
    <dc:title>తెలుగు</dc:title>
    <dc:language>te</dc:language>
    <meta property="dcterms:modified">${xmlEscape(modified)}</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="viewer" href="viewer.xhtml" media-type="application/xhtml+xml" properties="scripted"/>
    <item id="viewer-css" href="viewer.css" media-type="text/css"/>
    <item id="viewer-js" href="viewer.js" media-type="application/javascript"/>
    <item id="export-data" href="data.json" media-type="application/json"/>
${fontItems}
${licenseItems}
  </manifest>
  <spine>
    <itemref idref="viewer"/>
  </spine>
</package>`;
}
function relativeFontCss(fontBundle: ObservationFontBundle): string {
  return observationFontFaceCss(
    fontBundle.fonts.map((font) => ({
      family: font.family,
      source: `fonts/${font.fileName}`,
    })),
  );
}
export function buildEpubBytes(
  result: ExportResponse,
  fontBundle: ObservationFontBundle,
  options: EpubBuildOptions = {},
): Uint8Array {
  if (fontBundle.fonts.length !== OBSERVATION_FONT_ASSETS.length) {
    throw new Error('EPUB font bundle must contain the complete observation font collection.');
  }
  const identifier = options.identifier ?? makeIdentifier();
  const modified = options.modified ?? epubModifiedNow();
  const viewerCss = buildStandaloneViewerCss(relativeFontCss(fontBundle));
  const viewerScript = buildStandaloneViewerScript(result);
  const viewerXhtml = buildViewerXhtml();
  const navXhtml = buildNavXhtml();
  const packageOpf = buildPackageOpf(identifier, modified, fontBundle);
  const entries: StoredZipEntry[] = [
    {
      name: 'mimetype',
      data: 'application/epub+zip',
    },
    {
      name: 'META-INF/container.xml',
      data: buildContainerXml(),
    },
    {
      name: 'EPUB/package.opf',
      data: packageOpf,
    },
    {
      name: 'EPUB/nav.xhtml',
      data: navXhtml,
    },
    {
      name: 'EPUB/viewer.xhtml',
      data: viewerXhtml,
    },
    {
      name: 'EPUB/viewer.css',
      data: viewerCss,
    },
    {
      name: 'EPUB/viewer.js',
      data: viewerScript,
    },
    {
      name: 'EPUB/data.json',
      data: JSON.stringify(result),
    },
  ];
  for (const font of fontBundle.fonts) {
    entries.push(
      {
        name: `EPUB/fonts/${font.fileName}`,
        data: font.bytes,
      },
      {
        name: `EPUB/licenses/${font.licenseFileName}`,
        data: font.licenseText,
      },
    );
  }
  return createStoredZip(entries);
}
export async function prepareEpubExport(
  result: ExportResponse,
): Promise<PreparedExportArtifact> {
  const fontBundle = await loadObservationFontBundle();
  const bytes = buildEpubBytes(result, fontBundle);
  return {
    format: 'epub',
    blob: new Blob([bytes.buffer as ArrayBuffer], { type: 'application/epub+zip' }),
    fileName: `telugu-export-${result.entries.length}.epub`,
    entryCount: result.entries.length,
  };
}

frontend/src/settings/language.ts

import type { UiLanguage } from './types';
const SETTINGS_LANGUAGE_KEY = 'telugu-now-settings-language';
export const COPY = {
  en: {
    settings: 'Settings',
    complexity: 'Complexity',
    sourceWeights: 'Source weights',
    diagnostic: 'Diagnostic',
    export: 'Export',
    target: 'Target (%)',
    spread: 'Spread (%)',
    save: 'Save',
    saving: 'Saving…',
    invalidValues: 'Invalid values',
    count: 'Count',
    exporting: 'Exporting…',
    download: 'Download',
    ready: 'Ready',
    invalidExport: 'Invalid count or export failed',
    close: 'Close',
    back: 'Back',
    language: 'Switch language',
    yes: 'Yes',
    no: 'No',
    unavailable: 'Unavailable',
    initialFill: 'Initial fill',
    observationConsumed: 'Observation consumed',
    chooseExportFormat: 'Choose export format',
    epub: 'EPUB',
    epubDescription: 'iPhone / iPad · Apple Books · Interactive · Offline',
    html: 'HTML',
    htmlDescription: 'Browser / Desktop · Interactive · Offline',
    cancel: 'Cancel',
  },
  te: {
    settings: 'అమరికలు',
    complexity: 'సంక్లిష్టత',
    sourceWeights: 'మూల బరువులు',
    diagnostic: 'నిర్ధారణ సమాచారం',
    export: 'ఎగుమతి',
    target: 'లక్ష్యం (%)',
    spread: 'వ్యాప్తి (%)',
    save: 'భద్రపరచు',
    saving: 'భద్రపరుస్తోంది…',
    invalidValues: 'చెల్లని విలువలు',
    count: 'సంఖ్య',
    exporting: 'ఎగుమతి అవుతోంది…',
    download: 'డౌన్‌లోడ్',
    ready: 'సిద్ధం',
    invalidExport: 'చెల్లని సంఖ్య లేదా ఎగుమతి విఫలమైంది',
    close: 'మూసివేయి',
    back: 'వెనుక',
    language: 'భాష మార్చు',
    yes: 'అవును',
    no: 'కాదు',
    unavailable: 'అందుబాటులో లేదు',
    initialFill: 'ప్రారంభ నింపుదల',
    observationConsumed: 'పరిశీలన వినియోగం',
    chooseExportFormat: 'ఎగుమతి రూపాన్ని ఎంచుకోండి',
    epub: 'EPUB',
    epubDescription: 'iPhone / iPad · Apple Books · పరస్పర · ఆఫ్‌లైన్',
    html: 'HTML',
    htmlDescription: 'బ్రౌజర్ / డెస్క్‌టాప్ · పరస్పర · ఆఫ్‌లైన్',
    cancel: 'రద్దు',
  },
} as const;
export function t(
  language: UiLanguage,
  key: keyof typeof COPY.en,
): string {
  return COPY[language][key];
}
export function loadSettingsLanguage(): UiLanguage {
  const stored = window.localStorage.getItem(SETTINGS_LANGUAGE_KEY);
  return stored === 'en' || stored === 'te' ? stored : 'te';
}
export function saveSettingsLanguage(language: UiLanguage): void {
  window.localStorage.setItem(SETTINGS_LANGUAGE_KEY, language);
}

frontend/src/settings/useSettingsController.ts

import { useState } from 'react';
import type {
  ExportResponse,
  ProfileSelectionSettings,
  ProfileStateResponse,
} from '../../../shared/contracts';
import { generateExport, updateSelectionSettings } from '../api';
import type {
  ExportFormat,
  PreparedExportArtifact,
} from '../export-artifact';
import { prepareEpubExport } from '../export-epub';
import { prepareHtmlExport } from '../export-html';
import {
  loadSettingsLanguage,
  saveSettingsLanguage,
} from './language';
import { draftFromSettings } from './settings-utils';
import type {
  SettingsDraft,
  SettingsPage,
  UiLanguage,
} from './types';
interface UseSettingsControllerOptions {
  profileCode: string | null;
  state: ProfileStateResponse | null;
  onSettingsSaved: (settings: ProfileSelectionSettings) => void;
}
export interface SettingsController {
  page: SettingsPage;
  language: UiLanguage;
  draft: SettingsDraft | null;
  settingsSaving: boolean;
  settingsError: boolean;
  exportCount: string;
  exporting: boolean;
  exportError: boolean;
  formatChooserOpen: boolean;
  generatedExport: ExportResponse | null;
  preparedArtifact: PreparedExportArtifact | null;
  prepareOpen: () => void;
  enterPage: (page: Exclude<SettingsPage, 'index'>) => void;
  backToIndex: () => void;
  toggleLanguage: () => void;
  setDraft: (draft: SettingsDraft) => void;
  clearSettingsError: () => void;
  saveComplexitySettings: () => Promise<void>;
  saveSourceSettings: () => Promise<void>;
  setExportCount: (count: string) => void;
  requestExport: () => void;
  cancelFormatChoice: () => void;
  chooseExportFormat: (format: ExportFormat) => Promise<void>;
}
export function useSettingsController({
  profileCode,
  state,
  onSettingsSaved,
}: UseSettingsControllerOptions): SettingsController {
  const [page, setPage] = useState<SettingsPage>('index');
  const [language, setLanguage] = useState<UiLanguage>(() =>
    loadSettingsLanguage(),
  );
  const [draft, setDraftState] = useState<SettingsDraft | null>(null);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsError, setSettingsError] = useState(false);
  const [exportCount, setExportCountState] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState(false);
  const [formatChooserOpen, setFormatChooserOpen] = useState(false);
  const [generatedExport, setGeneratedExport] = useState<ExportResponse | null>(null);
  const [preparedArtifact, setPreparedArtifact] =
    useState<PreparedExportArtifact | null>(null);
  const invalidateExport = () => {
    setGeneratedExport(null);
    setPreparedArtifact(null);
    setFormatChooserOpen(false);
    setExportError(false);
  };
  const prepareOpen = () => {
    if (!state) return;
    setDraftState(draftFromSettings(state.selectionSettings));
    setSettingsError(false);
    setExportError(false);
    setFormatChooserOpen(false);
    setPage('index');
  };
  const enterPage = (
    nextPage: Exclude<SettingsPage, 'index'>,
  ) => {
    if (
      state &&
      (nextPage === 'complexity' || nextPage === 'sources')
    ) {
      setDraftState(draftFromSettings(state.selectionSettings));
    }
    setSettingsError(false);
    setExportError(false);
    setFormatChooserOpen(false);
    setPage(nextPage);
  };
  const backToIndex = () => {
    setSettingsError(false);
    setExportError(false);
    setFormatChooserOpen(false);
    setPage('index');
  };
  const toggleLanguage = () => {
    setLanguage((current) => {
      const next = current === 'te' ? 'en' : 'te';
      saveSettingsLanguage(next);
      return next;
    });
  };
  const saveComplexitySettings = async () => {
    if (!profileCode || !state || !draft) return;
    const target = Number(draft.targetPercent) / 100;
    const spread = Number(draft.spreadPercent) / 100;
    const valid =
      Number.isFinite(target) &&
      target >= 0 &&
      target <= 1 &&
      Number.isFinite(spread) &&
      spread > 0;
    if (!valid) {
      setSettingsError(true);
      return;
    }
    setSettingsSaving(true);
    setSettingsError(false);
    try {
      const saved = await updateSelectionSettings(profileCode, {
        sourceWeights: state.selectionSettings.sourceWeights,
        complexityPercentileTarget: target,
        complexityPercentileSpread: spread,
      });
      onSettingsSaved(saved);
      setDraftState(draftFromSettings(saved));
      invalidateExport();
    } catch {
      setSettingsError(true);
    } finally {
      setSettingsSaving(false);
    }
  };
  const saveSourceSettings = async () => {
    if (!profileCode || !state || !draft) return;
    const sourceWeights = Object.fromEntries(
      Object.entries(draft.sourceWeights).map(([sourceId, value]) => [
        sourceId,
        Number(value),
      ]),
    );
    const weights = Object.values(sourceWeights);
    const valid =
      weights.length > 0 &&
      weights.every(
        (value) =>
          Number.isFinite(value) &&
          value >= 0 &&
          value <= 1,
      ) &&
      Math.max(...weights) === 1;
    if (!valid) {
      setSettingsError(true);
      return;
    }
    setSettingsSaving(true);
    setSettingsError(false);
    try {
      const saved = await updateSelectionSettings(profileCode, {
        sourceWeights,
        complexityPercentileTarget:
          state.selectionSettings.complexityPercentileTarget,
        complexityPercentileSpread:
          state.selectionSettings.complexityPercentileSpread,
      });
      onSettingsSaved(saved);
      setDraftState(draftFromSettings(saved));
      invalidateExport();
    } catch {
      setSettingsError(true);
    } finally {
      setSettingsSaving(false);
    }
  };
  const setExportCount = (count: string) => {
    setExportCountState(count);
    invalidateExport();
  };
  const requestExport = () => {
    const count = Number(exportCount);
    if (!Number.isInteger(count) || count <= 0) {
      setFormatChooserOpen(false);
      setPreparedArtifact(null);
      setExportError(true);
      return;
    }
    setExportError(false);
    setFormatChooserOpen(true);
  };
  const chooseExportFormat = async (format: ExportFormat) => {
    if (!profileCode) return;
    const count = Number(exportCount);
    if (!Number.isInteger(count) || count <= 0) {
      setFormatChooserOpen(false);
      setExportError(true);
      return;
    }
    setFormatChooserOpen(false);
    setExporting(true);
    setExportError(false);
    setPreparedArtifact(null);
    try {
      let result = generatedExport;
      if (!result) {
        result = await generateExport(profileCode, { count });
        setGeneratedExport(result);
      }
      const prepared =
        format === 'epub'
          ? await prepareEpubExport(result)
          : await prepareHtmlExport(result);
      setPreparedArtifact(prepared);
    } catch {
      setExportError(true);
    } finally {
      setExporting(false);
    }
  };
  return {
    page,
    language,
    draft,
    settingsSaving,
    settingsError,
    exportCount,
    exporting,
    exportError,
    formatChooserOpen,
    generatedExport,
    preparedArtifact,
    prepareOpen,
    enterPage,
    backToIndex,
    toggleLanguage,
    setDraft: setDraftState,
    clearSettingsError: () => setSettingsError(false),
    saveComplexitySettings,
    saveSourceSettings,
    setExportCount,
    requestExport,
    cancelFormatChoice: () => setFormatChooserOpen(false),
    chooseExportFormat,
  };
}

frontend/src/settings/SettingsView.tsx

import type { ProfileStateResponse } from '../../../shared/contracts';
import { t } from './language';
import { SettingsShell } from './SettingsShell';
import type { SettingsController } from './useSettingsController';
import { ComplexityPage } from './pages/ComplexityPage';
import { DiagnosticPage } from './pages/DiagnosticPage';
import { ExportPage } from './pages/ExportPage';
import { SettingsIndex } from './pages/SettingsIndex';
import { SourceWeightsPage } from './pages/SourceWeightsPage';
interface SettingsViewProps {
  state: ProfileStateResponse;
  controller: SettingsController;
  onClose: () => void;
}
export function SettingsView({
  state,
  controller,
  onClose,
}: SettingsViewProps) {
  const {
    page,
    language,
    draft,
    settingsSaving,
    settingsError,
    exportCount,
    exporting,
    exportError,
    formatChooserOpen,
    preparedArtifact,
  } = controller;
  const shellProps = {
    language,
    onClose,
    onToggleLanguage: controller.toggleLanguage,
  };
  if (page === 'index') {
    return (
      <SettingsShell
        {...shellProps}
        title={t(language, 'settings')}
      >
        <SettingsIndex
          language={language}
          onNavigate={controller.enterPage}
        />
      </SettingsShell>
    );
  }
  if (!draft) {
    return null;
  }
  if (page === 'complexity') {
    return (
      <SettingsShell
        {...shellProps}
        title={t(language, 'complexity')}
        onBack={controller.backToIndex}
      >
        <ComplexityPage
          language={language}
          draft={draft}
          saving={settingsSaving}
          error={settingsError}
          onDraftChange={controller.setDraft}
          onClearError={controller.clearSettingsError}
          onSave={() => void controller.saveComplexitySettings()}
        />
      </SettingsShell>
    );
  }
  if (page === 'sources') {
    return (
      <SettingsShell
        {...shellProps}
        title={t(language, 'sourceWeights')}
        onBack={controller.backToIndex}
      >
        <SourceWeightsPage
          language={language}
          draft={draft}
          saving={settingsSaving}
          error={settingsError}
          onDraftChange={controller.setDraft}
          onClearError={controller.clearSettingsError}
          onSave={() => void controller.saveSourceSettings()}
        />
      </SettingsShell>
    );
  }
  if (page === 'diagnostic') {
    return (
      <SettingsShell
        {...shellProps}
        title={t(language, 'diagnostic')}
        onBack={controller.backToIndex}
      >
        <DiagnosticPage
          state={state}
          language={language}
        />
      </SettingsShell>
    );
  }
  return (
    <SettingsShell
      {...shellProps}
      title={t(language, 'export')}
      onBack={controller.backToIndex}
    >
      <ExportPage
        language={language}
        count={exportCount}
        exporting={exporting}
        error={exportError}
        formatChooserOpen={formatChooserOpen}
        preparedArtifact={preparedArtifact}
        onCountChange={controller.setExportCount}
        onRequestExport={controller.requestExport}
        onCancelFormatChoice={controller.cancelFormatChoice}
        onChooseFormat={(format) =>
          void controller.chooseExportFormat(format)
        }
      />
    </SettingsShell>
  );
}

frontend/src/settings/pages/ExportPage.tsx

import type { ChangeEvent, MouseEvent } from 'react';
import {
  downloadPreparedExportArtifact,
  type ExportFormat,
  type PreparedExportArtifact,
} from '../../export-artifact';
import { t } from '../language';
import type { UiLanguage } from '../types';
interface ExportPageProps {
  language: UiLanguage;
  count: string;
  exporting: boolean;
  error: boolean;
  formatChooserOpen: boolean;
  preparedArtifact: PreparedExportArtifact | null;
  onCountChange: (count: string) => void;
  onRequestExport: () => void;
  onCancelFormatChoice: () => void;
  onChooseFormat: (format: ExportFormat) => void;
}
export function ExportPage({
  language,
  count,
  exporting,
  error,
  formatChooserOpen,
  preparedArtifact,
  onCountChange,
  onRequestExport,
  onCancelFormatChoice,
  onChooseFormat,
}: ExportPageProps) {
  const preparedFormatLabel =
    preparedArtifact?.format === 'epub'
      ? t(language, 'epub')
      : t(language, 'html');
  return (
    <div className="export-page">
      <input
        type="number"
        min="1"
        step="1"
        inputMode="numeric"
        aria-label={t(language, 'count')}
        placeholder={t(language, 'count')}
        value={count}
        disabled={exporting}
        onChange={(event: ChangeEvent<HTMLInputElement>) =>
          onCountChange(event.target.value)
        }
      />
      <button
        className="primary-action"
        type="button"
        disabled={exporting}
        onClick={onRequestExport}
      >
        {exporting
          ? t(language, 'exporting')
          : t(language, 'export')}
      </button>
      <button
        className="secondary-action"
        type="button"
        disabled={exporting || preparedArtifact === null}
        onClick={() => {
          if (preparedArtifact) {
            downloadPreparedExportArtifact(preparedArtifact);
          }
        }}
      >
        {t(language, 'download')}
      </button>
      {preparedArtifact ? (
        <div className="export-ready" role="status">
          {t(language, 'ready')}: {preparedArtifact.entryCount} · {preparedFormatLabel}
        </div>
      ) : null}
      {error ? (
        <div className="settings-error">
          {t(language, 'invalidExport')}
        </div>
      ) : null}
      {formatChooserOpen ? (
        <div
          className="export-format-backdrop"
          role="presentation"
          onClick={onCancelFormatChoice}
        >
          <section
            className="export-format-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="export-format-title"
            onClick={(event: MouseEvent<HTMLElement>) => event.stopPropagation()}
          >
            <h2 id="export-format-title">
              {t(language, 'chooseExportFormat')}
            </h2>
            <button
              className="export-format-option"
              type="button"
              onClick={() => onChooseFormat('epub')}
            >
              <strong>{t(language, 'epub')}</strong>
              <span>{t(language, 'epubDescription')}</span>
            </button>
            <button
              className="export-format-option"
              type="button"
              onClick={() => onChooseFormat('html')}
            >
              <strong>{t(language, 'html')}</strong>
              <span>{t(language, 'htmlDescription')}</span>
            </button>
            <button
              className="export-format-cancel"
              type="button"
              onClick={onCancelFormatChoice}
            >
              {t(language, 'cancel')}
            </button>
          </section>
        </div>
      ) : null}
    </div>
  );
}

frontend/src/styles/settings.css

.settings-screen {
  display: grid;
  grid-template-rows:
    auto
    minmax(
      0,
      1fr
    );
  overflow: hidden;
}
.settings-header {
  display: grid;
  grid-template-columns:
    3rem
    minmax(
      0,
      1fr
    )
    3rem;
  align-items: center;
  gap: 0.5rem;
  min-height: 4.25rem;
  padding:
    max(
      0.65rem,
      env(
        safe-area-inset-top
      )
    )
    max(
      0.75rem,
      env(
        safe-area-inset-right
      )
    )
    0.45rem
    max(
      0.75rem,
      env(
        safe-area-inset-left
      )
    );
  border-bottom:
    1px
    solid
    rgba(
      30,
      30,
      30,
      0.1
    );
}
.settings-header h1 {
  min-width: 0;
  margin: 0;
  color:
    rgba(
      20,
      20,
      20,
      0.88
    );
  text-align: center;
  font-size:
    clamp(
      1.15rem,
      4.8vw,
      1.55rem
    );
  font-weight: 600;
  overflow-wrap: anywhere;
}
.settings-header-side {
  display: flex;
  align-items: center;
  justify-content:
    flex-start;
}
.settings-header-side-right {
  justify-content: flex-end;
}
.settings-back,
.settings-close {
  display: grid;
  place-items: center;
  width: 2.8rem;
  height: 2.8rem;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color:
    rgba(
      20,
      20,
      20,
      0.62
    );
  font-family:
    system-ui,
    sans-serif;
  font-size: 2rem;
  line-height: 1;
  cursor: pointer;
}
.settings-back:active,
.settings-close:active,
.language-toggle:active {
  background:
    rgba(
      35,
      35,
      35,
      0.12
    );
}
.settings-page-content {
  width:
    min(
      52rem,
      100%
    );
  min-height: 0;
  margin: 0 auto;
  overflow: auto;
  padding:
    1rem
    max(
      1rem,
      env(
        safe-area-inset-right
      )
    )
    max(
      5.5rem,
      calc(
        env(
          safe-area-inset-bottom
        )
        + 4.5rem
      )
    )
    max(
      1rem,
      env(
        safe-area-inset-left
      )
    );
}
.settings-index {
  display: grid;
  overflow: hidden;
  border:
    1px
    solid
    rgba(
      30,
      30,
      30,
      0.11
    );
  border-radius: 1rem;
  background:
    rgba(
      255,
      255,
      255,
      0.12
    );
}
.settings-index button {
  display: flex;
  align-items: center;
  justify-content:
    space-between;
  gap: 1rem;
  min-height: 3.6rem;
  padding: 0.8rem 1rem;
  border: 0;
  border-bottom:
    1px
    solid
    rgba(
      30,
      30,
      30,
      0.09
    );
  background: transparent;
  color:
    rgba(
      20,
      20,
      20,
      0.88
    );
  text-align: left;
  cursor: pointer;
}
.settings-index
button:last-child {
  border-bottom: 0;
}
.settings-index
button:active {
  background:
    rgba(
      255,
      255,
      255,
      0.12
    );
}
.settings-index
button
span:last-child {
  color:
    rgba(
      20,
      20,
      20,
      0.4
    );
  font-family:
    system-ui,
    sans-serif;
  font-size: 1.65rem;
}
.settings-form,
.export-page {
  display: grid;
  gap: 1rem;
}
.settings-form label {
  display: grid;
  grid-template-columns:
    minmax(
      0,
      1fr
    )
    minmax(
      8rem,
      11rem
    );
  align-items: center;
  gap: 1rem;
}
.settings-form input,
.export-page input {
  width: 100%;
  min-width: 0;
  padding:
    0.7rem
    0.8rem;
  border:
    1px
    solid
    rgba(
      30,
      30,
      30,
      0.16
    );
  border-radius: 0.7rem;
  outline: none;
  background:
    rgba(
      255,
      255,
      255,
      0.25
    );
  color: #171717;
  font-family:
    system-ui,
    sans-serif;
}
.settings-form
input:focus,
.export-page
input:focus {
  border-color:
    rgba(
      20,
      20,
      20,
      0.34
    );
  background:
    rgba(
      255,
      255,
      255,
      0.38
    );
}
.primary-action,
.secondary-action {
  min-height: 2.8rem;
  padding:
    0.6rem
    1rem;
  border: 0;
  border-radius: 0.75rem;
  color:
    rgba(
      20,
      20,
      20,
      0.88
    );
  cursor: pointer;
}
.primary-action {
  background:
    rgba(
      30,
      30,
      30,
      0.16
    );
}
.secondary-action {
  background:
    rgba(
      255,
      255,
      255,
      0.2
    );
  box-shadow:
    inset
    0
    0
    0
    1px
    rgba(
      30,
      30,
      30,
      0.12
    );
}
.primary-action:disabled,
.secondary-action:disabled,
.export-page
input:disabled {
  opacity: 0.42;
  cursor: default;
}
.settings-error {
  color:
    rgba(
      80,
      15,
      15,
      0.9
    );
  font-size: 0.9rem;
}
.export-ready {
  color:
    rgba(
      20,
      20,
      20,
      0.68
    );
  font-size: 0.9rem;
}
.language-toggle {
  position: absolute;
  right:
    max(
      1rem,
      env(
        safe-area-inset-right
      )
    );
  bottom:
    max(
      1rem,
      env(
        safe-area-inset-bottom
      )
    );
  z-index: 4;
  display: grid;
  place-items: center;
  width: 3rem;
  height: 3rem;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background:
    rgba(
      35,
      35,
      35,
      0.1
    );
  color:
    rgba(
      20,
      20,
      20,
      0.55
    );
  cursor: pointer;
}
.diagnostic-empty {
  display: grid;
  min-height: 14rem;
  place-items: center;
  color:
    rgba(
      20,
      20,
      20,
      0.5
    );
  font-family:
    system-ui,
    sans-serif;
  font-size: 2rem;
}
.diagnostic-table-wrap {
  overflow-x: auto;
  border:
    1px
    solid
    rgba(
      30,
      30,
      30,
      0.11
    );
  border-radius: 0.9rem;
  background:
    rgba(
      255,
      255,
      255,
      0.13
    );
}
.diagnostic-table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
  color:
    rgba(
      20,
      20,
      20,
      0.78
    );
  font-family:
    ui-monospace,
    SFMono-Regular,
    Menlo,
    Consolas,
    monospace;
  font-size: 0.78rem;
  line-height: 1.45;
}
.diagnostic-table th,
.diagnostic-table td {
  padding:
    0.7rem
    0.75rem;
  border-bottom:
    1px
    solid
    rgba(
      30,
      30,
      30,
      0.08
    );
  vertical-align: top;
  overflow-wrap: anywhere;
}
.diagnostic-table
tr:last-child
th,
.diagnostic-table
tr:last-child
td {
  border-bottom: 0;
}
.diagnostic-table th {
  width: 46%;
  color:
    rgba(
      20,
      20,
      20,
      0.6
    );
  text-align: left;
  font-weight: 600;
}
.diagnostic-table td {
  width: 54%;
  font-variant-numeric:
    tabular-nums;
}
@media (
  max-width:
    600px
) {
  .settings-page-content {
    padding-inline: 0.8rem;
  }
  .settings-form label {
    grid-template-columns: 1fr;
    gap: 0.45rem;
  }
  .diagnostic-table {
    table-layout: auto;
  }
  .diagnostic-table th {
    width: 44%;
  }
  .diagnostic-table td {
    width: 56%;
  }
}
.export-format-backdrop {
  position: fixed;
  inset: 0;
  z-index: 20;
  display: grid;
  place-items: center;
  padding:
    max(1rem, env(safe-area-inset-top))
    max(1rem, env(safe-area-inset-right))
    max(1rem, env(safe-area-inset-bottom))
    max(1rem, env(safe-area-inset-left));
  background: rgba(25, 25, 25, 0.24);
}
.export-format-modal {
  width: min(28rem, 100%);
  display: grid;
  gap: 0.75rem;
  padding: 1rem;
  border: 1px solid rgba(30, 30, 30, 0.13);
  border-radius: 1rem;
  background: rgba(198, 198, 198, 0.98);
  box-shadow: 0 0.8rem 2.4rem rgba(0, 0, 0, 0.22);
}
.export-format-modal h2 {
  margin: 0 0 0.25rem;
  color: rgba(20, 20, 20, 0.86);
  font-size: 1.05rem;
  font-weight: 600;
  text-align: center;
}
.export-format-option {
  display: grid;
  gap: 0.25rem;
  width: 100%;
  min-height: 4rem;
  padding: 0.8rem 0.9rem;
  border: 1px solid rgba(30, 30, 30, 0.12);
  border-radius: 0.8rem;
  background: rgba(255, 255, 255, 0.18);
  color: rgba(20, 20, 20, 0.86);
  text-align: left;
  cursor: pointer;
}
.export-format-option:active {
  background: rgba(255, 255, 255, 0.28);
}
.export-format-option strong {
  font-family: system-ui, sans-serif;
  font-size: 1rem;
  font-weight: 650;
}
.export-format-option span {
  color: rgba(20, 20, 20, 0.58);
  font-size: 0.82rem;
  line-height: 1.35;
}
.export-format-cancel {
  min-height: 2.7rem;
  padding: 0.6rem 1rem;
  border: 0;
  border-radius: 0.75rem;
  background: transparent;
  color: rgba(20, 20, 20, 0.62);
  cursor: pointer;
}
.export-format-cancel:active {
  background: rgba(35, 35, 35, 0.08);
}

tests/font-assets.test.ts

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  OBSERVATION_FONT_ASSETS,
  createPlaceholderEmbeddedObservationFontBundle,
  loadObservationFontBundle,
  observationFontFaceCss,
  toEmbeddedObservationFontBundle,
} from '../frontend/src/font-assets';
import { OBSERVATION_FONTS } from '../frontend/src/presentation';
test('font asset manifest exactly covers the curated observation font pool with local files', () => {
  assert.deepEqual(
    OBSERVATION_FONT_ASSETS.map((asset) => asset.family),
    [...OBSERVATION_FONTS],
  );
  assert.equal(OBSERVATION_FONT_ASSETS.length, 10);
  for (const asset of OBSERVATION_FONT_ASSETS) {
    assert.match(asset.fileName, /^[a-z0-9-]+\.woff2$/);
    assert.match(asset.licenseFileName, /^[a-z0-9-]+-OFL\.txt$/);
  }
});
test('font-face CSS can target the same families with embedded data URLs', () => {
  const bundle = createPlaceholderEmbeddedObservationFontBundle();
  const css = observationFontFaceCss(
    bundle.fonts.map((font) => ({
      family: font.family,
      source: font.dataUrl,
    })),
  );
  assert.equal((css.match(/@font-face/g) ?? []).length, 10);
  for (const family of OBSERVATION_FONTS) {
    assert.ok(css.includes(`font-family:"${family}"`));
  }
  assert.equal(/https?:\/\//.test(css), false);
});
test('binary font bundle loader reads every font and license from local application paths', async () => {
  const requested: string[] = [];
  const fakeFetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    requested.push(url);
    if (url.includes('/licenses/')) {
      return new Response('SIL OPEN FONT LICENSE TEST', { status: 200 });
    }
    return new Response(new Uint8Array([1, 2, 3, 4]), { status: 200 });
  }) as typeof fetch;
  const bundle = await loadObservationFontBundle(fakeFetch);
  assert.equal(bundle.fonts.length, 10);
  assert.equal(requested.length, 20);
  assert.ok(requested.every((url) => url.startsWith('/fonts/')));
  for (const font of bundle.fonts) {
    assert.deepEqual([...font.bytes], [1, 2, 3, 4]);
    assert.equal(font.licenseText, 'SIL OPEN FONT LICENSE TEST');
    assert.match(font.fileName, /\.woff2$/);
    assert.match(font.licenseFileName, /-OFL\.txt$/);
  }
  const embedded = toEmbeddedObservationFontBundle(bundle);
  for (const font of embedded.fonts) {
    assert.match(font.dataUrl, /^data:font\/woff2;base64,/);
    assert.equal(font.licenseText, 'SIL OPEN FONT LICENSE TEST');
  }
});

tests/export-html.test.ts

import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {
  buildStandaloneExportHtml,
  prepareHtmlExport,
} from '../frontend/src/export-html';
import type { EmbeddedObservationFontBundle } from '../frontend/src/font-assets';
import { OBSERVATION_FONTS } from '../frontend/src/presentation';
import type { ExportResponse, SelectionSnapshot } from '../shared/contracts';
function selection(sourceKey: string): SelectionSnapshot {
  return {
    sourceWeights: { source1: 1, source2: 1, source3: 1 },
    sourceId: 'source1',
    sourceRowCount: 12,
    sourceWeight: 1,
    sourceMass: 12,
    totalSourceMass: 72,
    sourceProbability: 12 / 72,
    sourceKey,
    wordCount: 2,
    complexityReferenceVersion: 1,
    complexityPercentileTarget: 0.5,
    complexityPercentileSpread: 0.25,
    derivedStandardDeviation: 0.25 / 2.326347874,
    globalPercentileStart: 6 / 72,
    globalPercentileEnd: 14 / 72,
    globalIntervalMass: 0.1,
    globalRowsAtWordCount: 8,
    globalPerRowComplexityMass: 0.0125,
    selectedSourceRowsAtWordCount: 3,
    selectedSourceNormalizationDenominator: 0.1,
    rowProbabilityWithinSource: 0.125,
    overallProbability: (12 / 72) * 0.125,
  };
}
function sampleExport(): ExportResponse {
  return {
    settings: {
      sourceWeights: { source1: 1, source2: 1, source3: 1 },
      complexityPercentileTarget: 0.5,
      complexityPercentileSpread: 0.25,
      complexityReferenceVersion: 1,
    },
    entries: [
      {
        position: 1,
        sourceId: 'source1',
        sourceKey: 'source1-001',
        text: 'మొదటి',
        diagnostic: {
          selection: selection('source1-001'),
          cacheHit: false,
          requestStartedAt: 1,
          requestCompletedAt: 2,
          requestDurationMs: 1,
        },
      },
      {
        position: 2,
        sourceId: 'source1',
        sourceKey: 'source1-002',
        text: 'రెండవ చాలా పొడవైన పరిశీలన </script><script>globalThis.PWNED=true</script>',
        diagnostic: {
          selection: selection('source1-002'),
          cacheHit: true,
          requestStartedAt: null,
          requestCompletedAt: null,
          requestDurationMs: null,
        },
      },
    ],
  };
}
function sampleFontBundle(): EmbeddedObservationFontBundle {
  return {
    fonts: OBSERVATION_FONTS.map((family, index) => ({
      family,
      dataUrl: `data:font/woff2;base64,Zm9udC0${index}`,
      licenseText: `OFL notice for ${family}`,
    })),
  };
}
class FakeClassList {
  private readonly values = new Set<string>();
  remove(value: string): void {
    this.values.delete(value);
  }
  toggle(value: string): boolean {
    if (this.values.has(value)) {
      this.values.delete(value);
      return false;
    }
    this.values.add(value);
    return true;
  }
}
class FakeElement {
  textContent = '';
  innerHTML = '';
  disabled = false;
  clientWidth = 500;
  clientHeight = 500;
  scrollWidth = 420;
  scrollHeight = 120;
  readonly style: Record<string, string> = {};
  readonly classList = new FakeClassList();
  readonly listeners = new Map<
    string,
    (event: { preventDefault: () => void; stopPropagation: () => void }) => void
  >();
  addEventListener(
    name: string,
    listener: (event: { preventDefault: () => void; stopPropagation: () => void }) => void,
  ): void {
    this.listeners.set(name, listener);
  }
  click(): void {
    this.listeners.get('click')?.({
      preventDefault() {},
      stopPropagation() {},
    });
  }
  getBoundingClientRect(): { width: number; height: number } {
    return { width: this.clientWidth, height: this.clientHeight };
  }
}
async function settle(): Promise<void> {
  await Promise.resolve();
  await new Promise<void>((resolve) => setImmediate(resolve));
}
test('HTML export embeds all ten fonts, licenses, and no runtime network dependencies', () => {
  const html = buildStandaloneExportHtml(sampleExport(), sampleFontBundle());
  assert.match(html, /^<!doctype html>/i);
  assert.equal((html.match(/@font-face/g) ?? []).length, 10);
  for (const family of OBSERVATION_FONTS) {
    assert.ok(html.includes(`font-family:"${family}"`));
    assert.ok(html.includes(`OFL notice for ${family}`));
  }
  assert.equal(/<script[^>]+src=/i.test(html), false);
  assert.equal(/<link[^>]+href=/i.test(html), false);
  assert.equal(/\bfetch\s*\(/.test(html), false);
  assert.equal(/\bXMLHttpRequest\b/.test(html), false);
  assert.equal(html.includes('fonts.googleapis.com'), false);
  assert.equal(html.includes('fonts.gstatic.com'), false);
  assert.equal(html.includes('</script><script>globalThis.PWNED=true</script>'), false);
  assert.ok(
    html.includes('\\u003c/script>\\u003cscript>globalThis.PWNED=true\\u003c/script>'),
  );
});
test('HTML export uses shared viewer presentation and mapping-table diagnostics', () => {
  const html = buildStandaloneExportHtml(sampleExport(), sampleFontBundle());
  assert.match(html, /const PRESENTATION=/);
  assert.match(html, /function preferredSize\(/);
  assert.match(html, /function chooseFont\(/);
  assert.match(html, /function fitActive\(/);
  assert.match(html, /document\.fonts\.load/);
  assert.match(html, /window\.addEventListener\('resize'/);
  assert.match(html, /<table><tbody id="diagnostic-body"><\/tbody><\/table>/);
  assert.equal(html.includes('<pre id="diagnostic"'), false);
});
test('shared standalone viewer rerolls on activation but not diagnostic toggles or resize', async () => {
  const html = buildStandaloneExportHtml(sampleExport(), sampleFontBundle());
  const match = html.match(/<script>(const DATA=[\s\S]*?)<\/script>\s*<\/body>/i);
  assert.ok(match?.[1]);
  const ids = [
    'text-wrap',
    'text',
    'back',
    'next',
    'position',
    'diagnostic',
    'diagnostic-body',
    'info',
  ];
  const elements = Object.fromEntries(
    ids.map((id) => [id, new FakeElement()]),
  ) as Record<string, FakeElement>;
  let fontLoadCount = 0;
  const document = {
    fonts: {
      load: async () => {
        fontLoadCount += 1;
        return [];
      },
    },
    getElementById(id: string): FakeElement {
      const element = elements[id];
      if (!element) throw new Error(`unexpected element id ${id}`);
      return element;
    },
  };
  const windowListeners = new Map<string, () => void>();
  const window = {
    addEventListener(name: string, listener: () => void) {
      windowListeners.set(name, listener);
    },
    requestAnimationFrame(callback: () => void) {
      callback();
      return 1;
    },
    cancelAnimationFrame() {},
    setTimeout(callback: () => void) {
      callback();
      return 1;
    },
  };
  const randomValues = [0, 0.5, 0.999999];
  let randomCallCount = 0;
  const customMath = Object.create(Math) as Math;
  customMath.random = () => {
    const value = randomValues[randomCallCount] ?? 0;
    randomCallCount += 1;
    return value;
  };
  vm.runInNewContext(
    match[1],
    {
      document,
      window,
      Math: customMath,
      Date,
      JSON,
      Array,
      Number,
      String,
      Object,
      Promise,
    },
    { timeout: 1_000 },
  );
  await settle();
  assert.equal(elements.text!.textContent, 'మొదటి');
  assert.match(elements.text!.style.fontFamily ?? '', /Noto Sans Telugu/);
  assert.equal(randomCallCount, 1);
  assert.equal(fontLoadCount, 1);
  elements.info!.click();
  elements.info!.click();
  windowListeners.get('resize')?.();
  assert.equal(randomCallCount, 1);
  assert.equal(fontLoadCount, 1);
  elements.next!.click();
  await settle();
  assert.match(elements.text!.style.fontFamily ?? '', /Peddana/);
  assert.equal(randomCallCount, 2);
  assert.equal(fontLoadCount, 2);
  elements.back!.click();
  await settle();
  assert.match(elements.text!.style.fontFamily ?? '', /Tenali Ramakrishna/);
  assert.equal(randomCallCount, 3);
  assert.equal(fontLoadCount, 3);
});
test('prepared HTML artifact resolves local fonts before becoming downloadable', async () => {
  const originalFetch = globalThis.fetch;
  const requested: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    requested.push(url);
    if (url.includes('/licenses/')) {
      return new Response('OFL TEST', { status: 200 });
    }
    return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
  }) as typeof fetch;
  try {
    const prepared = await prepareHtmlExport(sampleExport());
    assert.equal(prepared.format, 'html');
    assert.equal(prepared.entryCount, 2);
    assert.equal(prepared.fileName, 'telugu-export-2.html');
    assert.equal(prepared.blob.type, 'text/html;charset=utf-8');
    const html = await prepared.blob.text();
    assert.equal((html.match(/@font-face/g) ?? []).length, 10);
    assert.equal(requested.length, 20);
    assert.ok(requested.every((url) => url.startsWith('/fonts/')));
    assert.equal(/\bfetch\s*\(/.test(html), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

tests/export-epub.test.ts

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildEpubBytes,
  prepareEpubExport,
} from '../frontend/src/export-epub';
import {
  OBSERVATION_FONT_ASSETS,
  type ObservationFontBundle,
} from '../frontend/src/font-assets';
import type {
  ExportResponse,
  SelectionSnapshot,
} from '../shared/contracts';
interface ParsedStoredZipEntry {
  name: string;
  method: number;
  data: Uint8Array;
}
function readUint16(view: DataView, offset: number): number {
  return view.getUint16(offset, true);
}
function readUint32(view: DataView, offset: number): number {
  return view.getUint32(offset, true);
}
function parseStoredZip(bytes: Uint8Array): ParsedStoredZipEntry[] {
  const entries: ParsedStoredZipEntry[] = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  let offset = 0;
  while (offset + 4 <= bytes.length) {
    const signature = readUint32(view, offset);
    if (signature === 0x02014b50 || signature === 0x06054b50) break;
    assert.equal(
      signature,
      0x04034b50,
      `invalid local ZIP header at ${offset}`,
    );
    const method = readUint16(view, offset + 8);
    const compressedSize = readUint32(view, offset + 18);
    const uncompressedSize = readUint32(view, offset + 22);
    const nameLength = readUint16(view, offset + 26);
    const extraLength = readUint16(view, offset + 28);
    assert.equal(method, 0);
    assert.equal(compressedSize, uncompressedSize);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const dataEnd = dataStart + compressedSize;
    const name = decoder.decode(
      bytes.subarray(nameStart, nameStart + nameLength),
    );
    entries.push({
      name,
      method,
      data: bytes.slice(dataStart, dataEnd),
    });
    offset = dataEnd;
  }
  return entries;
}
function selection(sourceKey: string): SelectionSnapshot {
  return {
    sourceWeights: { source1: 1, source2: 1, source3: 1 },
    sourceId: 'source1',
    sourceRowCount: 12,
    sourceWeight: 1,
    sourceMass: 12,
    totalSourceMass: 72,
    sourceProbability: 12 / 72,
    sourceKey,
    wordCount: 2,
    complexityReferenceVersion: 1,
    complexityPercentileTarget: 0.5,
    complexityPercentileSpread: 0.25,
    derivedStandardDeviation: 0.25 / 2.326347874,
    globalPercentileStart: 6 / 72,
    globalPercentileEnd: 14 / 72,
    globalIntervalMass: 0.1,
    globalRowsAtWordCount: 8,
    globalPerRowComplexityMass: 0.0125,
    selectedSourceRowsAtWordCount: 3,
    selectedSourceNormalizationDenominator: 0.1,
    rowProbabilityWithinSource: 0.125,
    overallProbability: (12 / 72) * 0.125,
  };
}
function sampleExport(): ExportResponse {
  return {
    settings: {
      sourceWeights: { source1: 1, source2: 1, source3: 1 },
      complexityPercentileTarget: 0.5,
      complexityPercentileSpread: 0.25,
      complexityReferenceVersion: 1,
    },
    entries: [
      {
        position: 1,
        sourceId: 'source1',
        sourceKey: 'source1-001',
        text: 'మొదటి',
        diagnostic: {
          selection: selection('source1-001'),
          cacheHit: false,
          requestStartedAt: 1,
          requestCompletedAt: 2,
          requestDurationMs: 1,
        },
      },
      {
        position: 2,
        sourceId: 'source1',
        sourceKey: 'source1-002',
        text: 'రెండవ పరిశీలన',
        diagnostic: {
          selection: selection('source1-002'),
          cacheHit: true,
          requestStartedAt: null,
          requestCompletedAt: null,
          requestDurationMs: null,
        },
      },
    ],
  };
}
function sampleFontBundle(): ObservationFontBundle {
  return {
    fonts: OBSERVATION_FONT_ASSETS.map((asset, index) => ({
      family: asset.family,
      fileName: asset.fileName,
      licenseFileName: asset.licenseFileName,
      bytes: new Uint8Array([0x77, 0x4f, 0x46, 0x32, index]),
      licenseText: `OFL notice for ${asset.family}`,
    })),
  };
}
function text(entry: ParsedStoredZipEntry): string {
  return new TextDecoder().decode(entry.data);
}
test('EPUB is a real stored ZIP with mimetype first and uncompressed', () => {
  const bytes = buildEpubBytes(
    sampleExport(),
    sampleFontBundle(),
    {
      identifier: 'urn:test:telugu-now',
      modified: '2026-09-06T00:00:00Z',
    },
  );
  const entries = parseStoredZip(bytes);
  assert.equal(entries[0]?.name, 'mimetype');
  assert.equal(entries[0]?.method, 0);
  assert.equal(text(entries[0]!), 'application/epub+zip');
  assert.equal(entries[1]?.name, 'META-INF/container.xml');
});
test('EPUB contains the complete scripted viewer, data, fonts, and licenses', () => {
  const result = sampleExport();
  const bytes = buildEpubBytes(
    result,
    sampleFontBundle(),
    {
      identifier: 'urn:test:telugu-now',
      modified: '2026-09-06T00:00:00Z',
    },
  );
  const entries = parseStoredZip(bytes);
  const byName = new Map(
    entries.map((entry) => [entry.name, entry]),
  );
  for (const required of [
    'mimetype',
    'META-INF/container.xml',
    'EPUB/package.opf',
    'EPUB/nav.xhtml',
    'EPUB/viewer.xhtml',
    'EPUB/viewer.css',
    'EPUB/viewer.js',
    'EPUB/data.json',
  ]) {
    assert.ok(
      byName.has(required),
      `${required} should exist`,
    );
  }
  const containerXml = text(
    byName.get('META-INF/container.xml')!,
  );
  assert.match(
    containerXml,
    /full-path="EPUB\/package\.opf"/,
  );
  const packageOpf = text(
    byName.get('EPUB/package.opf')!,
  );
  assert.match(packageOpf, /version="3\.0"/);
  assert.match(packageOpf, /properties="nav"/);
  assert.match(packageOpf, /properties="scripted"/);
  assert.match(packageOpf, /<itemref idref="viewer"\/>/);
  const viewerXhtml = text(
    byName.get('EPUB/viewer.xhtml')!,
  );
  assert.match(
    viewerXhtml,
    /xmlns="http:\/\/www\.w3\.org\/1999\/xhtml"/,
  );
  assert.match(viewerXhtml, /href="viewer\.css"/);
  assert.match(viewerXhtml, /src="viewer\.js"/);
  assert.match(viewerXhtml, /id="diagnostic-body"/);
  const viewerScript = text(
    byName.get('EPUB/viewer.js')!,
  );
  assert.match(viewerScript, /const PRESENTATION=/);
  assert.match(viewerScript, /function chooseFont\(/);
  assert.match(viewerScript, /function preferredSize\(/);
  assert.match(viewerScript, /function fitActive\(/);
  assert.match(viewerScript, /document\.fonts\.load/);
  assert.match(
    viewerScript,
    /window\.addEventListener\('resize'/,
  );
  assert.equal(/\bfetch\s*\(/.test(viewerScript), false);
  assert.equal(/\bXMLHttpRequest\b/.test(viewerScript), false);
  assert.deepEqual(
    JSON.parse(
      text(byName.get('EPUB/data.json')!),
    ),
    result,
  );
  for (const asset of OBSERVATION_FONT_ASSETS) {
    const fontName =
      `EPUB/fonts/${asset.fileName}`;
    const licenseName =
      `EPUB/licenses/${asset.licenseFileName}`;
    assert.ok(byName.has(fontName));
    assert.ok(byName.has(licenseName));
    assert.match(
      packageOpf,
      new RegExp(
        asset.fileName.replace('.', '\\.'),
      ),
    );
    assert.match(
      packageOpf,
      new RegExp(
        asset.licenseFileName.replace('.', '\\.'),
      ),
    );
  }
});
test('EPUB viewer CSS uses packaged relative fonts rather than remote or data URLs', () => {
  const bytes = buildEpubBytes(
    sampleExport(),
    sampleFontBundle(),
    {
      identifier: 'urn:test:telugu-now',
      modified: '2026-09-06T00:00:00Z',
    },
  );
  const byName = new Map(
    parseStoredZip(bytes).map(
      (entry) => [entry.name, entry],
    ),
  );
  const css = text(
    byName.get('EPUB/viewer.css')!,
  );
  assert.equal(
    (css.match(/@font-face/g) ?? []).length,
    10,
  );
  assert.equal(
    css.includes('data:font/woff2'),
    false,
  );
  assert.equal(
    /https?:\/\//.test(css),
    false,
  );
  for (const asset of OBSERVATION_FONT_ASSETS) {
    assert.ok(
      css.includes(
        `fonts/${asset.fileName}`,
      ),
    );
  }
});
test('prepared EPUB resolves only local font assets and exposes one downloadable epub blob', async () => {
  const originalFetch = globalThis.fetch;
  const requested: string[] = [];
  globalThis.fetch = (async (
    input: RequestInfo | URL,
  ) => {
    const url = String(input);
    requested.push(url);
    if (url.includes('/licenses/')) {
      return new Response(
        'OFL TEST',
        { status: 200 },
      );
    }
    return new Response(
      new Uint8Array([
        0x77,
        0x4f,
        0x46,
        0x32,
        1,
      ]),
      { status: 200 },
    );
  }) as typeof fetch;
  try {
    const prepared =
      await prepareEpubExport(
        sampleExport(),
      );
    assert.equal(
      prepared.format,
      'epub',
    );
    assert.equal(
      prepared.entryCount,
      2,
    );
    assert.equal(
      prepared.fileName,
      'telugu-export-2.epub',
    );
    assert.equal(
      prepared.blob.type,
      'application/epub+zip',
    );
    assert.equal(
      requested.length,
      20,
    );
    assert.ok(
      requested.every(
        (url) =>
          url.startsWith('/fonts/'),
      ),
    );
    const bytes =
      new Uint8Array(
        await prepared.blob.arrayBuffer(),
      );
    const entries =
      parseStoredZip(bytes);
    assert.equal(
      entries[0]?.name,
      'mimetype',
    );
  } finally {
    globalThis.fetch =
      originalFetch;
  }
});

tests/repository-contract.test.ts

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
function read(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}
test('Iteration 2 controller is control.sh with no stale control-project.sh surface', () => {
  const control = path.join(root, 'control.sh');
  assert.equal(fs.existsSync(control), true);
  assert.equal(fs.existsSync(path.join(root, 'control-project.sh')), false);
  assert.ok((fs.statSync(control).mode & 0o111) !== 0);
  const syntax = spawnSync('bash', ['-n', control], { encoding: 'utf8' });
  assert.equal(syntax.status, 0, syntax.stderr);
  const readme = read('README.md');
  assert.equal(readme.includes('control-project.sh'), false);
  assert.ok(readme.includes('./control.sh'));
  assert.equal(fs.existsSync(path.join(root, 'VALIDATION.md')), false);
  assert.equal(readme.includes('VALIDATION.md'), false);
});
test('Iteration 2 frontend remains modular across profile, observation, settings, and export packaging', () => {
  const requiredFiles = [
    'frontend/src/components/icons.tsx',
    'frontend/src/profile/ProfileEntry.tsx',
    'frontend/src/profile/useProfileSession.ts',
    'frontend/src/observation/ObservationView.tsx',
    'frontend/src/observation/useObservationTypography.ts',
    'frontend/src/settings/types.ts',
    'frontend/src/settings/language.ts',
    'frontend/src/settings/settings-utils.ts',
    'frontend/src/settings/diagnostic.ts',
    'frontend/src/settings/SettingsShell.tsx',
    'frontend/src/settings/SettingsView.tsx',
    'frontend/src/settings/useSettingsController.ts',
    'frontend/src/settings/pages/SettingsIndex.tsx',
    'frontend/src/settings/pages/ComplexityPage.tsx',
    'frontend/src/settings/pages/SourceWeightsPage.tsx',
    'frontend/src/settings/pages/DiagnosticPage.tsx',
    'frontend/src/settings/pages/ExportPage.tsx',
    'frontend/src/export-artifact.ts',
    'frontend/src/export-viewer.ts',
    'frontend/src/export-html.ts',
    'frontend/src/export-epub.ts',
    'frontend/src/zip.ts',
    'frontend/src/font-assets.ts',
    'frontend/font-assets.json',
    'scripts/sync-fonts.mjs',
    'frontend/src/styles/base.css',
    'frontend/src/styles/profile.css',
    'frontend/src/styles/observation.css',
    'frontend/src/styles/settings.css',
  ];
  for (const relativePath of requiredFiles) {
    assert.equal(
      fs.existsSync(path.join(root, relativePath)),
      true,
      `${relativePath} should exist`,
    );
  }
  const app = read('frontend/src/App.tsx');
  assert.ok(app.includes("from './profile/ProfileEntry'"));
  assert.ok(app.includes("from './profile/useProfileSession'"));
  assert.ok(app.includes("from './observation/ObservationView'"));
  assert.ok(app.includes("from './settings/SettingsView'"));
  assert.ok(app.includes("from './settings/useSettingsController'"));
  assert.equal(app.includes('settings-modal'), false);
  assert.equal(app.includes('chooseRandomObservationFont'), false);
  assert.ok(app.split('\n').length < 100);
});
test('Settings export uses a transient format chooser and keeps format out of selection', () => {
  const settingsView = read('frontend/src/settings/SettingsView.tsx');
  const exportPage = read('frontend/src/settings/pages/ExportPage.tsx');
  const controller = read('frontend/src/settings/useSettingsController.ts');
  const language = read('frontend/src/settings/language.ts');
  const styles = read('frontend/src/styles/settings.css');
  assert.ok(settingsView.includes('formatChooserOpen={formatChooserOpen}'));
  assert.ok(settingsView.includes('onRequestExport={controller.requestExport}'));
  assert.ok(settingsView.includes('controller.chooseExportFormat(format)'));
  assert.ok(exportPage.includes('className="export-format-modal"'));
  assert.ok(exportPage.includes("onChooseFormat('epub')"));
  assert.ok(exportPage.includes("onChooseFormat('html')"));
  assert.ok(exportPage.includes('downloadPreparedExportArtifact(preparedArtifact)'));
  assert.ok(controller.includes('const [generatedExport, setGeneratedExport]'));
  assert.ok(controller.includes('const [preparedArtifact, setPreparedArtifact]'));
  assert.ok(controller.includes('setFormatChooserOpen(true)'));
  assert.ok(controller.includes('result = await generateExport(profileCode, { count })'));
  assert.ok(controller.includes("format === 'epub'"));
  assert.ok(controller.includes('await prepareEpubExport(result)'));
  assert.ok(controller.includes('await prepareHtmlExport(result)'));
  assert.equal(
    controller.includes('generateExport(profileCode, { count, format'),
    false,
  );
  assert.ok(language.includes("chooseExportFormat: 'Choose export format'"));
  assert.ok(
    language.includes(
      "epubDescription: 'iPhone / iPad · Apple Books · Interactive · Offline'",
    ),
  );
  assert.ok(
    language.includes(
      "htmlDescription: 'Browser / Desktop · Interactive · Offline'",
    ),
  );
  assert.ok(styles.includes('.export-format-backdrop'));
  assert.ok(styles.includes('.export-format-modal'));
});
test('export packaging has one shared viewer runtime and separate HTML/EPUB wrappers', () => {
  const viewer = read('frontend/src/export-viewer.ts');
  const html = read('frontend/src/export-html.ts');
  const epub = read('frontend/src/export-epub.ts');
  const artifact = read('frontend/src/export-artifact.ts');
  for (const functionName of [
    'buildStandaloneViewerCss',
    'buildStandaloneViewerMarkup',
    'buildStandaloneViewerScript',
  ]) {
    assert.ok(viewer.includes(`export function ${functionName}`));
    assert.ok(html.includes(`${functionName}(`));
    assert.ok(epub.includes(`${functionName}(`));
  }
  assert.ok(viewer.includes('const PRESENTATION='));
  assert.ok(viewer.includes('function chooseFont()'));
  assert.ok(viewer.includes('function preferredSize('));
  assert.ok(viewer.includes('function fitActive()'));
  assert.ok(viewer.includes('document.fonts.load'));
  assert.ok(viewer.includes("window.addEventListener('resize'"));
  assert.ok(artifact.includes("export type ExportFormat = 'html' | 'epub'"));
  assert.ok(artifact.includes('downloadPreparedExportArtifact'));
});
test('EPUB wrapper declares a scripted EPUB 3 package with all local fonts and no ZIP dependency', () => {
  const epub = read('frontend/src/export-epub.ts');
  const zip = read('frontend/src/zip.ts');
  const packageJson = JSON.parse(read('package.json')) as {
    dependencies?: Record<string, string>;
  };
  assert.ok(epub.includes("data: 'application/epub+zip'"));
  assert.ok(epub.includes("name: 'META-INF/container.xml'"));
  assert.ok(epub.includes("name: 'EPUB/package.opf'"));
  assert.ok(epub.includes("name: 'EPUB/nav.xhtml'"));
  assert.ok(epub.includes("name: 'EPUB/viewer.xhtml'"));
  assert.ok(epub.includes("name: 'EPUB/viewer.css'"));
  assert.ok(epub.includes("name: 'EPUB/viewer.js'"));
  assert.ok(epub.includes("name: 'EPUB/data.json'"));
  assert.ok(epub.includes('properties="scripted"'));
  assert.ok(epub.includes('properties="nav"'));
  assert.ok(epub.includes('font/woff2'));
  assert.ok(epub.includes('loadObservationFontBundle()'));
  assert.ok(epub.includes('createStoredZip(entries)'));
  assert.ok(zip.includes('const STORE_METHOD = 0'));
  assert.ok(zip.includes('0x04034b50'));
  assert.ok(zip.includes('0x02014b50'));
  assert.ok(zip.includes('0x06054b50'));
  assert.equal(packageJson.dependencies?.jszip, undefined);
  assert.equal(packageJson.dependencies?.fflate, undefined);
});
test('live presentation remains local-font, monochrome, keyboard-stable, and activation-randomized', () => {
  const icons = read('frontend/src/components/icons.tsx');
  const profileEntry = read('frontend/src/profile/ProfileEntry.tsx');
  const observationView = read('frontend/src/observation/ObservationView.tsx');
  const typography = read('frontend/src/observation/useObservationTypography.ts');
  const presentation = read('frontend/src/presentation.ts');
  const fontAssets = read('frontend/src/font-assets.ts');
  const main = read('frontend/src/main.tsx');
  const baseStyles = read('frontend/src/styles/base.css');
  const profileStyles = read('frontend/src/styles/profile.css');
  const observationStyles = read('frontend/src/styles/observation.css');
  const indexHtml = read('frontend/index.html');
  assert.ok(icons.includes('export function SettingsIcon'));
  assert.ok(icons.includes('export function LanguageIcon'));
  assert.equal(icons.includes('⚙'), false);
  assert.equal(icons.includes('🌐'), false);
  assert.ok(baseStyles.includes('stroke: currentColor'));
  assert.ok(profileEntry.includes("'--entry-layout-height'"));
  assert.ok(/height:\s*var\(\s*--entry-layout-height/.test(profileStyles));
  assert.ok(observationView.includes('<SettingsIcon />'));
  assert.ok(observationView.includes('useObservationTypography('));
  assert.ok(typography.includes('chooseRandomObservationFont()'));
  assert.ok(typography.includes('OBSERVATION_PRESENTATION.fitIterations'));
  assert.ok(typography.includes('document.fonts.load('));
  assert.ok(observationStyles.includes('.nav-zone:disabled'));
  assert.ok(observationStyles.includes('.settings-trigger'));
  assert.ok(observationStyles.includes('bottom:'));
  assert.ok(main.includes('installLiveObservationFontFaces()'));
  assert.ok(fontAssets.includes('loadObservationFontBundle'));
  assert.equal(indexHtml.includes('fonts.googleapis.com'), false);
  for (const family of [
    'Noto Sans Telugu',
    'Noto Serif Telugu',
    'Mandali',
    'Ramabhadra',
    'NTR',
    'Peddana',
    'Ramaraja',
    'Sree Krushnadevaraya',
    'Suranna',
    'Tenali Ramakrishna',
  ]) {
    assert.ok(presentation.includes(`'${family}'`));
  }
});

README.md

# Implementation Iteration 2
This repository contains Implementation Iteration 2 of the Telugu observation app. Iteration 1's persistent history/timing model, ten-item future queue, continuous one-for-one replenishment, sequential live preparation, and SQLite persistence remain the foundation.
Iteration 2 adds source/complexity selection, persistent profile settings, repeatable source-record caching, tap-revealed controls, full-page Settings navigation, bilingual Settings labels, structured diagnostics, activation-time randomized Telugu typography, and portable offline export as either standalone HTML or interactive EPUB 3.
## Stack
- TypeScript
- React + Vite
- Hono + Node.js
- SQLite (`better-sqlite3`)
## Project controller
The root `control.sh` is the normal development entry point.
Install dependencies on a new checkout:
```bash
./control.sh deps --option install

Start development:

./control.sh dev

The browser app is served by Vite on port 5173. The Hono API runs on 127.0.0.1:8787. Vite binds to 0.0.0.0 so development-container/Codespaces forwarding can expose the UI.

The configured prototype profile code is 001.

Build and tests

./control.sh build --option start
./control.sh test --option start

The tests preserve the accepted Iteration 1 history, timing, queue, and replenishment invariants and cover the Iteration 2 source selector, global complexity reference, probability snapshots, repeats, settings isolation, shared source-record cache, export isolation, migration, numerical edge cases, randomized presentation, local font assets, standalone HTML, and EPUB container generation.

Selection is additionally checked against an independent probability oracle, deterministic RNG boundaries, a 100-selection black-box audit, and a seeded 50,000-selection Monte Carlo comparison.

Deterministic dummy sources

Iteration 2 has exactly three selectable dummy sources:

* source1: 12 rows
* source2: 24 rows
* source3: 36 rows

Their literal Telugu rows live under server/src/sources/dummy/data/. Each row has a stable source key. The fixture lengths were sampled once from fixed-seed right-skewed distributions and then committed literally. source1 is shorter on average, source2 is moderate, and source3 is longer and broader. Across all 72 rows the current fixture spans 1 through 40 words.

An uncached dummy source retrieval waits 1–15 seconds by default. The delay can be overridden in the environment for tests.

Source selection

Each profile stores one source weight per selectable source. Every weight is in [0,1], and at least one weight must be exactly 1. Configurations with every weight below 1 are rejected rather than normalized.

For source i, with N_i selectable rows and profile weight w_i:

source mass = N_i * w_i
P(source i) = (N_i * w_i) / sum_j(N_j * w_j)

With all source weights at 1, source probability is proportional to source row count.

Global complexity reference

Iteration 2 uses word count only as the intrinsic measurement for one global complexity reference built from all 72 selectable dummy rows. The user does not configure a target word count.

For each word count k, tied rows occupy their empirical global percentile interval [a_k,b_k].

The reference is versioned as:

complexity_reference_version = 1

Each profile configures:

* global complexity percentile target T in [0,1];
* global complexity percentile spread R > 0.

The desired complexity curve is a normal distribution centered at T. R is the half-width corresponding to the central 98% reference interval:

sigma = R / 2.326347874

The normal is truncated and renormalized to [0,1]. Probability mass over each tied word-count percentile interval is divided by the global number of rows with that word count to produce per-row global complexity mass. Once a source has been selected, those masses are normalized over rows available in that source.

Source probability, conditional row probability, and overall source+row probability remain distinct and are stored in every normal acquisition’s immutable selection snapshot.

Repeats and shared source-record cache

Selections are independent and with replacement. The same (source_id, source_key) may appear in multiple acquisitions.

A stable source record and an acquisition are separate concepts:

* a source record is the underlying source row and normalized retrieved content;
* an acquisition is one particular probabilistic selection event.

source_records is the shared persistent cache, keyed by (source_id, source_key). Once either the live queue or Export retrieves a source record, later live/export selections reuse it without another source request.

Queue behavior

The live profile maintains ten selected unseen observations. Initial load fills a short queue to ten. Every first-time consumption moves one observation into history and atomically reserves exactly one replacement at the future-queue tail.

Back/forward movement through already-seen history does not consume the queue and creates no replacement. Live source-record preparation remains sequential and queue order remains authoritative regardless of later settings changes, cache-hit speed, or source latency.

Saved source/complexity settings affect only acquisitions selected after the save. Existing history, existing unseen selections, and already-pending preparation work are not resampled.

Observation controls

Back, Next, and the bottom-right Settings icon are hidden by default. A single tap on the ordinary observation surface reveals all three; another background tap hides them. Successful Back/Next navigation hides them again.

Whenever controls are revealed, both Back and Next remain in fixed positions. An unavailable direction is greyed and disabled rather than removed.

The Settings and Settings-language controls are monochrome application-rendered SVGs using currentColor rather than platform emoji glyphs.

When a valid profile has no current observation yet, the observation area displays:

...

The placeholder does not create history, an acquisition, source data, or timing state.

Stable profile-code entry

The initial three-digit profile-code input is anchored to the viewport height captured when the entry screen first renders. Opening the software keyboard therefore does not recenter or move the bar upward as the mobile visual viewport changes.

Observation typography

Each time an observation becomes actively displayed, the client randomly chooses one font from this fixed collection:

* Noto Sans Telugu
* Noto Serif Telugu
* Mandali
* Ramabhadra
* NTR
* Peddana
* Ramaraja
* Sree Krushnadevaraya
* Suranna
* Tenali Ramakrishna

Font selection is presentation-only and is not stored in history, acquisitions, source records, or selection snapshots. Navigating away and later returning rerolls the font. Closing Settings and returning also creates a fresh typography activation. Ordinary React rerenders, polling, timing refreshes, and queue-readiness changes do not reroll while the same observation remains continuously active.

The canonical presentation configuration lives in frontend/src/presentation.ts and is reused by the live viewer and both export formats.

The preferred size is derived continuously from observation length. After a font is selected, the browser waits for that font, measures the rendered observation, and reduces the preferred size only as necessary to fit the available area.

Font assets

The live application, HTML export, and EPUB export use the same ten application-controlled Telugu WOFF2 assets under:

frontend/public/fonts/

The canonical family/file mapping is frontend/font-assets.json.

Run:

npm run fonts:sync

The sync script stores the corresponding SIL Open Font License text and writes frontend/public/fonts/font-assets.lock.json with the resolved source URLs and SHA-256 hashes. The generated WOFF2 files, license files, and lock file are intended to remain committed so production behavior is tied to exact assets.

No font is fetched from the internet while a user generates or opens a completed export.

Full-page Settings

Settings replaces the observation view while open; it is not a modal. The Settings root links to four child pages:

1. Complexity
2. Source weights
3. Diagnostic
4. Export

Each child page has Back to return to the Settings root. × exits the entire Settings hierarchy and returns to the same observation.

Because the observation is not visible while Settings is displayed, opening Settings pauses visible-time accumulation. The history-tail absolute timer continues under the accepted Iteration 1 timing model. Closing Settings resumes visible accumulation when appropriate.

A monochrome language control remains bottom-right throughout Settings and switches static Settings/Diagnostic labels between Telugu and English. This language preference is presentation-only.

Diagnostic

Diagnostic has its own full page and renders the current acquisition as a two-column mapping table rather than free-form text. The table contains the Iteration 1 trigger/preparation fields and the complete persisted Iteration 2 selection snapshot.

If there is no current acquisition, the Diagnostic page displays ....

Export selection semantics

Export is not a history export and does not simulate repeated Next presses.

The user enters a positive integer N. A completed export batch contains exactly N fresh independent source+row selections generated by the same selection engine used by normal acquisitions.

Export does not:

* advance the current history cursor;
* append profile history;
* consume or replenish the live queue;
* consume normal acquisition numbers;
* alter observation timing.

Export does use and populate the normal persistent source-record cache. Selected uncached rows are resolved sequentially; cached rows are reused immediately.

The completed ExportResponse is format-independent and remains the canonical generated batch.

Export format choice

The Export page flow is:

enter N
    ↓
Export
    ↓
choose format
    ├─ EPUB — iPhone / iPad · Apple Books · Interactive · Offline
    └─ HTML — Browser / Desktop · Interactive · Offline
    ↓
generate N selections if no current batch exists
    ↓
package the completed ExportResponse
    ↓
Download

Pressing Export opens a small transient format-choice modal. Cancel closes it without generating anything.

The selected format is not passed into source or row selection. EPUB versus HTML is only an artifact/container choice.

After the first format has generated the batch, pressing Export again and selecting the other format repackages the same retained ExportResponse; it does not generate another N selections.

Editing N or successfully saving source/complexity settings invalidates both the retained current batch and any prepared artifact shown by the Export page.

Shared standalone viewer

frontend/src/export-viewer.ts owns the standalone viewer CSS, markup, diagnostic mapping, random-font activation semantics, continuous preferred-size formula integration, and DOM fit behavior shared by HTML and EPUB.

Both formats therefore preserve:

entry becomes active
        ↓
randomly choose one of the same ten fonts
        ↓
wait for that font
        ↓
derive preferred size from observation length
        ↓
measure actual rendered text
        ↓
reduce only if necessary to fit
        ↓
display

Back/Next rerolls the newly activated entry’s font. Diagnostic toggling does not. Resize/orientation changes refit the current entry without rerolling its active font.

HTML export

Choosing HTML produces:

telugu-export-N.html

It is one self-contained browser document containing all observations, diagnostics, inline CSS, inline JavaScript, canonical presentation configuration, all ten embedded WOFF2 fonts, and font-license notices.

It performs no runtime network requests after download.

EPUB export

Choosing EPUB produces:

telugu-export-N.epub

The Iteration 2 compatibility target is interactive offline use in Apple Books on iPhone/iPad, with macOS Apple Books tested where practical. Equivalent scripting behavior is not promised for every EPUB reader.

The EPUB is a real EPUB 3 ZIP container with this structure:

mimetype
META-INF/
  container.xml
EPUB/
  package.opf
  nav.xhtml
  viewer.xhtml
  viewer.css
  viewer.js
  data.json
  fonts/
    <all 10 WOFF2 files>
  licenses/
    <all required font license files>

The mimetype entry contains exactly application/epub+zip, is the first ZIP entry, and is stored without compression. META-INF/container.xml points to EPUB/package.opf. The OPF manifest declares the navigation document, scripted viewer, shared viewer CSS/JavaScript, data, all fonts, and license resources. The viewer spine item is explicitly marked scripted.

The browser-side EPUB packager is isolated in frontend/src/export-epub.ts. ZIP mechanics are isolated in frontend/src/zip.ts; the current implementation emits deterministic stored ZIP entries and requires no third-party ZIP runtime.

The EPUB contains the same immutable ExportResponse data and the same viewer behavior as HTML. All fonts and executable resources are inside the EPUB, so normal viewer operation requires no Telugu Now server, Fly.io, Codespaces, Google Fonts, installed Telugu fonts, APIs, external JavaScript, or external CSS.

EPUB acceptance

Automated tests validate the EPUB ZIP/container structure, first uncompressed mimetype entry, OPF manifest, scripted declaration, viewer resources, data, ten fonts, licenses, and offline viewer code.

Before EPUB support is considered complete for release, it should additionally pass an actual-device acceptance test in Apple Books on iPhone:

generate EPUB
→ open/save in Apple Books
→ enable airplane mode
→ close and reopen Books
→ open EPUB
→ verify Back / Next
→ verify random font rerolls
→ verify sizing/fitting
→ verify Diagnostic mapping table
→ rotate and verify refit without reroll

Persistence and migration

The default SQLite file is:

./data/app.sqlite

Override it with DATABASE_PATH.

Iteration 2 performs a non-destructive schema upgrade for Iteration 1 databases. It removes Iteration 1’s observation-level uniqueness on (source_id, source_key) so repeats can create distinct acquisitions, creates the shared source_records cache, adds profile selection settings/weights, and adds persisted selection snapshots.

Already-ready Iteration 1 observations are backfilled into the shared source-record cache. A compatibility-only disabled Iteration 1 mock resolver remains available for old pending mock rows but is not one of the three selectable Iteration 2 sources.

Environment defaults

See .env.example.

SOURCE1_WEIGHT=1
SOURCE2_WEIGHT=1
SOURCE3_WEIGHT=1
COMPLEXITY_PERCENTILE_TARGET=0.5
COMPLEXITY_PERCENTILE_SPREAD=0.25
MOCK_DELAY_MIN_MS=1000
MOCK_DELAY_MAX_MS=15000
MAX_EXPORT_COUNT=500