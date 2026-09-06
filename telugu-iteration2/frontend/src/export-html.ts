import type { ExportResponse } from '../../shared/contracts';

export function buildStandaloneExportHtml(result: ExportResponse): string {
  const serialized = JSON.stringify(result).replace(/</g, '\\u003c');
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
button:disabled{opacity:0;pointer-events:none}
#info{position:absolute;top:max(1rem,env(safe-area-inset-top));right:max(1rem,env(safe-area-inset-right));z-index:3;width:2.6rem;height:2.6rem;border-radius:50%;font-family:system-ui,sans-serif;font-weight:700}
#position{position:absolute;left:50%;bottom:max(1rem,env(safe-area-inset-bottom));transform:translateX(-50%);font:600 .8rem system-ui,sans-serif;color:rgba(20,20,20,.55)}
#diagnostic{position:absolute;inset:4.5rem 1rem 4rem 1rem;z-index:5;display:none;overflow:auto;padding:1rem;border-radius:1rem;background:rgba(220,220,220,.94);box-shadow:0 .5rem 2rem rgba(0,0,0,.2);white-space:pre-wrap;font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
#diagnostic.visible{display:block}
</style>
</head>
<body>
<main>
<button id="back" class="nav" aria-label="వెనుక">‹</button>
<div id="text"></div>
<button id="next" class="nav" aria-label="తర్వాత">›</button>
<button id="info" aria-label="సమాచారం">i</button>
<div id="position"></div>
<pre id="diagnostic"></pre>
</main>
<script>
const DATA=${serialized};
let index=0;
const text=document.getElementById('text');
const back=document.getElementById('back');
const next=document.getElementById('next');
const position=document.getElementById('position');
const diagnostic=document.getElementById('diagnostic');
function render(){const entry=DATA.entries[index];text.textContent=entry.text;back.disabled=index===0;next.disabled=index===DATA.entries.length-1;position.textContent=(index+1)+' / '+DATA.entries.length;diagnostic.textContent=JSON.stringify(entry.diagnostic,null,2);diagnostic.classList.remove('visible')}
back.addEventListener('click',()=>{if(index>0){index--;render()}});
next.addEventListener('click',()=>{if(index<DATA.entries.length-1){index++;render()}});
document.getElementById('info').addEventListener('click',()=>diagnostic.classList.toggle('visible'));
render();
</script>
</body>
</html>`;
}

export function downloadExportHtml(result: ExportResponse): void {
  const html = buildStandaloneExportHtml(result);
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `telugu-export-${result.entries.length}.html`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
