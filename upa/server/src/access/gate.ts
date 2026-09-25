import {accessCredentials, validCredentials} from './credentials';
import { createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { MiddlewareHandler } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { bodyLimit } from 'hono/body-limit';

const AGE = 30 * 24 * 60 * 60;
const clean = (text: string) => text.normalize('NFC').trim();
export function parseAccessHash(hash: string): {salt: Buffer; digest: Buffer} | null {
  const match = /^scrypt-v1\$([a-f0-9]{32})\$([a-f0-9]{128})$/.exec(hash);
  return match ? {salt: Buffer.from(match[1]!, 'hex'), digest: Buffer.from(match[2]!, 'hex')} : null;
}
export async function verifyAccessPassphrase(text: string, hash: string): Promise<boolean> {
  const parsed = parseAccessHash(hash);
  if (!parsed || Buffer.byteLength(text, 'utf8') > 1024) return false;
  const derived = await new Promise<Buffer>((resolve, reject) => scrypt(clean(text), parsed.salt, 64,
    {N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024}, (error, result) => error ? reject(error) : resolve(result)));
  return timingSafeEqual(derived, parsed.digest);
}
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export function issueAccessSession(hash: string, secret: string, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({expires: Math.floor(now / 1000) + AGE, version: digest(hash), nonce: randomBytes(24).toString('hex')})).toString('base64url');
  return `${payload}.${createHmac('sha256', secret).update(payload).digest('base64url')}`;
}
export function validAccessSession(token: string | undefined, hash: string, secret: string, now = Date.now()): boolean {
  if (!token || token.length > 1024) return false;
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra !== undefined) return false;
  const expected = createHmac('sha256', secret).update(payload).digest();
  const actual = Buffer.from(signature, 'base64url');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return false;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return data.version === digest(hash) && Number.isSafeInteger(data.expires)
      && data.expires > now / 1000 && data.expires <= now / 1000 + AGE;
  } catch { return false; }
}

export const retireOfflineCache = `self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('telugu-now-')).map(k=>caches.delete(k)))).then(()=>self.clients.claim()).then(()=>self.registration.unregister())));`;

function gatePage(error = ''): string {
  // Only fixed Telugu strings enter this document. No secret or user input is echoed.
  return `<!doctype html><html lang="te"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>ప్రవేశం</title>
<style>html{color:#383747;background:linear-gradient(135deg,#e3e4ef,#d8e6e4);font-family:system-ui,sans-serif}body{margin:0;min-height:100dvh;display:grid;place-items:center}form{width:min(78vw,26rem);display:grid;gap:1.5rem}input{box-sizing:border-box;width:100%;font:inherit;font-size:1.3rem;padding:1rem .3rem;border:0;border-bottom:1px solid #737485;background:transparent;color:inherit;border-radius:0;appearance:none;-webkit-appearance:none;outline:none;box-shadow:none;-webkit-tap-highlight-color:transparent}input:focus{outline:none;box-shadow:none;border-bottom-color:#383747}input:-webkit-autofill{-webkit-background-clip:text;-webkit-text-fill-color:#383747;caret-color:#383747}button{justify-self:end;width:48px;height:48px;background:none;border:0;color:inherit;cursor:pointer}button svg{width:24px;height:24px}p{font-size:.9rem;margin:0}.account{position:absolute;clip-path:inset(50%);width:1px;height:1px;overflow:hidden}</style>
<form method="post" action="/access" autocomplete="on"><input class="account" type="text" name="username" value="యజమాని" autocomplete="username" aria-label="వినియోగదారు" readonly tabindex="-1"><input type="password" name="password" autocomplete="current-password" aria-label="ప్రవేశ వాక్యం" placeholder="ప్రవేశ వాక్యం" required maxlength="512" autocapitalize="none" spellcheck="false"><button type="submit" aria-label="ప్రవేశించు"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 12h16m-7-7 7 7-7 7"/></svg></button>${error ? `<p role="alert">${error}</p>` : ''}</form>
<script>if('serviceWorker' in navigator)navigator.serviceWorker.register('/service-worker.js').catch(()=>{});</script></html>`;
}

export function accessGate(database: Database.Database, options: {
  hash?: () => string; secret?: () => string; secure?: boolean; now?: () => number;
  verify?: typeof verifyAccessPassphrase;
} = {}): MiddlewareHandler {
  database.exec('CREATE TABLE IF NOT EXISTS access_attempt_limits (bucket TEXT PRIMARY KEY, count INTEGER NOT NULL)');
  const credentials = accessCredentials(database);
  const now = options.now ?? Date.now;
  const secure = options.secure ?? process.env.NODE_ENV === 'production';
  const cookie = secure ? '__Host-telugu-access' : 'telugu-access';
  let verifying = false;
  const takeAttempt = database.transaction(() => {
    const minute = `m:${Math.floor(now()/60000)}`, hour = `h:${Math.floor(now()/3600000)}`;
    database.prepare('DELETE FROM access_attempt_limits WHERE bucket NOT IN (?,?)').run(minute,hour);
    const count = (key: string) => (database.prepare('SELECT count FROM access_attempt_limits WHERE bucket=?').get(key) as {count:number}|undefined)?.count ?? 0;
    if (count(minute) >= 5 || count(hour) >= 30) return false;
    for (const key of [minute,hour]) database.prepare('INSERT INTO access_attempt_limits VALUES(?,1) ON CONFLICT(bucket) DO UPDATE SET count=count+1').run(key);
    return true;
  });
  const limitedBody = bodyLimit({maxSize: 16384, onError: c => c.html(gatePage('వాక్యం చాలా పొడవుగా ఉంది.'),413)});
  return async (c, next) => {
    c.header('Cache-Control','no-store');
    c.header('Referrer-Policy','same-origin');
    c.header('X-Content-Type-Options','nosniff');
    c.header('X-Frame-Options','DENY');
    if (c.req.path === '/api/health' && c.req.method === 'GET') return c.json({ok:true});
    if (c.req.path === '/service-worker.js' && c.req.method === 'GET') return c.body(retireOfflineCache,200,{'Content-Type':'application/javascript'});
    if (c.req.path === '/access/setup' || c.req.path === '/access/generate') return c.notFound();
    const injected = options.hash || options.secret ? {hash: options.hash?.() ?? '', secret: options.secret?.() ?? ''} : null;
    const state = injected ? (validCredentials(injected) ? {status: 'ready' as const, credentials: injected} : {status: 'invalid' as const}) : credentials.resolve();
    const hash = state.status === 'ready' ? state.credentials.hash : '';
    const secret = state.status === 'ready' ? state.credentials.secret : '';
    const authenticated = state.status === 'ready' && validAccessSession(getCookie(c,cookie),hash,secret,now());
    if (!['GET','HEAD','OPTIONS'].includes(c.req.method)) {
      const origin = c.req.header('origin');
      // Native same-origin forms and fetches provide Origin. Allow originless
      // non-browser clients only when already authenticated.
      if ((!origin && !authenticated) || (origin && origin !== new URL(c.req.url).origin)) {
        // Fly terminates TLS before forwarding HTTP to the application.
        const publicOrigin = `https://${new URL(c.req.url).host}`;
        if (!origin || origin !== publicOrigin || !secure) return c.json({error:'invalid-origin'},403);
      }
      if (c.req.header('sec-fetch-site') === 'cross-site') return c.json({error:'invalid-origin'},403);
    }
    if (state.status !== 'ready') {
      return c.req.path.startsWith('/api/') ? c.json({error:'access-unconfigured'},503) : c.html(gatePage('ప్రవేశం ఇంకా సిద్ధంగా లేదు.'),503);
    }
    if (c.req.path === '/access' && c.req.method === 'POST') {
      return limitedBody(c, async () => {
        if (verifying || !takeAttempt()) { c.header('Retry-After','60'); c.res=c.html(gatePage('దయచేసి కొంతసేపటి తర్వాత ప్రయత్నించండి.'),429); return; }
        let valid = false;
        verifying = true;
        try {
          const body = await c.req.parseBody().catch(()=>({} as Record<string,unknown>));
          const password = body.password;
          valid = typeof password === 'string' && await (options.verify ?? verifyAccessPassphrase)(password,hash);
        }
        catch { c.res=c.html(gatePage('ప్రవేశం తాత్కాలికంగా అందుబాటులో లేదు.'),503); return; }
        finally { verifying = false; }
        if (!valid) { c.res=c.html(gatePage('ప్రవేశ వాక్యం సరిపోలలేదు.'),401); return; }
        setCookie(c,cookie,issueAccessSession(hash,secret,now()),{httpOnly:true,secure,sameSite:'Strict',path:'/',maxAge:AGE});
        c.res=c.redirect('/',303);
      });
    }
    if (!authenticated) {
      if (c.req.method === 'GET' && (c.req.path === '/' || c.req.path === '/access' || c.req.header('accept')?.includes('text/html'))) return c.html(gatePage());
      return c.json({error:'access-required'},401);
    }
    if (c.req.path === '/api/access/session' && c.req.method === 'GET') return c.json({authenticated:true});
    if (c.req.path === '/access/logout' && c.req.method === 'POST') {
      setCookie(c,cookie,'',{httpOnly:true,secure,sameSite:'Strict',path:'/',maxAge:0});
      return c.redirect('/',303);
    }
    if (c.req.path === '/access' && c.req.method === 'GET') return c.redirect('/',303);
    await next();
    c.header('Cache-Control','no-store');
  };
}
