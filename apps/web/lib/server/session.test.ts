// Session helpers (spec 011 §5.1, §5.7, §9): cookies, sealed values, safe redirects, same-origin check, mock sign-in.
import { describe, expect, it } from 'vitest';
import { CookieJar, parseCookies, serializeCookie } from './cookies';
import {
  MOCK_USERS,
  mockAuth,
  rememberAnonymous,
  safeNext,
  sameOrigin,
  sealed,
  takeAnonymous,
  unseal,
} from './session';

describe('cookies', () => {
  it('parses and serializes with safe defaults', () => {
    expect(parseCookies('a=1; b=x%20y')).toEqual(
      new Map([
        ['a', '1'],
        ['b', 'x y'],
      ]),
    );
    expect(serializeCookie('s', 'v', { maxAge: 60, secure: true })).toBe(
      's=v; Path=/; Max-Age=60; HttpOnly; Secure; SameSite=Lax',
    );
  });

  it('collects Set-Cookie headers for the response', () => {
    const jar = new CookieJar('old=1');
    jar.set('new', '2');
    jar.delete('old');
    const res = jar.apply(new Response(null));
    expect(res.headers.getSetCookie()).toEqual([
      'new=2; Path=/; HttpOnly; SameSite=Lax',
      'old=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax',
    ]);
    expect(jar.get('old')).toBeUndefined();
  });
});

describe('sealed values', () => {
  it('round-trips and rejects tampering', () => {
    const token = sealed('k', { id: 'x' });
    expect(unseal('k', token)).toEqual({ id: 'x' });
    expect(unseal('other', token)).toBeNull();
    expect(unseal('k', `${token}x`)).toBeNull();
    expect(unseal('k', undefined)).toBeNull();
  });
});

describe('request guards', () => {
  it('only returns to pages on this site', () => {
    expect(safeNext('/s/abc?x=1')).toBe('/s/abc?x=1');
    for (const bad of ['https://evil.example', '//evil.example', '/\\evil.example', '', null, undefined])
      expect(safeNext(bad)).toBe('/');
  });

  it('rejects state changes from other origins', () => {
    const req = (origin?: string) =>
      new Request('https://site.example/api/me', {
        method: 'POST',
        headers: { host: 'site.example', ...(origin ? { origin } : {}) },
      });
    expect(sameOrigin(req('https://site.example'))).toBe(true);
    expect(sameOrigin(req())).toBe(true); // not a browser: no cookies of a victim
    expect(sameOrigin(req('https://evil.example'))).toBe(false);
  });

  it('remembers a signed-out saver for 15 minutes only', () => {
    const jar = new CookieJar(null);
    rememberAnonymous(jar, 's', 'anon-id', 0);
    const later = new CookieJar(`da_anon_merge=${encodeURIComponent(jar.get('da_anon_merge')!)}`);
    expect(takeAnonymous(later, 's', 60_000)).toBe('anon-id');
    const expired = new CookieJar(`da_anon_merge=${encodeURIComponent(jar.get('da_anon_merge')!)}`);
    expect(takeAnonymous(expired, 's', 16 * 60_000)).toBeNull();
  });
});

describe('mock sign-in', () => {
  it('signs in with the demo accounts and out again', async () => {
    const jar = new CookieJar(null);
    const auth = mockAuth(jar, 'secret');
    expect(await auth.user()).toBeNull();
    const url = await auth.signInUrl('github', 'http://localhost/auth/callback?next=%2Fx');
    expect(url).toBe('http://localhost/auth/callback?next=%2Fx&code=mock-github');
    expect(await auth.exchange('mock-github')).toEqual(MOCK_USERS.github);
    expect(await mockAuth(jar, 'secret').user()).toEqual(MOCK_USERS.github);
    expect(await mockAuth(jar, 'other-secret').user()).toBeNull(); // forged cookies do not work
    await auth.signOut('global');
    expect(await auth.user()).toBeNull();
  });

  it('creates a separate anonymous user per browser', async () => {
    const a = await mockAuth(new CookieJar(null), 's').anonymous('none');
    const b = await mockAuth(new CookieJar(null), 's').anonymous('none');
    expect(a?.isAnonymous).toBe(true);
    expect(a?.id).not.toBe(b?.id);
  });
});
