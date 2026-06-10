/**
 * Anonymous identity via a signed, httpOnly session cookie.
 *
 * Cookie value: `v1.<userId>.<expiresAtMs>.<base64url(hmacSha256(payload))>`.
 * The first visit mints a random userId; there is no account, no password,
 * no PII — the same zero-friction model as the 2015 app, minus the fake
 * email/password accounts.
 */

export const SESSION_COOKIE = 'rp_session';
const VERSION = 'v1';
const SESSION_TTL_MS = 365 * 24 * 60 * 60 * 1000;

const encoder = new TextEncoder();

function toBase64Url(bytes: ArrayBuffer): string {
  let binary = '';
  for (const b of new Uint8Array(bytes)) binary += String.fromCharCode(b);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

async function sign(payload: string, secret: string): Promise<string> {
  const key = await hmacKey(secret);
  return toBase64Url(await crypto.subtle.sign('HMAC', key, encoder.encode(payload)));
}

export async function createSessionCookieValue(
  userId: string,
  secret: string,
  now = Date.now(),
): Promise<string> {
  const expiresAt = now + SESSION_TTL_MS;
  const payload = `${VERSION}.${userId}.${expiresAt}`;
  return `${payload}.${await sign(payload, secret)}`;
}

/** Returns the userId if the cookie value is authentic and unexpired, else null. */
export async function verifySessionCookieValue(
  value: string | undefined,
  secret: string,
  now = Date.now(),
): Promise<string | null> {
  if (!value) return null;
  const parts = value.split('.');
  if (parts.length !== 4 || parts[0] !== VERSION) return null;
  const [, userId, expiresAtStr, signature] = parts;
  const expiresAt = Number(expiresAtStr);
  if (!userId || !Number.isFinite(expiresAt) || expiresAt < now) return null;
  const expected = await sign(`${VERSION}.${userId}.${expiresAtStr}`, secret);
  if (signature.length !== expected.length) return null;
  // Constant-time comparison.
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= signature.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0 ? userId : null;
}

export function parseCookies(header: string | null): Map<string, string> {
  const cookies = new Map<string, string>();
  if (!header) return cookies;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    cookies.set(part.slice(0, eq).trim(), part.slice(eq + 1).trim());
  }
  return cookies;
}

export async function userIdFromRequest(
  request: Request,
  secret: string,
): Promise<string | null> {
  const cookie = parseCookies(request.headers.get('Cookie')).get(SESSION_COOKIE);
  return verifySessionCookieValue(cookie, secret);
}

export function sessionSetCookieHeader(cookieValue: string): string {
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);
  return `${SESSION_COOKIE}=${cookieValue}; Max-Age=${maxAge}; Path=/; HttpOnly; Secure; SameSite=Lax`;
}
