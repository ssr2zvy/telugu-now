import {randomBytes, randomInt, scrypt} from 'node:crypto';
import {SETUP_WORDS} from './setup-words';
import type {AccessCredentials} from './credentials';

export function generateSetupPhrase(): string {
  if (SETUP_WORDS.length < 256) throw new Error('Vocabulary unavailable');
  return Array.from({length: 10}, () => SETUP_WORDS[randomInt(SETUP_WORDS.length)]!).join(' ');
}
export function validSetupPhrase(value: unknown): value is string {
  return typeof value === 'string' && Buffer.byteLength(value, 'utf8') <= 1024
    && value.normalize('NFC').trim().split(/\s+/u).length >= 4
    && !/[\p{Cc}]/u.test(value);
}
export async function createSetupCredentials(phrase: string): Promise<AccessCredentials> {
  if (!validSetupPhrase(phrase)) throw new Error('Invalid phrase');
  const salt = randomBytes(16);
  const derived = await new Promise<Buffer>((resolve, reject) => scrypt(phrase.normalize('NFC').trim(), salt, 64,
    {N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024}, (error, result) => error ? reject(error) : resolve(result)));
  return {hash: `scrypt-v1$${salt.toString('hex')}$${derived.toString('hex')}`, secret: randomBytes(32).toString('hex')};
}

export function setupPage(error = ''): string {
  return `<!doctype html><html lang="te"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>ప్రవేశం</title>
<style>
html{color:#383747;background:linear-gradient(135deg,#e3e4ef,#d8e6e4);font-family:system-ui,sans-serif}body{margin:0;min-height:100dvh;display:grid;place-items:center}form{width:min(84vw,32rem);display:grid;gap:1.5rem}input{box-sizing:border-box;width:100%;font:inherit;font-size:1.25rem;padding:1rem .3rem;border:0;border-bottom:1px solid #737485;background:transparent;color:inherit;border-radius:0}button{width:48px;height:48px;background:none;border:0;color:inherit;cursor:pointer;border-radius:50%;display:grid;place-items:center}button:focus-visible{outline:2px solid #737485;outline-offset:3px}button:disabled{opacity:.35}button svg{width:24px;height:24px;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}.actions{display:flex;gap:.5rem;align-items:center}.actions button:last-child{margin-left:auto}p{font-size:.9rem;margin:0;min-height:1.5em}.account{position:absolute;clip-path:inset(50%);width:1px;height:1px;overflow:hidden}
</style>
<form method="post" action="/access/setup" autocomplete="on">
<input class="account" type="text" name="username" value="యజమాని" autocomplete="username" aria-label="వినియోగదారు" readonly tabindex="-1">
<input id="phrase" type="password" name="password" autocomplete="new-password" aria-label="ప్రవేశ వాక్యం" placeholder="ప్రవేశ వాక్యం" required maxlength="512" autocapitalize="none" spellcheck="false">
<div class="actions">
<button id="generate" type="button" aria-label="సృష్టించు" title="సృష్టించు"><svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="4"/><circle cx="8" cy="8" r=".8"/><circle cx="12" cy="12" r=".8"/><circle cx="16" cy="16" r=".8"/></svg></button>
<button id="reveal" type="button" aria-label="చూపించు" title="చూపించు" aria-pressed="false"><svg viewBox="0 0 24 24"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12"/><circle cx="12" cy="12" r="3"/></svg></button>
<button id="copy" type="button" aria-label="కాపీ" title="కాపీ"><svg viewBox="0 0 24 24"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M15 8V4H4v11h4"/></svg></button>
<button id="confirm" type="submit" aria-label="నిర్ధారించు" title="నిర్ధారించు"><svg viewBox="0 0 24 24"><path d="M4 12h16m-7-7 7 7-7 7"/></svg></button>
</div><p id="status" role="status" aria-live="polite">${error}</p></form>
<script>
const phrase=document.getElementById('phrase'),status=document.getElementById('status'),generate=document.getElementById('generate'),copy=document.getElementById('copy'),reveal=document.getElementById('reveal'),confirm=document.getElementById('confirm');
let generating=false;
generate.onclick=async()=>{if(generating)return;generating=true;generate.disabled=true;confirm.disabled=true;status.textContent='';try{const response=await fetch('/access/generate',{method:'POST',cache:'no-store'});if(response.status===409){location.replace('/access');return;}if(!response.ok)throw new Error();const result=await response.json();phrase.value=result.phrase;phrase.type='text';reveal.setAttribute('aria-pressed','true');reveal.setAttribute('aria-label','దాచు');phrase.focus();}catch{status.textContent='మళ్లీ ప్రయత్నించండి.';}finally{generating=false;generate.disabled=false;confirm.disabled=false;}};
reveal.onclick=()=>{const show=phrase.type==='password';phrase.type=show?'text':'password';reveal.setAttribute('aria-pressed',String(show));reveal.setAttribute('aria-label',show?'దాచు':'చూపించు');};
copy.onclick=async()=>{if(!phrase.value)return;try{await navigator.clipboard.writeText(phrase.value);copy.innerHTML='<svg viewBox="0 0 24 24"><path d="m5 12 4 4L19 6"/></svg>';status.textContent='';}catch{phrase.type='text';phrase.focus();phrase.select();status.textContent='ఎంచుకుని కాపీ చేయండి.';}};
document.querySelector('form').onsubmit=event=>{if(generating){event.preventDefault();return;}if(phrase.value.trim().split(/\\s+/u).length<4){event.preventDefault();status.textContent='కనీసం నాలుగు పదాలు.';}else{confirm.disabled=true;}};
if('serviceWorker' in navigator)navigator.serviceWorker.register('/service-worker.js').catch(()=>{});
</script></html>`;
}
