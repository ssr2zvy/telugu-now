import type {
  ExportResponse,
} from '../../shared/contracts';
export function buildStandaloneExportHtml(
  result: ExportResponse,
): string {
  const serialized =
    JSON.stringify(result)
      .replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="te">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>తెలుగు</title>
<style>
html,body{margin:0;width:100%;height:100%;font-family:"Noto Sans Telugu","Nirmala UI",sans-serif;background:#707070;color:#171717}
*{box-sizing:border-box}
main{position:relative;width:100%;height:100%;min-height:100dvh;display:grid;grid-template-columns:minmax(3.5rem,16vw) 1fr minmax(3.5rem,16vw);background:radial-gradient(circle at 50% 35%,rgba(255,255,255,.22),transparent 42%),linear-gradient(145deg,#9a9a9a 0%,#707070 48%,#515151 100%)}
#text{display:flex;align-items:center;justify-content:center;text-align:center;padding:2rem .5rem;line-height:1.35;font-size:clamp(2.4rem,8vw,6rem);overflow-wrap:anywhere;user-select:none}
button{border:0;background:transparent;color:rgba(20,20,20,.48);font:inherit;cursor:pointer}
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
<div id="text"></div>
<button id="next" class="nav" aria-label="తర్వాత">›</button>
<button id="info" aria-label="సమాచారం">i</button>
<div id="position"></div>
<section id="diagnostic" aria-label="Diagnostic"><table><tbody id="diagnostic-body"></tbody></table></section>
</main>
<script>
const DATA=${serialized};
let index=0;
const text=document.getElementById('text');
const back=document.getElementById('back');
const next=document.getElementById('next');
const position=document.getElementById('position');
const diagnostic=document.getElementById('diagnostic');
const diagnosticBody=document.getElementById('diagnostic-body');
function number(value){if(value===0)return '0';if(Math.abs(value)<0.000001)return value.toExponential(6);return value.toFixed(8).replace(/0+$/,'').replace(/\\.$/,'')}
function percent(value){return (value*100).toFixed(4)+'%'}
function time(value){if(value===null)return '—';return new Date(value).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'})}
function sourceName(sourceId){const match=/^source(\\d+)$/.exec(sourceId);return match?match[1]:sourceId}
function sourceWeights(weights){return Object.entries(weights).sort(function(a,b){return a[0].localeCompare(b[0])}).map(function(pair){return sourceName(pair[0])+': '+number(pair[1])}).join(' · ')}
function escapeHtml(value){return String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;')}
function rowsFor(entry){
  const diagnostic=entry.diagnostic;
  const selection=diagnostic.selection;
  return [
    ['Export position',entry.position],
    ['Cache hit',diagnostic.cacheHit?'Yes':'No'],
    ['Request start',time(diagnostic.requestStartedAt)],
    ['Request end',time(diagnostic.requestCompletedAt)],
    ['Request duration',diagnostic.requestDurationMs===null?'—':diagnostic.requestDurationMs+' ms'],
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
function render(){const entry=DATA.entries[index];text.textContent=entry.text;back.disabled=index===0;next.disabled=index===DATA.entries.length-1;position.textContent=(index+1)+' / '+DATA.entries.length;renderDiagnostic(entry);diagnostic.classList.remove('visible')}
back.addEventListener('click',()=>{if(index>0){index--;render()}});
next.addEventListener('click',()=>{if(index<DATA.entries.length-1){index++;render()}});
document.getElementById('info').addEventListener('click',()=>diagnostic.classList.toggle('visible'));
render();
</script>
</body>
</html>`;
}
export function downloadExportHtml(
  result: ExportResponse,
): void {
  const html =
    buildStandaloneExportHtml(result);
  const blob = new Blob(
    [html],
    {
      type:
        'text/html;charset=utf-8',
    },
  );
  const url =
    URL.createObjectURL(blob);
  const anchor =
    document.createElement('a');
  anchor.href = url;
  anchor.download =
    `telugu-export-${result.entries.length}.html`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(
    () => URL.revokeObjectURL(url),
    0,
  );
}
