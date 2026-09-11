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
#viewer.has-audio #text-wrap{margin-bottom:120px}
#audio{position:absolute;left:50%;bottom:64px;transform:translateX(-50%);width:min(416px,calc(100% - 48px));height:44px}
#audio[hidden]{display:none}
#text{width:100%;max-width:min(82vw,70rem);line-height:${OBSERVATION_PRESENTATION.lineHeight};overflow-wrap:anywhere;-webkit-user-select:text;user-select:text;opacity:0}
button{border:0;background:transparent;color:rgba(20,20,20,.48);font:inherit;cursor:pointer;-webkit-tap-highlight-color:transparent}
.nav{font-family:system-ui,sans-serif;font-size:clamp(2.2rem,6vw,4rem)}
button:disabled{opacity:.24;cursor:default}
#info{position:absolute;top:max(1rem,env(safe-area-inset-top));right:max(1rem,env(safe-area-inset-right));z-index:3;width:2.6rem;height:2.6rem;border-radius:50%;font-family:system-ui,sans-serif;font-weight:700}
#position{position:absolute;left:50%;bottom:max(1rem,env(safe-area-inset-bottom));transform:translateX(-50%);font:600 .8rem system-ui,sans-serif;color:rgba(20,20,20,.55)}
#diagnostic{position:absolute;inset:4.5rem 1rem 4rem 1rem;z-index:5;display:none;overflow:auto;padding:1rem;border-radius:1rem;background:linear-gradient(145deg,#9a9a9a 0%,#707070 48%,#515151 100%);box-shadow:0 .5rem 2rem rgba(0,0,0,.35)}
#diagnostic.visible{display:block}
.diagnostic-sections{display:flex;flex-direction:column;gap:1.1rem}
.diagnostic-section-title{margin:0 0 .5rem;color:rgba(20,20,20,.62);font-family:system-ui,sans-serif;font-size:.85rem;font-weight:700;text-transform:uppercase;letter-spacing:.04em}
.diagnostic-table-wrap{overflow-x:auto;border:1px solid rgba(30,30,30,.11);border-radius:.9rem;background:rgba(255,255,255,.13)}
.diagnostic-table{width:100%;border-collapse:collapse;table-layout:fixed;color:rgba(20,20,20,.78);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.78rem;line-height:1.45}
.diagnostic-table th,.diagnostic-table td{padding:.7rem .75rem;border-bottom:1px solid rgba(30,30,30,.08);vertical-align:top;overflow-wrap:anywhere}
.diagnostic-table tr:last-child th,.diagnostic-table tr:last-child td{border-bottom:0}
.diagnostic-table th{width:46%;color:rgba(20,20,20,.6);text-align:left;font-weight:600}
.diagnostic-table td{width:54%;font-variant-numeric:tabular-nums}
`;
}
export function buildStandaloneViewerMarkup(): string {
  return `<main id="viewer">
<button id="back" class="nav" type="button" aria-label="వెనుక">‹</button>
<div id="text-wrap"><div id="text"></div></div>
<button id="next" class="nav" type="button" aria-label="తర్వాత">›</button>
<button id="info" type="button" aria-label="సమాచారం">i</button>
<div id="position"></div>
<audio id="audio" controls="controls" preload="metadata" hidden="hidden"></audio>
<section id="diagnostic" aria-label="Diagnostic"><div id="diagnostic-body" class="diagnostic-sections"></div></section>
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
const audio=document.getElementById('audio');
const viewer=document.getElementById('viewer');
function clamp(minimum,maximum,value){return Math.min(maximum,Math.max(minimum,value))}
function number(value){if(value===0)return '0';if(Math.abs(value)<0.000001)return value.toExponential(6);return value.toFixed(8).replace(/0+$/,'').replace(/\\.$/,'')}
function percent(value){return (value*100).toFixed(4)+'%'}
function time(value){if(value===null)return '—';return new Date(value).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'})}
function sourceName(sourceId){const match=/^source(\\d+)$/.exec(sourceId);return match?match[1]:sourceId}
function sourceWeights(weights){return Object.entries(weights).sort(function(a,b){return a[0].localeCompare(b[0])}).map(function(pair){return sourceName(pair[0])+': '+number(pair[1])}).join(' · ')}
function escapeHtml(value){return String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;')}
function rowsFor(entry){
  return [
    ['Export position',entry.position],
    ['Cache hit',entry.diagnostic.cacheHit?'Yes':'No'],
    ['Request start',time(entry.diagnostic.requestStartedAt)],
    ['Request end',time(entry.diagnostic.requestCompletedAt)],
    ['Request duration',entry.diagnostic.requestDurationMs===null?'—':entry.diagnostic.requestDurationMs+' ms']
  ];
}
function sourceInfoRows(selection){
  return [
    ['Source weights',sourceWeights(selection.sourceWeights)],
    ['Source',selection.sourceId],
    ['Source rows',selection.sourceRowCount],
    ['Source weight',number(selection.sourceWeight)],
    ['Source mass',number(selection.sourceMass)],
    ['Total source mass',number(selection.totalSourceMass)],
    ['Source probability',percent(selection.sourceProbability)],
    ['Row',selection.sourceKey]
  ];
}
function complexityInfoRows(selection){
  return [
    ['Complexity metric',selection.complexityMetric],
    ['Complexity value',selection.intrinsicComplexityValue],
    ['Complexity reference','v'+selection.complexityReferenceVersion],
    ['Complexity target',percent(selection.complexityPercentileTarget)],
    ['Complexity spread','±'+percent(selection.complexityPercentileSpread)],
    ['Derived sigma',number(selection.derivedStandardDeviation)],
    ['Global percentile interval',percent(selection.globalPercentileStart)+'–'+percent(selection.globalPercentileEnd)],
    ['Global interval mass',number(selection.globalIntervalMass)],
    ['Global rows at complexity value',selection.globalRowsAtComplexityValue],
    ['Global per-row complexity mass',number(selection.globalPerRowComplexityMass)],
    ['Source rows at complexity value',selection.selectedSourceRowsAtComplexityValue],
    ['Source complexity denominator',number(selection.selectedSourceNormalizationDenominator)],
    ['Row probability within source',percent(selection.rowProbabilityWithinSource)]
  ];
}
function globalInfoRows(entry){
  return [
    ['Export position',entry.position],
    ['Overall probability',percent(entry.diagnostic.selection.overallProbability)]
  ];
}
function tableHtml(rows){
  return '<table class="diagnostic-table"><tbody>'+rows.map(function(row){return '<tr><th scope="row">'+escapeHtml(row[0])+'</th><td>'+escapeHtml(row[1])+'</td></tr>'}).join('')+'</tbody></table>';
}
function sectionHtml(title,rows){
  return '<div class="diagnostic-section"><h3 class="diagnostic-section-title">'+escapeHtml(title)+'</h3><div class="diagnostic-table-wrap">'+tableHtml(rows)+'</div></div>';
}
function renderDiagnostic(entry){
  const selection=entry.diagnostic.selection;
  diagnosticBody.innerHTML=
    sectionHtml('Request',rowsFor(entry))+
    sectionHtml('Source',sourceInfoRows(selection))+
    sectionHtml('Complexity',complexityInfoRows(selection))+
    sectionHtml('Summary',globalInfoRows(entry));
}
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
  audio.pause();
  audio.hidden=!entry.audio;
  viewer.classList.toggle('has-audio',Boolean(entry.audio));
  if(entry.audio){audio.src=entry.audio.url}else{audio.removeAttribute('src')}
  audio.load();
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
