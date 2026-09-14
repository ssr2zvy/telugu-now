import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';

const COOKIE_NAME = 'tn_gate';
const SESSION_DAYS = 30;

/**
 * Shared-password gate in front of profile selection.
 *
 * `ACCESS_PASSWORD_HASH` holds a scrypt verifier in `scrypt$<saltHex>$<keyHex>`
 * form and `ACCESS_SESSION_SECRET` signs the session cookie. Both live in Fly
 * secrets; neither the password nor the hash is ever sent to the client.
 */
export interface GateConfig {
  passwordHash: string | undefined;
  sessionSecret: string | undefined;
}

function verifyPassword(password: string, encoded: string): boolean {
  const [scheme, salt, key] = encoded.split('$');
  if (scheme !== 'scrypt' || !salt || !key) return false;
  const expected = Buffer.from(key, 'hex');
  const actual = scryptSync(password, Buffer.from(salt, 'hex'), expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function sign(value: string, secret: string): string {
  return createHmac('sha256', secret).update(value).digest('hex');
}

function issueToken(secret: string): string {
  const payload = `${Date.now() + SESSION_DAYS * 86400000}.${randomBytes(8).toString('hex')}`;
  return `${payload}.${sign(payload, secret)}`;
}

function tokenValid(token: string | undefined, secret: string): boolean {
  if (!token) return false;
  const parts = token.split('.');
  const signature = parts.pop();
  const payload = parts.join('.');
  if (!signature || !payload) return false;
  const expected = Buffer.from(sign(payload, secret), 'hex');
  const actual = Buffer.from(signature, 'hex');
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return false;
  const expiry = Number(parts[0]);
  return Number.isFinite(expiry) && expiry > Date.now();
}

/** A gate with no configured hash is disabled, so local development is unaffected. */
export function gateEnabled(config: GateConfig): boolean {
  return Boolean(config.passwordHash && config.sessionSecret);
}

export function gateSatisfied(config: GateConfig, token: string | undefined): boolean {
  if (!gateEnabled(config)) return true;
  return tokenValid(token, config.sessionSecret as string);
}

export function accessGateRoutes(config: GateConfig) {
  const routes = new Hono();

  routes.get('/gate', (c) => c.json({
    required: gateEnabled(config),
    unlocked: gateSatisfied(config, getCookie(c, COOKIE_NAME)),
  }));

  routes.post('/gate', async (c) => {
    if (!gateEnabled(config)) return c.json({ required: false, unlocked: true });
    const body = await c.req.json<{ password?: unknown }>().catch(() => ({ password: undefined }));
    const password = typeof body.password === 'string' ? body.password : '';
    if (!password || !verifyPassword(password, config.passwordHash as string)) {
      return c.json({ required: true, unlocked: false }, 401);
    }
    setCookie(c, COOKIE_NAME, issueToken(config.sessionSecret as string), {
      httpOnly: true,
      sameSite: 'Lax',
      secure: true,
      path: '/',
      maxAge: SESSION_DAYS * 86400,
    });
    return c.json({ required: true, unlocked: true });
  });

  return routes;
}

export const ACCESS_COOKIE_NAME = COOKIE_NAME;
