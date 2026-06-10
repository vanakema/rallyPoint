import { describe, expect, it } from 'vitest';
import {
  createSessionCookieValue,
  parseCookies,
  verifySessionCookieValue,
} from '../src/auth.ts';

const SECRET = 'test-secret';

describe('session cookies', () => {
  it('round-trips a userId', async () => {
    const value = await createSessionCookieValue('user-1', SECRET);
    expect(await verifySessionCookieValue(value, SECRET)).toBe('user-1');
  });

  it('rejects a tampered userId', async () => {
    const value = await createSessionCookieValue('user-1', SECRET);
    const tampered = value.replace('user-1', 'user-2');
    expect(await verifySessionCookieValue(tampered, SECRET)).toBeNull();
  });

  it('rejects the wrong secret', async () => {
    const value = await createSessionCookieValue('user-1', SECRET);
    expect(await verifySessionCookieValue(value, 'other-secret')).toBeNull();
  });

  it('rejects expired sessions', async () => {
    const past = Date.now() - 2 * 365 * 24 * 60 * 60 * 1000;
    const value = await createSessionCookieValue('user-1', SECRET, past);
    expect(await verifySessionCookieValue(value, SECRET)).toBeNull();
  });

  it('rejects garbage', async () => {
    expect(await verifySessionCookieValue(undefined, SECRET)).toBeNull();
    expect(await verifySessionCookieValue('', SECRET)).toBeNull();
    expect(await verifySessionCookieValue('v1.a.b', SECRET)).toBeNull();
    expect(await verifySessionCookieValue('v2.user.123.sig', SECRET)).toBeNull();
  });
});

describe('parseCookies', () => {
  it('parses multiple cookies', () => {
    const cookies = parseCookies('a=1; rp_session=v1.u.9.sig; b=2');
    expect(cookies.get('rp_session')).toBe('v1.u.9.sig');
    expect(cookies.get('a')).toBe('1');
  });

  it('handles null header', () => {
    expect(parseCookies(null).size).toBe(0);
  });

  it('keeps = signs inside values', () => {
    expect(parseCookies('k=a=b=c').get('k')).toBe('a=b=c');
  });
});
