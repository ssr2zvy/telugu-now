frontend/index.html

<!doctype html>
<html lang="te">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <meta name="theme-color" content="#707070" />
    <title>తెలుగు</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>

frontend/font-assets.json

[
  {
    "family": "Noto Sans Telugu",
    "fileName": "noto-sans-telugu.woff2",
    "licenseFileName": "notosanstelugu-OFL.txt",
    "googleFontsFolder": "notosanstelugu"
  },
  {
    "family": "Noto Serif Telugu",
    "fileName": "noto-serif-telugu.woff2",
    "licenseFileName": "notoseriftelugu-OFL.txt",
    "googleFontsFolder": "notoseriftelugu"
  },
  {
    "family": "Mandali",
    "fileName": "mandali.woff2",
    "licenseFileName": "mandali-OFL.txt",
    "googleFontsFolder": "mandali"
  },
  {
    "family": "Ramabhadra",
    "fileName": "ramabhadra.woff2",
    "licenseFileName": "ramabhadra-OFL.txt",
    "googleFontsFolder": "ramabhadra"
  },
  {
    "family": "NTR",
    "fileName": "ntr.woff2",
    "licenseFileName": "ntr-OFL.txt",
    "googleFontsFolder": "ntr"
  },
  {
    "family": "Peddana",
    "fileName": "peddana.woff2",
    "licenseFileName": "peddana-OFL.txt",
    "googleFontsFolder": "peddana"
  },
  {
    "family": "Ramaraja",
    "fileName": "ramaraja.woff2",
    "licenseFileName": "ramaraja-OFL.txt",
    "googleFontsFolder": "ramaraja"
  },
  {
    "family": "Sree Krushnadevaraya",
    "fileName": "sree-krushnadevaraya.woff2",
    "licenseFileName": "sreekrushnadevaraya-OFL.txt",
    "googleFontsFolder": "sreekrushnadevaraya"
  },
  {
    "family": "Suranna",
    "fileName": "suranna.woff2",
    "licenseFileName": "suranna-OFL.txt",
    "googleFontsFolder": "suranna"
  },
  {
    "family": "Tenali Ramakrishna",
    "fileName": "tenali-ramakrishna.woff2",
    "licenseFileName": "tenaliramakrishna-OFL.txt",
    "googleFontsFolder": "tenaliramakrishna"
  }
]

frontend/src/presentation.ts

export const OBSERVATION_FONTS = [
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
] as const;
export type ObservationFontFamily = (typeof OBSERVATION_FONTS)[number];
export const OBSERVATION_PRESENTATION = {
  fonts: OBSERVATION_FONTS,
  fontWeight: 400,
  emptyFontSizePx: 64,
  preferredMinimumFontSizePx: 24,
  preferredMaximumFontSizePx: 160,
  fitMinimumFontSizePx: 12,
  fitIterations: 10,
  fitVerticalReservePx: 64,
  heightBaseMinimumPx: 112,
  heightBaseMaximumPx: 160,
  heightFraction: 0.28,
  widthScaleMinimum: 0.86,
  widthScaleMaximum: 1.08,
  widthReferencePx: 650,
  contentCharacterDivisor: 12,
  contentExponent: 0.33,
  lineHeight: 1.3,
} as const;
function clamp(minimum: number, maximum: number, value: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
export function chooseRandomObservationFont(
  random: () => number = Math.random,
): ObservationFontFamily {
  const raw = random();
  const normalized = Number.isFinite(raw)
    ? clamp(0, 0.9999999999999999, raw)
    : 0;
  const index = Math.floor(normalized * OBSERVATION_PRESENTATION.fonts.length);
  return OBSERVATION_PRESENTATION.fonts[index]!;
}
export function preferredObservationFontSizePx(
  text: string,
  containerWidth: number,
  containerHeight: number,
): number {
  const normalized = text.trim().replace(/\s+/g, ' ');
  if (!normalized) return OBSERVATION_PRESENTATION.emptyFontSizePx;
  const words = normalized.split(' ').length;
  const nonWhitespaceCharacters = Array.from(
    normalized.replace(/\s/g, ''),
  ).length;
  const contentLoad = Math.max(
    1,
    words + nonWhitespaceCharacters / OBSERVATION_PRESENTATION.contentCharacterDivisor,
  );
  const heightBase = clamp(
    OBSERVATION_PRESENTATION.heightBaseMinimumPx,
    OBSERVATION_PRESENTATION.heightBaseMaximumPx,
    containerHeight * OBSERVATION_PRESENTATION.heightFraction,
  );
  const widthScale = clamp(
    OBSERVATION_PRESENTATION.widthScaleMinimum,
    OBSERVATION_PRESENTATION.widthScaleMaximum,
    containerWidth / OBSERVATION_PRESENTATION.widthReferencePx,
  );
  const size =
    (heightBase * widthScale) /
    Math.pow(contentLoad, OBSERVATION_PRESENTATION.contentExponent);
  return clamp(
    OBSERVATION_PRESENTATION.preferredMinimumFontSizePx,
    OBSERVATION_PRESENTATION.preferredMaximumFontSizePx,
    size,
  );
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
export function installLiveObservationFontFaces(documentValue: Document = document): void {
  if (liveFontFacesInstalled || documentValue.getElementById('telugu-now-observation-fonts')) {
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
function bytesToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
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
export async function loadEmbeddedObservationFontBundle(
  fetchValue: typeof fetch = fetch,
): Promise<EmbeddedObservationFontBundle> {
  const fonts = await Promise.all(
    OBSERVATION_FONT_ASSETS.map(async (asset): Promise<EmbeddedObservationFont> => {
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
        dataUrl: `data:font/woff2;base64,${bytesToBase64(fontBuffer)}`,
        licenseText,
      };
    }),
  );
  return { fonts };
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

frontend/src/main.tsx

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { installLiveObservationFontFaces } from './font-assets';
installLiveObservationFontFaces();
const root = document.getElementById('root');
if (!root) throw new Error('Missing root element.');
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

frontend/src/observation/useObservationTypography.ts

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from 'react';
import type {
  DisplayObservation,
} from '../../../shared/contracts';
import {
  OBSERVATION_PRESENTATION,
  chooseRandomObservationFont,
  preferredObservationFontSizePx,
  type ObservationFontFamily,
} from '../presentation';
interface ObservationPresentation {
  observationId: string | null;
  fontFamily: ObservationFontFamily;
}
export interface ObservationTypography {
  containerRef: RefObject<HTMLElement | null>;
  textRef: RefObject<HTMLDivElement | null>;
  style: CSSProperties;
}
export function useObservationTypography(
  observation: DisplayObservation | null,
): ObservationTypography {
  const containerRef = useRef<HTMLElement | null>(null);
  const textRef = useRef<HTMLDivElement | null>(null);
  const [presentation, setPresentation] = useState<ObservationPresentation>(
    () => ({
      observationId: observation?.id ?? null,
      fontFamily: chooseRandomObservationFont(),
    }),
  );
  const [fontSizePx, setFontSizePx] = useState<number>(
    OBSERVATION_PRESENTATION.emptyFontSizePx,
  );
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const observationId = observation?.id ?? null;
    if (observationId === presentation.observationId) return;
    setPresentation({
      observationId,
      fontFamily: chooseRandomObservationFont(),
    });
  }, [observation?.id, presentation.observationId]);
  useLayoutEffect(() => {
    const container = containerRef.current;
    const element = textRef.current;
    if (!observation || !container || !element) {
      setReady(false);
      return;
    }
    let cancelled = false;
    let resizeObserver: ResizeObserver | null = null;
    const fit = async () => {
      setReady(false);
      const containerRect = container.getBoundingClientRect();
      const availableHeight = Math.max(
        1,
        containerRect.height - OBSERVATION_PRESENTATION.fitVerticalReservePx,
      );
      const desired = preferredObservationFontSizePx(
        observation.text,
        containerRect.width,
        availableHeight,
      );
      try {
        await document.fonts.load(
          `${OBSERVATION_PRESENTATION.fontWeight} ${Math.max(
            OBSERVATION_PRESENTATION.preferredMinimumFontSizePx,
            desired,
          )}px "${presentation.fontFamily}"`,
          observation.text.slice(0, 64),
        );
      } catch {
        // The local fallback stack remains usable if a font cannot be loaded.
      }
      if (cancelled) return;
      let low: number = OBSERVATION_PRESENTATION.fitMinimumFontSizePx;
      let high: number = desired;
      let best: number = Math.min(low, desired);
      for (
        let iteration = 0;
        iteration < OBSERVATION_PRESENTATION.fitIterations;
        iteration += 1
      ) {
        const candidate = (low + high) / 2;
        element.style.fontSize = `${candidate}px`;
        const fitsWidth = element.scrollWidth <= element.clientWidth + 1;
        const fitsHeight = element.scrollHeight <= availableHeight + 1;
        if (fitsWidth && fitsHeight) {
          best = candidate;
          low = candidate;
        } else {
          high = candidate;
        }
      }
      const finalSize = Math.max(
        OBSERVATION_PRESENTATION.fitMinimumFontSizePx,
        Math.min(desired, best),
      );
      element.style.fontSize = `${finalSize}px`;
      setFontSizePx(finalSize);
      setReady(true);
    };
    void fit();
    resizeObserver = new ResizeObserver(() => {
      void fit();
    });
    resizeObserver.observe(container);
    return () => {
      cancelled = true;
      resizeObserver?.disconnect();
    };
  }, [
    observation?.id,
    observation?.text,
    presentation.fontFamily,
  ]);
  return {
    containerRef,
    textRef,
    style: {
      fontFamily:
        `"${presentation.fontFamily}", ` +
        '"Noto Sans Telugu", "Nirmala UI", sans-serif',
      fontSize: `${fontSizePx}px`,
      lineHeight: OBSERVATION_PRESENTATION.lineHeight,
      opacity: ready ? 1 : 0,
    },
  };
}

frontend/src/export-html.ts

import type {
  ExportResponse,
} from '../../shared/contracts';
import {
  createPlaceholderEmbeddedObservationFontBundle,
  loadEmbeddedObservationFontBundle,
  observationFontFaceCss,
  type EmbeddedObservationFontBundle,
} from './font-assets';
import {
  OBSERVATION_PRESENTATION,
} from './presentation';
export interface PreparedStandaloneExport {
  html: string;
  entryCount: number;
}
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
  const serialized = safeJson(result);
  const presentation = safeJson(OBSERVATION_PRESENTATION);
  const licenseNotices = safeJson(
    fontBundle.fonts.map((font) => ({
      family: font.family,
      licenseText: font.licenseText,
    })),
  );
  const fontFaces = embeddedFontCss(fontBundle);
  return `<!doctype html>
<html lang="te">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>తెలుగు</title>
<style>
${fontFaces}
html,body{margin:0;width:100%;height:100%;overflow:hidden;font-family:"Noto Sans Telugu","Nirmala UI",sans-serif;background:#707070;color:#171717}
*{box-sizing:border-box}
main{position:relative;width:100%;height:100%;min-height:100dvh;display:grid;grid-template-columns:minmax(3.5rem,16vw) 1fr minmax(3.5rem,16vw);background:radial-gradient(circle at 50% 35%,rgba(255,255,255,.22),transparent 42%),linear-gradient(145deg,#9a9a9a 0%,#707070 48%,#515151 100%)}
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
</style>
</head>
<body>
<main>
<button id="back" class="nav" aria-label="వెనుక">‹</button>
<div id="text-wrap"><div id="text"></div></div>
<button id="next" class="nav" aria-label="తర్వాత">›</button>
<button id="info" aria-label="సమాచారం">i</button>
<div id="position"></div>
<section id="diagnostic" aria-label="Diagnostic"><table><tbody id="diagnostic-body"></tbody></table></section>
<script type="application/json" id="font-license-notices">${licenseNotices}</script>
</main>
<script>
const DATA=${serialized};
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
back.addEventListener('click',()=>{if(index>0)void activate(index-1)});
next.addEventListener('click',()=>{if(index<DATA.entries.length-1)void activate(index+1)});
document.getElementById('info').addEventListener('click',()=>diagnostic.classList.toggle('visible'));
window.addEventListener('resize',()=>{
  if(resizeFrame!==null&&window.cancelAnimationFrame)window.cancelAnimationFrame(resizeFrame);
  const schedule=window.requestAnimationFrame||function(callback){return window.setTimeout(callback,0)};
  resizeFrame=schedule(()=>{resizeFrame=null;fitActive()});
});
void activate(0);
</script>
</body>
</html>`;
}
export async function prepareStandaloneExportHtml(
  result: ExportResponse,
): Promise<PreparedStandaloneExport> {
  const fontBundle = await loadEmbeddedObservationFontBundle();
  return {
    html: buildStandaloneExportHtml(result, fontBundle),
    entryCount: result.entries.length,
  };
}
export function downloadPreparedExportHtml(
  prepared: PreparedStandaloneExport,
): void {
  const blob = new Blob(
    [prepared.html],
    { type: 'text/html;charset=utf-8' },
  );
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `telugu-export-${prepared.entryCount}.html`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

frontend/src/settings/useSettingsController.ts

import {
  useState,
} from 'react';
import type {
  ProfileSelectionSettings,
  ProfileStateResponse,
} from '../../../shared/contracts';
import {
  generateExport,
  updateSelectionSettings,
} from '../api';
import {
  prepareStandaloneExportHtml,
  type PreparedStandaloneExport,
} from '../export-html';
import {
  loadSettingsLanguage,
  saveSettingsLanguage,
} from './language';
import {
  draftFromSettings,
} from './settings-utils';
import type {
  SettingsDraft,
  SettingsPage,
  UiLanguage,
} from './types';
interface UseSettingsControllerOptions {
  profileCode: string | null;
  state: ProfileStateResponse | null;
  onSettingsSaved: (
    settings: ProfileSelectionSettings,
  ) => void;
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
  preparedExport: PreparedStandaloneExport | null;
  prepareOpen: () => void;
  enterPage: (
    page: Exclude<SettingsPage, 'index'>,
  ) => void;
  backToIndex: () => void;
  toggleLanguage: () => void;
  setDraft: (draft: SettingsDraft) => void;
  clearSettingsError: () => void;
  saveComplexitySettings: () => Promise<void>;
  saveSourceSettings: () => Promise<void>;
  setExportCount: (count: string) => void;
  startExport: () => Promise<void>;
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
  const [preparedExport, setPreparedExport] =
    useState<PreparedStandaloneExport | null>(null);
  const prepareOpen = () => {
    if (!state) return;
    setDraftState(draftFromSettings(state.selectionSettings));
    setSettingsError(false);
    setExportError(false);
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
    setPage(nextPage);
  };
  const backToIndex = () => {
    setSettingsError(false);
    setExportError(false);
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
      setPreparedExport(null);
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
      setPreparedExport(null);
    } catch {
      setSettingsError(true);
    } finally {
      setSettingsSaving(false);
    }
  };
  const setExportCount = (count: string) => {
    setExportCountState(count);
    setPreparedExport(null);
    setExportError(false);
  };
  const startExport = async () => {
    if (!profileCode) return;
    const count = Number(exportCount);
    if (!Number.isInteger(count) || count <= 0) {
      setPreparedExport(null);
      setExportError(true);
      return;
    }
    setExporting(true);
    setExportError(false);
    setPreparedExport(null);
    try {
      const result = await generateExport(profileCode, { count });
      const prepared = await prepareStandaloneExportHtml(result);
      setPreparedExport(prepared);
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
    preparedExport,
    prepareOpen,
    enterPage,
    backToIndex,
    toggleLanguage,
    setDraft: setDraftState,
    clearSettingsError: () => setSettingsError(false),
    saveComplexitySettings,
    saveSourceSettings,
    setExportCount,
    startExport,
  };
}

frontend/src/settings/pages/ExportPage.tsx

import type {
  ChangeEvent,
} from 'react';
import {
  downloadPreparedExportHtml,
  type PreparedStandaloneExport,
} from '../../export-html';
import {
  t,
} from '../language';
import type {
  UiLanguage,
} from '../types';
interface ExportPageProps {
  language: UiLanguage;
  count: string;
  exporting: boolean;
  error: boolean;
  preparedExport: PreparedStandaloneExport | null;
  onCountChange: (count: string) => void;
  onExport: () => void;
}
export function ExportPage({
  language,
  count,
  exporting,
  error,
  preparedExport,
  onCountChange,
  onExport,
}: ExportPageProps) {
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
        onClick={onExport}
      >
        {exporting
          ? t(language, 'exporting')
          : t(language, 'export')}
      </button>
      <button
        className="secondary-action"
        type="button"
        disabled={exporting || preparedExport === null}
        onClick={() => {
          if (preparedExport) {
            downloadPreparedExportHtml(preparedExport);
          }
        }}
      >
        {t(language, 'download')}
      </button>
      {preparedExport ? (
        <div className="export-ready" role="status">
          {t(language, 'ready')}: {preparedExport.entryCount}
        </div>
      ) : null}
      {error ? (
        <div className="settings-error">
          {t(language, 'invalidExport')}
        </div>
      ) : null}
    </div>
  );
}

scripts/sync-fonts.mjs

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

package.json

{
  "name": "telugu-observation-app-iteration-2",
  "version": "0.2.0",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=20.0.0"
  },
  "scripts": {
    "dev": "concurrently --kill-others --names api,web \"npm:dev:server\" \"npm:dev:client\"",
    "dev:server": "tsx watch server/src/index.ts",
    "dev:client": "vite --config frontend/vite.config.ts",
    "build": "npm run typecheck && npm run build:client && npm run build:server",
    "build:client": "vite build --config frontend/vite.config.ts",
    "build:server": "tsup server/src/index.ts --format esm --platform node --target node20 --out-dir dist/server --sourcemap --clean",
    "typecheck": "tsc --noEmit",
    "start": "NODE_ENV=production node dist/server/index.js",
    "test": "tsx --test tests/*.test.ts",
    "fonts:sync": "node scripts/sync-fonts.mjs",
    "predev:client": "npm run fonts:sync",
    "prebuild:client": "npm run fonts:sync"
  },
  "dependencies": {
    "@hono/node-server": "^2.1.1",
    "better-sqlite3": "^12.4.1",
    "hono": "^4.12.8",
    "react": "^19.1.1",
    "react-dom": "^19.1.1"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.13",
    "@types/node": "^22.18.0",
    "@types/react": "^19.1.12",
    "@types/react-dom": "^19.1.9",
    "@vitejs/plugin-react": "^5.0.2",
    "concurrently": "^9.2.1",
    "tsup": "^8.5.0",
    "tsx": "^4.20.5",
    "typescript": "^5.9.2",
    "vite": "^7.1.4"
  }
}

tests/font-assets.test.ts

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  OBSERVATION_FONT_ASSETS,
  createPlaceholderEmbeddedObservationFontBundle,
  loadEmbeddedObservationFontBundle,
  observationFontFaceCss,
} from '../frontend/src/font-assets';
import {
  OBSERVATION_FONTS,
} from '../frontend/src/presentation';
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
test('embedded font bundle loader reads every font and license from local application paths', async () => {
  const requested: string[] = [];
  const fakeFetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    requested.push(url);
    if (url.includes('/licenses/')) {
      return new Response('SIL OPEN FONT LICENSE TEST', { status: 200 });
    }
    return new Response(new Uint8Array([1, 2, 3, 4]), { status: 200 });
  }) as typeof fetch;
  const bundle = await loadEmbeddedObservationFontBundle(fakeFetch);
  assert.equal(bundle.fonts.length, 10);
  assert.equal(requested.length, 20);
  assert.ok(requested.every((url) => url.startsWith('/fonts/')));
  for (const font of bundle.fonts) {
    assert.match(font.dataUrl, /^data:font\/woff2;base64,/);
    assert.equal(font.licenseText, 'SIL OPEN FONT LICENSE TEST');
  }
});

tests/presentation.test.ts

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  OBSERVATION_FONTS,
  OBSERVATION_PRESENTATION,
  chooseRandomObservationFont,
  preferredObservationFontSizePx,
} from '../frontend/src/presentation';
test('observation font collection is the fixed curated Telugu set', () => {
  assert.deepEqual(OBSERVATION_FONTS, [
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
  ]);
  assert.deepEqual(OBSERVATION_PRESENTATION.fonts, OBSERVATION_FONTS);
  assert.equal(OBSERVATION_PRESENTATION.fitIterations, 10);
  assert.equal(OBSERVATION_PRESENTATION.fitMinimumFontSizePx, 12);
  assert.equal(OBSERVATION_PRESENTATION.preferredMinimumFontSizePx, 24);
  assert.equal(OBSERVATION_PRESENTATION.preferredMaximumFontSizePx, 160);
});
test('random font selection maps the full random interval onto the curated collection', () => {
  assert.equal(chooseRandomObservationFont(() => 0), 'Noto Sans Telugu');
  assert.equal(chooseRandomObservationFont(() => 0.099999), 'Noto Sans Telugu');
  assert.equal(chooseRandomObservationFont(() => 0.1), 'Noto Serif Telugu');
  assert.equal(chooseRandomObservationFont(() => 0.999999), 'Tenali Ramakrishna');
});
test('preferred font size decreases smoothly as observation content grows', () => {
  const width = 700;
  const height = 700;
  const short = preferredObservationFontSizePx('తెలుగు', width, height);
  const medium = preferredObservationFontSizePx(
    'తెలుగు భాషలో కొన్ని పదాలు కలిసి ఒక వాక్యంగా కనిపిస్తున్నాయి',
    width,
    height,
  );
  const long = preferredObservationFontSizePx(
    Array.from({ length: 40 }, (_, index) => `పదం${index + 1}`).join(' '),
    width,
    height,
  );
  assert.ok(short > medium);
  assert.ok(medium > long);
  assert.ok(long >= OBSERVATION_PRESENTATION.preferredMinimumFontSizePx);
  assert.ok(short <= OBSERVATION_PRESENTATION.preferredMaximumFontSizePx);
});
test('preferred font size responds to available observation width without buckets', () => {
  const text = 'ఇది ఒక మధ్యస్థ పొడవు గల తెలుగు పరిశీలన వాక్యం';
  const narrow = preferredObservationFontSizePx(text, 240, 700);
  const wide = preferredObservationFontSizePx(text, 900, 700);
  assert.ok(wide > narrow);
});

tests/export-html.test.ts

import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {
  buildStandaloneExportHtml,
  prepareStandaloneExportHtml,
} from '../frontend/src/export-html';
import type {
  EmbeddedObservationFontBundle,
} from '../frontend/src/font-assets';
import {
  OBSERVATION_FONTS,
} from '../frontend/src/presentation';
import type {
  ExportResponse,
  SelectionSnapshot,
} from '../shared/contracts';
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
  contains(value: string): boolean {
    return this.values.has(value);
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
  readonly listeners = new Map<string, () => void>();
  addEventListener(name: string, listener: () => void): void {
    this.listeners.set(name, listener);
  }
  click(): void {
    this.listeners.get('click')?.();
  }
  getBoundingClientRect(): { width: number; height: number } {
    return { width: this.clientWidth, height: this.clientHeight };
  }
}
async function settle(): Promise<void> {
  await Promise.resolve();
  await new Promise<void>((resolve) => setImmediate(resolve));
}
test('standalone export embeds all ten fonts, license notices, and no external runtime dependencies', () => {
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
test('standalone export serializes the canonical presentation algorithm and mapping-table diagnostics', () => {
  const html = buildStandaloneExportHtml(sampleExport(), sampleFontBundle());
  assert.match(html, /const PRESENTATION=/);
  assert.match(html, /function preferredSize\(/);
  assert.match(html, /function chooseFont\(/);
  assert.match(html, /function fitActive\(/);
  assert.match(html, /document\.fonts\.load/);
  assert.match(html, /window\.addEventListener\('resize'/);
  assert.match(html, /<table><tbody id="diagnostic-body"><\/tbody><\/table>/);
  assert.equal(html.includes('<pre id="diagnostic"'), false);
  assert.match(html, /\['Source probability',percent\(selection\.sourceProbability\)\]/);
  assert.match(html, /\['Overall probability',percent\(selection\.overallProbability\)\]/);
});
test('standalone viewer rerolls font on entry activation but not diagnostic toggles or resize', async () => {
  const html = buildStandaloneExportHtml(sampleExport(), sampleFontBundle());
  const match = html.match(/<script>([\s\S]*)<\/script>\s*<\/body>/i);
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
  assert.equal(elements.position!.textContent, '1 / 2');
  assert.equal(randomCallCount, 1);
  assert.equal(fontLoadCount, 1);
  const firstSize = Number.parseFloat(elements.text!.style.fontSize ?? '0');
  assert.ok(firstSize > 0);
  elements.info!.click();
  elements.info!.click();
  assert.equal(randomCallCount, 1);
  assert.equal(fontLoadCount, 1);
  windowListeners.get('resize')?.();
  assert.equal(randomCallCount, 1);
  assert.equal(fontLoadCount, 1);
  assert.match(elements.text!.style.fontFamily ?? '', /Noto Sans Telugu/);
  elements.next!.click();
  await settle();
  assert.equal(elements.position!.textContent, '2 / 2');
  assert.match(elements.text!.style.fontFamily ?? '', /Peddana/);
  assert.equal(randomCallCount, 2);
  assert.equal(fontLoadCount, 2);
  const secondSize = Number.parseFloat(elements.text!.style.fontSize ?? '0');
  assert.ok(secondSize > 0);
  assert.ok(secondSize < firstSize);
  elements.back!.click();
  await settle();
  assert.equal(elements.position!.textContent, '1 / 2');
  assert.match(elements.text!.style.fontFamily ?? '', /Tenali Ramakrishna/);
  assert.equal(randomCallCount, 3);
  assert.equal(fontLoadCount, 3);
});
test('prepared standalone export resolves the complete local font bundle before download becomes ready', async () => {
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
    const prepared = await prepareStandaloneExportHtml(sampleExport());
    assert.equal(prepared.entryCount, 2);
    assert.equal((prepared.html.match(/@font-face/g) ?? []).length, 10);
    assert.equal(requested.length, 20);
    assert.ok(requested.every((url) => url.startsWith('/fonts/')));
    assert.equal(/\bfetch\s*\(/.test(prepared.html), false);
  } finally {
    globalThis.fetch = originalFetch;
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
test('Iteration 2 frontend remains split by profile, observation, settings, export, and shared UI ownership', () => {
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
  assert.equal(app.includes('section-toggle'), false);
  assert.equal(app.includes('chooseRandomObservationFont'), false);
  assert.ok(app.split('\n').length < 100);
});
test('Iteration 2 Settings contract remains page-based with mapping-table diagnostics and two-stage export', () => {
  const settingsTypes = read('frontend/src/settings/types.ts');
  const settingsView = read('frontend/src/settings/SettingsView.tsx');
  const shell = read('frontend/src/settings/SettingsShell.tsx');
  const diagnosticPage = read('frontend/src/settings/pages/DiagnosticPage.tsx');
  const exportPage = read('frontend/src/settings/pages/ExportPage.tsx');
  const settingsController = read('frontend/src/settings/useSettingsController.ts');
  const styles = read('frontend/src/styles/settings.css');
  const readme = read('README.md');
  for (const page of ['complexity', 'sources', 'diagnostic', 'export']) {
    assert.ok(settingsTypes.includes(`| '${page}'`));
  }
  assert.ok(settingsView.includes('<SettingsIndex'));
  assert.ok(settingsView.includes('<ComplexityPage'));
  assert.ok(settingsView.includes('<SourceWeightsPage'));
  assert.ok(settingsView.includes('<DiagnosticPage'));
  assert.ok(settingsView.includes('<ExportPage'));
  assert.ok(shell.includes('className="language-toggle"'));
  assert.ok(diagnosticPage.includes('className="diagnostic-table"'));
  assert.ok(exportPage.includes('downloadPreparedExportHtml(preparedExport)'));
  assert.ok(settingsController.includes('prepareStandaloneExportHtml(result)'));
  assert.ok(settingsController.includes('setPreparedExport(null)'));
  assert.ok(styles.includes('.settings-screen'));
  assert.ok(styles.includes('.diagnostic-table'));
  assert.ok(readme.includes('full-page Settings'));
  assert.ok(readme.includes('Export first generates the batch'));
});
test('Iteration 2 live presentation uses local application fonts and the canonical presentation specification', () => {
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
  const html = read('frontend/index.html');
  assert.ok(icons.includes('export function SettingsIcon'));
  assert.ok(icons.includes('export function LanguageIcon'));
  assert.equal(icons.includes('⚙'), false);
  assert.equal(icons.includes('🌐'), false);
  assert.ok(baseStyles.includes('stroke: currentColor'));
  assert.ok(profileEntry.includes("'--entry-layout-height'"));
  assert.ok(/height:\s*var\(\s*--entry-layout-height/.test(profileStyles));
  assert.ok(observationView.includes('<SettingsIcon />'));
  assert.ok(observationView.includes('className="observation-placeholder"'));
  assert.ok(observationView.includes('useObservationTypography('));
  assert.ok(typography.includes('chooseRandomObservationFont()'));
  assert.ok(typography.includes('OBSERVATION_PRESENTATION.fitIterations'));
  assert.ok(typography.includes('preferredObservationFontSizePx('));
  assert.ok(typography.includes('document.fonts.load('));
  assert.ok(observationStyles.includes('.nav-zone:disabled'));
  assert.ok(observationStyles.includes('.settings-trigger'));
  assert.ok(observationStyles.includes('bottom:'));
  assert.ok(main.includes('installLiveObservationFontFaces()'));
  assert.ok(fontAssets.includes("source: localFontUrl(asset.fileName)"));
  assert.equal(html.includes('fonts.googleapis.com'), false);
  assert.equal(html.includes('fonts.gstatic.com'), false);
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
test('Iteration 2 standalone export embeds all font assets and reuses live presentation semantics without runtime network access', () => {
  const exportHtml = read('frontend/src/export-html.ts');
  const fontAssets = read('frontend/src/font-assets.ts');
  const packageJson = JSON.parse(read('package.json')) as {
    scripts?: Record<string, string>;
  };
  const syncScript = read('scripts/sync-fonts.mjs');
  const readme = read('README.md');
  assert.ok(exportHtml.includes('loadEmbeddedObservationFontBundle()'));
  assert.ok(exportHtml.includes('OBSERVATION_PRESENTATION'));
  assert.ok(exportHtml.includes('const PRESENTATION='));
  assert.ok(exportHtml.includes('function chooseFont()'));
  assert.ok(exportHtml.includes('function preferredSize('));
  assert.ok(exportHtml.includes('function fitActive()'));
  assert.ok(exportHtml.includes('document.fonts.load'));
  assert.ok(exportHtml.includes("window.addEventListener('resize'"));
  assert.ok(fontAssets.includes('data:font/woff2'));
  assert.equal(exportHtml.includes('fonts.googleapis.com'), false);
  assert.equal(exportHtml.includes('fonts.gstatic.com'), false);
  assert.ok(fontAssets.includes("localFontUrl(asset.fileName)"));
  assert.ok(fontAssets.includes("localLicenseUrl(asset.licenseFileName)"));
  assert.equal(packageJson.scripts?.['fonts:sync'], 'node scripts/sync-fonts.mjs');
  assert.equal(packageJson.scripts?.['predev:client'], 'npm run fonts:sync');
  assert.equal(packageJson.scripts?.['prebuild:client'], 'npm run fonts:sync');
  assert.ok(syncScript.includes('font-assets.lock.json'));
  assert.ok(syncScript.includes('fonts.googleapis.com/css2'));
  assert.ok(syncScript.includes('fonts\\.gstatic\\.com'));
  assert.ok(syncScript.includes('OFL.txt'));
  assert.ok(readme.includes('same ten application-controlled Telugu WOFF2 assets'));
  assert.ok(readme.includes('self-contained'));
});

README.md

# Implementation Iteration 2
This repository contains Implementation Iteration 2 of the Telugu observation app. Iteration 1's persistent history/timing model, ten-item future queue, continuous one-for-one replenishment, sequential live preparation, and SQLite persistence remain the foundation.
Iteration 2 adds the source/complexity selection engine, persistent profile settings, repeatable source-record caching, tap-revealed controls, full-page Settings navigation, bilingual Settings labels, structured diagnostics, activation-time randomized Telugu typography, and standalone batch export. The actual external Telugu datasets are still mocked by three deterministic local sources.
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

Once a package-lock.json exists, dependency installation uses npm ci. An installed dependency tree can be reinstalled with:

./control.sh deps --option reinstall

Start development:

./control.sh dev

Choose start. Development runs in the foreground with normal Vite/Hono output attached to the terminal; Ctrl+C stops it. A second terminal can run ./control.sh dev and choose stop to terminate the running dev process group.

The browser app is served by Vite on port 5173. The Hono API runs on 127.0.0.1:8787. Vite binds to 0.0.0.0 so development-container/Codespaces forwarding can expose the UI.

The configured prototype profile code is 001.

Font assets

The live application and standalone exports use the same ten application-controlled Telugu WOFF2 assets. They are materialized under:

frontend/public/fonts/

The canonical family/file mapping is frontend/font-assets.json.

Run:

npm run fonts:sync

The sync script obtains the Telugu WOFF2 face for each configured family, stores the corresponding SIL Open Font License text, and writes frontend/public/fonts/font-assets.lock.json containing the exact resolved source URLs and SHA-256 hashes. If a lock already exists, the script verifies the local assets and restores a missing asset only from its locked source URL, rejecting hash mismatches.

npm run dev:client and npm run build:client automatically run fonts:sync first. A release repository should commit the generated WOFF2 files, license files, and lock file so normal production builds do not depend on a later upstream font change.

No font is fetched from the internet while a user generates or opens an export. Export preparation reads only the local application font assets.

Build and tests

./control.sh build --option start
./control.sh test --option start

The test suite preserves the accepted Iteration 1 queue/history/timing invariants and adds checks for Iteration 2 catalogs, global percentile calibration, canonical source weights, probability snapshots, repeats, settings isolation, shared source-record caching, batch export isolation, migration from the accepted Iteration 1 schema, numerical edge cases in the normal-distribution selector, standalone export behavior, and the control.sh repository contract.

Selection is also checked against an independently implemented numerical probability oracle, a deterministic 100-selection black-box audit, injected random-number boundary cases, and a seeded 50,000-selection Monte Carlo comparison against the full expected source+row distribution.

Frontend tests guard page-based Settings, mapping-table diagnostics, the ... empty observation state, permanently positioned revealed navigation arrows, two-stage Export/Download behavior, monochrome application-rendered Settings/language controls, the stable profile-entry viewport anchor, the curated font collection, local font asset coverage, and live/export presentation parity.

Deterministic dummy sources

Iteration 2 has exactly three selectable dummy sources:

* source1: 12 rows
* source2: 24 rows
* source3: 36 rows

Their literal Telugu rows live under server/src/sources/dummy/data/. Each row has a stable source key.

The fixture lengths were sampled once from fixed-seed right-skewed distributions and then committed literally; they are never regenerated at runtime. source1 is shorter on average, source2 is moderate, and source3 is longer and broader.

Across the 72 rows the current committed fixture spans 1 through 40 words, so the complexity system is not shaped around a six-word mock ceiling.

An uncached dummy source retrieval waits 1–15 seconds by default. The delay can be overridden in the environment for local testing.

Source selection

Each profile stores one source weight per selectable source. Every weight is in [0,1], and at least one weight must be exactly 1; configurations with every weight below 1 are rejected rather than normalized.

For source i, with N_i selectable rows and profile weight w_i:

source mass = N_i * w_i
P(source i) = (N_i * w_i) / sum_j(N_j * w_j)

With all source weights at 1, source probability is proportional to source row count.

Global complexity reference

Iteration 2 uses word count only as the intrinsic measurement used to build one global complexity reference from all 72 selectable dummy rows. The user does not configure a target word count.

For each word count k, tied rows occupy their empirical global percentile interval [a_k,b_k].

The reference is versioned as:

complexity_reference_version = 1

Profile source weights never change this reference.

Each profile configures:

* global complexity percentile target T in [0,1];
* global complexity percentile spread R > 0.

The desired complexity curve is a normal distribution centered at T. R is the half-width corresponding to the central 98% reference interval, so:

sigma = R / 2.326347874

The normal is truncated and renormalized to the valid percentile domain [0,1]. Its probability mass over each tied word-count percentile interval is divided by the global number of rows with that word count to produce a per-row global complexity mass. Once a source has been selected, those masses are normalized across the rows actually available in that source.

Source probability, conditional row probability, and overall source+row probability remain distinct and are stored in every normal acquisition’s immutable selection snapshot.

Repeats and shared source-record cache

Selections are independent and with replacement. The same (source_id, source_key) can therefore appear in multiple acquisitions.

A stable source record and an acquisition are separate concepts:

* a source record is the underlying source row and normalized retrieved content;
* an acquisition is one particular probabilistic selection event.

source_records is the shared persistent cache, keyed by (source_id, source_key). Once either the live queue or Export retrieves a source record, later live/export selections of that row reuse the cached content without another source request.

Queue behavior

The live profile still maintains ten selected unseen observations. Initial load fills a short queue to ten. Every first-time consumption moves one observation into history and atomically reserves exactly one replacement at the tail of the future queue.

Back/forward movement through already-seen history does not consume the queue and creates no replacement. Live source-record preparation remains sequential and queue order remains authoritative regardless of later settings changes, cache-hit speed, or source latency.

Saved source/complexity settings affect only acquisitions selected after the save. Existing history, existing unseen selections, and already-pending preparation work are not resampled.

Observation controls

Back, Next, and the bottom-right Settings icon are hidden by default. A single tap on the ordinary observation surface reveals all three controls; another background tap hides them. A successful Back/Next navigation hides them again.

Whenever controls are revealed, both Back and Next remain in their fixed positions. If either direction is unavailable, its arrow is visibly greyed out and disabled rather than disappearing.

The Settings control and the Settings-language control are application-rendered monochrome SVGs that inherit the same grey UI color through currentColor. Platform emoji glyphs are not used for either control.

When a valid profile has no current observation yet, the observation area displays:

...

This is only a UI placeholder. It does not create a history entry, acquisition, source record, or timing record.

Stable profile-code entry

The initial three-digit profile-code input is anchored to the viewport height captured when the entry screen first renders. The entry screen uses that fixed layout height rather than the keyboard-responsive dynamic viewport height.

Opening the software keyboard therefore does not recenter, shrink, or push the profile-code input upward as the mobile visual viewport changes. The bar stays at its original physical vertical position for that entry-screen session.

Observation typography

Each time an observation becomes the actively displayed observation, the client randomly chooses one font from this fixed curated collection:

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

Font selection is presentation-only. It is not persisted in history, the acquisition, the source record, or the selection snapshot.

Navigating away from an observation and later returning to it chooses again. Closing Settings and returning to the observation also chooses again. A browser reload/new presentation session may choose again. Polling, timing refreshes, queue-readiness changes, and ordinary React rerenders do not reroll the font while the same observation remains continuously active.

The canonical presentation configuration is defined in frontend/src/presentation.ts. It contains the font pool and every sizing/fitting constant used by the live and standalone viewers.

The preferred observation font size is derived continuously from text load rather than from a few hardcoded sentence-length buckets. Short observations receive a larger preferred size and progressively longer observations receive progressively smaller sizes.

After the font is chosen, the browser loads that specific local family and measures the rendered observation. The fit pass reduces the preferred size only as necessary to fit the available observation width and height.

The order is:

observation becomes active
        ↓
choose random font
        ↓
derive preferred size from observation length
        ↓
load and measure that font
        ↓
reduce only if necessary to fit
        ↓
display

Full-page Settings

Settings replaces the observation view while it is open; it is not a modal. The Settings root page links to four child pages:

1. Complexity
2. Source weights
3. Diagnostic
4. Export

Every child page has a Back control that returns to the Settings root. The × control exits the entire Settings hierarchy and returns to the same observation.

Because the observation is not visible while a Settings page is displayed, opening Settings pauses the current observation’s visible-time accumulation. The history-tail absolute timer continues according to the accepted Iteration 1 timing rules. Closing Settings resumes visible-time accumulation if the observation is otherwise visible and creates a fresh typography activation for that observation.

A monochrome language control remains fixed in the bottom-right throughout the Settings hierarchy. It switches all Settings labels, including diagnostic field names, between Telugu and English. The preference is presentation-only and is persisted locally in the browser. It does not change selection settings, queue state, acquisition snapshots, or export probabilities.

Complexity and source-weight pages

The Complexity page edits the global percentile target and spread. The Source weights page edits one canonical weight for each source. Both persist through the existing profile-settings API and backend validation remains authoritative.

Saving either page affects only future selections. Already-selected unseen observations, history, and already-pending preparation work remain unchanged.

Diagnostic

Diagnostic has its own full page and renders the current acquisition as a two-column mapping table rather than free-form diagnostic text.

The table preserves the Iteration 1 trigger/preparation fields and adds the complete persisted Iteration 2 selection snapshot, including source weights, source probability, row key, word count, global percentile interval, target/spread/reference version, conditional row probability, overall probability, and cache-hit/request information.

If there is no current acquisition, the Diagnostic page displays ... rather than fabricating values.

Export

Export is not a history export and does not simulate repeated Next presses.

The user enters a positive integer N. Export snapshots the profile’s current source weights, complexity target/spread, and complexity-reference version once, then performs exactly N independent fresh selections using the same source and complexity selection engine used by normal acquisitions.

Export does not:

* advance the current history cursor;
* append profile history;
* consume or replenish the live ten-item queue;
* consume normal acquisition numbers;
* alter observation timing.

Export does use and populate the normal persistent source_records cache. Selected uncached rows are resolved sequentially through the source adapter; cached rows are reused immediately.

The Export page uses two explicit stages. Export first generates the batch and then prepares the complete standalone artifact, including all ten local WOFF2 fonts and their license notices. While either step is running, Download is disabled. Download becomes available only after the self-contained HTML is fully prepared in memory.

Editing the export count invalidates the prepared Download. Successfully saving new complexity or source-weight settings also invalidates any prepared Download.

The standalone viewer contains all observations, diagnostics, CSS, JavaScript, the canonical presentation configuration, all ten embedded font binaries, and font-license notices in one .html file. It performs no network requests after download and does not depend on the Telugu Now server, Node.js, SQLite, APIs, installed Telugu fonts, Google Fonts, or external JavaScript/CSS.

Each exported observation activation follows the same presentation semantics as the live viewer:

entry becomes active
        ↓
randomly choose one of the same ten fonts
        ↓
wait for that embedded font
        ↓
derive preferred size from observation length
        ↓
measure the rendered text
        ↓
reduce only if necessary to fit
        ↓
display

Next/Back navigation rerolls the font for the newly activated entry, including when returning to an earlier entry. Opening or closing Diagnostic does not reroll. Viewport resize/orientation changes refit the current text while retaining its active font. Reopening the HTML starts a new presentation session.

The export renderer serializes OBSERVATION_PRESENTATION rather than maintaining a separate hand-written set of typography constants, so live and exported sizing behavior cannot silently drift.

Persistence and migration

The default SQLite file is:

./data/app.sqlite

Override it with DATABASE_PATH.

Iteration 2 performs a non-destructive schema upgrade for Iteration 1 databases. In particular, it removes Iteration 1’s observation-level uniqueness on (source_id, source_key) so repeats can create distinct acquisitions, creates the stable shared source_records cache, adds profile selection settings/weights, and adds persisted selection snapshots.

Already-ready Iteration 1 observations are backfilled into the shared source-record cache. A compatibility-only disabled Iteration 1 mock resolver remains available for old pending mock rows but is not part of the three selectable Iteration 2 sources.

Environment defaults

See .env.example. Important defaults are:

SOURCE1_WEIGHT=1
SOURCE2_WEIGHT=1
SOURCE3_WEIGHT=1
COMPLEXITY_PERCENTILE_TARGET=0.5
COMPLEXITY_PERCENTILE_SPREAD=0.25
MOCK_DELAY_MIN_MS=1000
MOCK_DELAY_MAX_MS=15000
MAX_EXPORT_COUNT=500