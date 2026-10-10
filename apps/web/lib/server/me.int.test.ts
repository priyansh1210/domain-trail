// Account routes with mock sign-in and the memory store (spec 011 tech §11: limits, anon-save, anon-merge,
// export-delete; FR-ACC-004, 005, 011, 012, 015, 017, 018, 019).
import { parseServerEnv } from '@domains-all/config';
import { describe, expect, it } from 'vitest';
import type { MemoryAccountStore } from './accounts';
import { handleCallback, handleSignIn } from './auth-routes';
import {
  handleAnonymous,
  handleExport,
  handleMeCreate,
  handleMeDelete,
  handleSavedAdd,
  handleSavedList,
  handleSession,
  handleWatchAdd,
  handleWatchList,
} from './me';
import { handleSearch } from './search';
import { buildServices, type Services } from './services';
import { MOCK_USERS } from './session';

const ORIGIN = 'http://localhost';

function svc(extra: Record<string, string> = {}): Services {
  return buildServices(
    parseServerEnv({ MOCK_SIGN_IN: '1', RATE_LIMIT_MODE: 'off', PUBLIC_DATA_MODE: 'fixture', ...extra }),
  );
}

/** A tiny browser: keeps cookies between requests. */
function browser() {
  const jar = new Map<string, string>();
  const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('; ');
  const keep = (res: Response) => {
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      const eq = pair!.indexOf('=');
      const name = pair!.slice(0, eq);
      const value = decodeURIComponent(pair!.slice(eq + 1));
      if (/Max-Age=0/.test(c) || value === '') jar.delete(name);
      else jar.set(name, value);
    }
    return res;
  };
  const req = (path: string, init: RequestInit = {}) =>
    new Request(`${ORIGIN}${path}`, {
      ...init,
      headers: {
        cookie: cookieHeader(),
        origin: ORIGIN,
        host: 'localhost',
        'content-type': 'application/json',
        ...(init.headers ?? {}),
      },
    });
  return { jar, keep, req };
}

async function searchRef(s: Services): Promise<string> {
  const res = await handleSearch(
    new Request(`${ORIGIN}/api/search`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        description: 'Online bakery in Pune delivering sourdough bread and cakes',
        turnstileToken: 'none',
        clientRequestId: crypto.randomUUID(),
      }),
    }),
    s,
  );
  const text = await res.text();
  return /"ref":"([^"]+)"/.exec(text)![1]!;
}

async function signIn(b: ReturnType<typeof browser>, s: Services, provider: 'google' | 'github' = 'google') {
  const start = b.keep(await handleSignIn(b.req(`/auth/sign-in?provider=${provider}&next=%2Faccount`), s));
  expect(start.status).toBe(303);
  const callback = new URL(start.headers.get('location')!);
  return b.keep(await handleCallback(b.req(callback.pathname + callback.search), s));
}

describe('sign-in', () => {
  it('sends a first sign-in through the terms page, then back to the page it started from', async () => {
    const s = svc();
    const b = browser();
    const done = await signIn(b, s);
    expect(done.headers.get('location')).toBe('/account/welcome?next=%2Faccount');
    const session = await (await handleSession(b.req('/api/me/session'), s)).json();
    expect(session).toMatchObject({ available: true, needsTerms: true, user: { isAnonymous: false } });
    expect(
      (await handleMeCreate(b.req('/api/me', { method: 'POST', body: '{"acceptTerms":true}' }), s)).status,
    ).toBe(400);
    const created = await handleMeCreate(
      b.req('/api/me', { method: 'POST', body: JSON.stringify({ acceptTerms: true, ageConfirmed: true }) }),
      s,
    );
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({ termsVersion: 'v1', alertFrequency: 'daily' });
    expect((await signIn(b, s)).headers.get('location')).toBe('/account'); // second time: straight back
  });

  it('is unavailable on a public mock site (no shared demo account)', async () => {
    const s = buildServices(parseServerEnv({ PUBLIC_DATA_MODE: 'fixture' }));
    const b = browser();
    expect(await (await handleSession(b.req('/api/me/session'), s)).json()).toMatchObject({
      available: false,
    });
    const res = await handleSignIn(b.req('/auth/sign-in?provider=google&next=%2F'), s);
    expect(res.headers.get('location')).toContain('error=unavailable');
  });

  it('rejects other origins', async () => {
    const s = svc();
    const b = browser();
    const res = await handleAnonymous(
      b.req('/api/me/anonymous', {
        method: 'POST',
        body: '{"turnstileToken":"x"}',
        headers: { origin: 'https://evil.example' },
      }),
      s,
    );
    expect(res.status).toBe(403);
  });
});

describe('saving while signed out (anonymous sessions)', () => {
  it('saves names and searches without a description, then moves them into the account on sign-in', async () => {
    const s = svc();
    const ref = await searchRef(s);
    const b = browser();
    expect(
      (
        await handleSavedAdd(
          b.req('/api/me/saved-searches', {
            method: 'POST',
            body: JSON.stringify({ searchRef: ref, title: 'x' }),
          }),
          s,
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await b.keep(
          await handleAnonymous(
            b.req('/api/me/anonymous', { method: 'POST', body: '{"turnstileToken":"none"}' }),
            s,
          ),
        )
      ).status,
    ).toBe(201);
    const withText = await handleSavedAdd(
      b.req('/api/me/saved-searches', {
        method: 'POST',
        body: JSON.stringify({
          searchRef: ref,
          title: 'Bakery',
          description: 'Online bakery in Pune delivering bread',
        }),
      }),
      s,
    );
    expect(withText.status).toBe(400); // P5: never a description for signed-out savers
    expect(
      (
        await handleSavedAdd(
          b.req('/api/me/saved-searches', {
            method: 'POST',
            body: JSON.stringify({ searchRef: ref, title: 'Bakery' }),
          }),
          s,
        )
      ).status,
    ).toBe(201);
    expect(
      (
        await handleWatchAdd(
          b.req('/api/me/watchlist', {
            method: 'POST',
            body: JSON.stringify({ fqdn: 'sunnycrust.shop', lastStatus: 'available' }),
          }),
          s,
        )
      ).status,
    ).toBe(201);

    // The owner admin view sees signed-out saves as "anon-…" (FR-ACC-020).
    const store = s.accounts(s.auth(new (await import('./cookies')).CookieJar(null))) as MemoryAccountStore;
    expect((await store.adminOverview()).accounts[0]!.label).toMatch(/^anon-/);

    await signIn(b, s);
    const list = await (await handleSavedList(b.req('/api/me/saved-searches'), s)).json();
    expect(list).toEqual([expect.objectContaining({ title: 'Bakery', searchRef: ref, description: null })]);
    expect(await (await handleWatchList(b.req('/api/me/watchlist'), s)).json()).toEqual([
      expect.objectContaining({ fqdn: 'sunnycrust.shop', lastStatus: 'available' }),
    ]);
    expect([...store.users.values()].filter((u) => u.user.isAnonymous)).toEqual([]); // anonymous user deleted
  });
});

describe('limits, export and delete', () => {
  it('stops at 20 saved searches and 100 names with a clear message (409)', async () => {
    const s = svc();
    const ref = await searchRef(s);
    const b = browser();
    await signIn(b, s, 'github');
    for (let i = 0; i < 20; i++)
      expect(
        (
          await handleSavedAdd(
            b.req('/api/me/saved-searches', {
              method: 'POST',
              body: JSON.stringify({ searchRef: ref, title: `s${i}` }),
            }),
            s,
          )
        ).status,
      ).toBe(201);
    const over = await handleSavedAdd(
      b.req('/api/me/saved-searches', {
        method: 'POST',
        body: JSON.stringify({ searchRef: ref, title: 'one more' }),
      }),
      s,
    );
    expect(over.status).toBe(409);
    expect((await over.json()).message).toMatch(/up to 20/);
    for (let i = 0; i < 100; i++)
      await handleWatchAdd(
        b.req('/api/me/watchlist', { method: 'POST', body: JSON.stringify({ fqdn: `n${i}.com` }) }),
        s,
      );
    expect(
      (
        await handleWatchAdd(
          b.req('/api/me/watchlist', { method: 'POST', body: JSON.stringify({ fqdn: 'n100.com' }) }),
          s,
        )
      ).status,
    ).toBe(409);
  });

  it('exports everything, and deleting removes the account and signs out', async () => {
    const s = svc();
    const b = browser();
    await signIn(b, s);
    await handleMeCreate(
      b.req('/api/me', { method: 'POST', body: JSON.stringify({ acceptTerms: true, ageConfirmed: true }) }),
      s,
    );
    await handleWatchAdd(
      b.req('/api/me/watchlist', { method: 'POST', body: JSON.stringify({ fqdn: 'quietfox.com' }) }),
      s,
    );
    const exp = await handleExport(b.req('/api/me/export'), s);
    expect(exp.headers.get('content-disposition')).toMatch(
      /attachment; filename="my-data-\d{4}-\d{2}-\d{2}\.json"/,
    );
    expect(await exp.json()).toMatchObject({
      account: { id: MOCK_USERS.google.id, email: MOCK_USERS.google.email },
      profile: { termsVersion: 'v1' },
      watchlist: [expect.objectContaining({ fqdn: 'quietfox.com' })],
    });
    expect(b.keep(await handleMeDelete(b.req('/api/me', { method: 'DELETE' }), s)).status).toBe(204);
    expect(await (await handleSession(b.req('/api/me/session'), s)).json()).toMatchObject({ user: null });
  });
});
