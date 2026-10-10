// /api/me/* (spec 011 tech §4, OpenAPI tag `account`): profile and settings, saved searches, watchlist,
// notifications, export and deletion. Saved items also work for anonymous sessions (signed-out saving, §5.6).
import { accounts as limits } from '@domains-all/config/defaults';
import { parseSearchRef, searchRef } from '@domains-all/core';
import { log } from '@domains-all/log';
import * as z from 'zod/mini';
import { type AccountStore, DescriptionNotAllowed, LimitError } from './accounts';
import { CookieJar } from './cookies';
import type { Services } from './services';
import { type Auth, MOCK_SESSION_COOKIE, sameOrigin, type SessionUser } from './session';
import { readLimited } from './sse';
import { clientIp, visitorHash } from './visitor';

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { 'cache-control': 'private, no-store', ...headers } });

const UNAUTHORIZED = { error: 'unauthorized', message: 'Please sign in.' };

/** Saved searches stay viewable this long after saving (tasks/M5b-accounts.md decision 5). */
const KEEP_DAYS = 400;

interface Ctx {
  jar: CookieJar;
  auth: Auth;
  user: SessionUser;
  store: AccountStore;
}

/** Session, or the error response to send. Anonymous sessions are allowed only where `anonymous` is true. */
async function session(
  req: Request,
  svc: Services,
  opts: { anonymous: boolean; write?: boolean },
): Promise<Ctx | Response> {
  if (opts.write && !sameOrigin(req)) return json(403, { error: 'forbidden', message: 'Wrong origin.' });
  const jar = CookieJar.from(req);
  const auth = svc.auth(jar);
  const user = await auth.user().catch(() => null);
  if (!user || (user.isAnonymous && !opts.anonymous)) return jar.apply(json(401, UNAUTHORIZED));
  return { jar, auth, user, store: svc.accounts(auth) };
}

async function body<T>(req: Request, schema: z.ZodMiniType<T>): Promise<T | Response> {
  const raw = await readLimited(req, 8 * 1024);
  if (raw === null) return json(413, { error: 'too_large' });
  let parsed: unknown;
  try {
    parsed = raw ? JSON.parse(raw) : {};
  } catch {
    return json(400, { error: 'validation', message: 'Invalid JSON.' });
  }
  const r = schema.safeParse(parsed);
  return r.success ? r.data : json(400, { error: 'validation', message: 'Please check the form.' });
}

const failed = (e: unknown, what: string) => {
  log.error({ event: 'me.failed', what, error: (e as Error).message });
  return json(500, { error: 'internal', message: 'Something went wrong. Please try again.' });
};

// ----- session summary (header, results page) -----

export async function handleSession(req: Request, svc: Services): Promise<Response> {
  const jar = CookieJar.from(req);
  const auth = svc.auth(jar);
  const user = auth.available ? await auth.user().catch(() => null) : null;
  let needsTerms = false;
  if (user && !user.isAnonymous)
    needsTerms = !(await svc
      .accounts(auth)
      .profile(user)
      .catch(() => null));
  return jar.apply(
    json(200, {
      available: auth.available,
      user: user
        ? { isAnonymous: user.isAnonymous, email: user.email ?? null, provider: user.provider ?? null }
        : null,
      needsTerms,
      isAdmin: !!user && !user.isAnonymous && svc.isAdmin(user.id),
    }),
  );
}

// ----- profile -----

const profileBody = (p: NonNullable<Awaited<ReturnType<AccountStore['profile']>>>, user: SessionUser) => ({
  userId: p.userId,
  email: user.email ?? null,
  provider: user.provider ?? null,
  displayName: p.displayName,
  alertsEnabled: p.alertsFrequency !== 'off',
  alertFrequency: p.alertsFrequency,
  currency: p.currency,
  termsVersion: p.termsVersion,
  createdAt: p.createdAt,
});

export async function handleMeGet(req: Request, svc: Services): Promise<Response> {
  const c = await session(req, svc, { anonymous: false });
  if (c instanceof Response) return c;
  const p = await c.store.profile(c.user).catch(() => null);
  return c.jar.apply(p ? json(200, profileBody(p, c.user)) : json(404, { error: 'needs_terms' }));
}

const AcceptSchema = z.object({ acceptTerms: z.literal(true), ageConfirmed: z.literal(true) });

/** First sign-in: terms, privacy and 18+ (FR-ACC-015, FR-PRIV-008). */
export async function handleMeCreate(req: Request, svc: Services): Promise<Response> {
  const c = await session(req, svc, { anonymous: false, write: true });
  if (c instanceof Response) return c;
  const b = await body(req, AcceptSchema);
  if (b instanceof Response) return b;
  try {
    const p = await c.store.createProfile(c.user, svc.env.POLICY_VERSION);
    return c.jar.apply(json(201, profileBody(p, c.user)));
  } catch (e) {
    return failed(e, 'profile.create');
  }
}

const UpdateSchema = z.object({
  displayName: z.optional(z.nullable(z.string().check(z.maxLength(60)))),
  alertFrequency: z.optional(z.enum(['daily', 'weekly', 'off'])),
  alertsEnabled: z.optional(z.boolean()),
  currency: z.optional(z.string().check(z.regex(/^[A-Z]{3}$/))),
});

export async function handleMePatch(req: Request, svc: Services): Promise<Response> {
  const c = await session(req, svc, { anonymous: false, write: true });
  if (c instanceof Response) return c;
  const b = await body(req, UpdateSchema);
  if (b instanceof Response) return b;
  const alertsFrequency = b.alertsEnabled === false ? 'off' : b.alertFrequency;
  try {
    const p = await c.store.updateProfile(c.user, {
      ...(b.displayName !== undefined ? { displayName: b.displayName } : {}),
      ...(alertsFrequency ? { alertsFrequency } : {}),
      ...(b.currency ? { currency: b.currency } : {}),
    });
    return c.jar.apply(p ? json(200, profileBody(p, c.user)) : json(404, { error: 'needs_terms' }));
  } catch (e) {
    return failed(e, 'profile.update');
  }
}

/** Clears every session cookie we may have set (after deletion or sign-out). */
function clearSession(jar: CookieJar) {
  for (const { name } of jar.getAll())
    if (name.startsWith('sb-') || name === MOCK_SESSION_COOKIE) jar.delete(name);
}

/** Delete the account, or a signed-out saver's items (FR-ACC-012, FR-ACC-019). */
export async function handleMeDelete(req: Request, svc: Services): Promise<Response> {
  const c = await session(req, svc, { anonymous: true, write: true });
  if (c instanceof Response) return c;
  try {
    await c.store.deleteUser(c.user.id);
  } catch (e) {
    return failed(e, 'delete');
  }
  log.info({ event: 'account.deleted', anonymous: c.user.isAnonymous });
  clearSession(c.jar);
  return c.jar.apply(new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } }));
}

// ----- signed-out saving: anonymous session on first save (spec 011 §5.6) -----

const AnonSchema = z.object({ turnstileToken: z.string().check(z.minLength(1), z.maxLength(4096)) });

export async function handleAnonymous(req: Request, svc: Services): Promise<Response> {
  if (!sameOrigin(req)) return json(403, { error: 'forbidden' });
  const jar = CookieJar.from(req);
  const auth = svc.auth(jar);
  if (!auth.available) return json(503, { error: 'unavailable', message: 'Saving is not available yet.' });
  const existing = await auth.user().catch(() => null);
  if (existing) return jar.apply(json(200, { isAnonymous: existing.isAnonymous }));
  const b = await body(req, AnonSchema);
  if (b instanceof Response) return b;
  if (svc.limitsEnforced) {
    try {
      const visitor = visitorHash(
        clientIp(req.headers),
        req.headers.get('user-agent') ?? '',
        svc.secrets().visitorSalt,
      );
      const r = await svc.limiter.check('session', visitor, 'anonymous', 1);
      if (!r.ok) return json(429, { error: 'rate_limited', retryAfterSec: r.retryAfterSec });
    } catch {
      return json(503, { error: 'not_configured' });
    }
  }
  // The sign-in service checks the Turnstile token itself (single use, so we must not check it first).
  const user = await auth.anonymous(b.turnstileToken).catch(() => null);
  if (!user) return jar.apply(json(403, { error: 'human_check_failed', message: 'Please try again.' }));
  await svc
    .accounts(auth)
    .touchAnonymous(user)
    .catch(() => undefined);
  return jar.apply(json(201, { isAnonymous: true }));
}

// ----- saved searches -----

const SaveSchema = z.object({
  searchRef: z.string().check(z.maxLength(64)),
  title: z.string().check(z.minLength(1), z.maxLength(80)),
  description: z.optional(z.string().check(z.minLength(20), z.maxLength(2000))),
  alertsEnabled: z._default(z.boolean(), true),
});

export async function handleSavedList(req: Request, svc: Services): Promise<Response> {
  const c = await session(req, svc, { anonymous: true });
  if (c instanceof Response) return c;
  const secret = svc.secrets().searchLink;
  await c.store.touchAnonymous(c.user).catch(() => undefined);
  const list = await c.store.savedSearches(c.user);
  return c.jar.apply(
    json(
      200,
      list.map((s) => ({
        id: s.id,
        title: s.title,
        description: s.description,
        preferences: s.preferences,
        searchRef: s.searchId ? searchRef(s.searchId, secret) : null,
        alertsEnabled: s.alertsEnabled,
        lastCheckedAt: s.lastCheckedAt,
        createdAt: s.createdAt,
      })),
    ),
  );
}

export async function handleSavedAdd(req: Request, svc: Services): Promise<Response> {
  const c = await session(req, svc, { anonymous: true, write: true });
  if (c instanceof Response) return c;
  const b = await body(req, SaveSchema);
  if (b instanceof Response) return b;
  if (c.user.isAnonymous && b.description)
    return json(400, { error: 'description_not_allowed', message: 'Sign in to save the description too.' });
  const id = parseSearchRef(b.searchRef, svc.secrets().searchLink);
  const rec = id ? await svc.store.getSearch(id).catch(() => null) : null;
  if (!id || !rec) return json(404, { error: 'not_found', message: 'These results have expired.' });
  try {
    const saved = await c.store.addSavedSearch(c.user, {
      title: b.title,
      description: b.description ?? null,
      preferences: rec.prefs ?? {},
      searchId: id,
      alertsEnabled: b.alertsEnabled,
    });
    await svc.store
      .keep(id, new Date(Date.now() + KEEP_DAYS * 86_400_000).toISOString())
      .catch(() => undefined);
    log.info({ event: 'saved_search.added', anonymous: c.user.isAnonymous });
    return c.jar.apply(
      json(201, { id: saved.id, title: saved.title, searchRef: b.searchRef, createdAt: saved.createdAt }),
    );
  } catch (e) {
    if (e instanceof LimitError)
      return json(409, {
        error: 'limit_reached',
        message: `You can save up to ${limits.savedSearchesMax} searches. Remove one to save another.`,
      });
    if (e instanceof DescriptionNotAllowed) return json(400, { error: 'description_not_allowed' });
    return failed(e, 'saved.add');
  }
}

export async function handleSavedDelete(req: Request, svc: Services, id: string): Promise<Response> {
  const c = await session(req, svc, { anonymous: true, write: true });
  if (c instanceof Response) return c;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json(400, { error: 'validation' });
  await c.store.removeSavedSearch(c.user, id);
  return c.jar.apply(new Response(null, { status: 204 }));
}

// ----- watchlist -----

const FQDN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9-]{2,63}){1,2}$/;
const STATUS = z.enum([
  'available',
  'likely_available',
  'available_premium',
  'taken',
  'dropping_soon',
  'unknown',
]);
const WatchSchema = z.object({
  fqdn: z.string().check(z.maxLength(253), z.regex(FQDN)),
  notifyOn: z._default(z.array(z.enum(['status_change', 'price_change'])).check(z.maxLength(2)), [
    'status_change',
  ]),
  lastStatus: z.optional(STATUS),
  lastUpfrontUsdCents: z.optional(z.int().check(z.minimum(0), z.maximum(100_000_000))),
});

const watchBody = (w: Awaited<ReturnType<AccountStore['watchlist']>>[number]) => ({
  fqdn: w.fqdn,
  lastStatus: w.lastStatus,
  lastUpfrontUsdCents: w.lastUpfrontCents,
  lastCheckedAt: w.lastCheckedAt,
  notifyOn: w.notifyOn,
  addedAt: w.addedAt,
});

export async function handleWatchList(req: Request, svc: Services): Promise<Response> {
  const c = await session(req, svc, { anonymous: true });
  if (c instanceof Response) return c;
  return c.jar.apply(json(200, (await c.store.watchlist(c.user)).map(watchBody)));
}

export async function handleWatchAdd(req: Request, svc: Services): Promise<Response> {
  const c = await session(req, svc, { anonymous: true, write: true });
  if (c instanceof Response) return c;
  const b = await body(req, WatchSchema);
  if (b instanceof Response) return b;
  try {
    const w = await c.store.watch(c.user, {
      fqdn: b.fqdn,
      notifyOn: b.notifyOn,
      lastStatus: b.lastStatus ?? null,
      lastUpfrontCents: b.lastUpfrontUsdCents ?? null,
    });
    return c.jar.apply(json(201, watchBody(w)));
  } catch (e) {
    if (e instanceof LimitError)
      return json(409, {
        error: 'limit_reached',
        message: `You can watch up to ${limits.watchlistMax} names. Remove one to watch another.`,
      });
    return failed(e, 'watch.add');
  }
}

export async function handleWatchDelete(req: Request, svc: Services, rawFqdn: string): Promise<Response> {
  const c = await session(req, svc, { anonymous: true, write: true });
  if (c instanceof Response) return c;
  const fqdn = decodeURIComponent(rawFqdn).toLowerCase();
  if (!FQDN.test(fqdn)) return json(400, { error: 'validation' });
  await c.store.unwatch(c.user, fqdn);
  return c.jar.apply(new Response(null, { status: 204 }));
}

// ----- notifications (in-app alerts, FR-ACC-008) -----

export async function handleNotifications(req: Request, svc: Services): Promise<Response> {
  const c = await session(req, svc, { anonymous: false });
  if (c instanceof Response) return c;
  return c.jar.apply(json(200, await c.store.notifications(c.user, limits.notificationListDays)));
}

export async function handleNotificationsRead(req: Request, svc: Services): Promise<Response> {
  const c = await session(req, svc, { anonymous: false, write: true });
  if (c instanceof Response) return c;
  await c.store.markRead(c.user);
  return c.jar.apply(new Response(null, { status: 204 }));
}

// ----- export (FR-ACC-011) -----

export async function handleExport(req: Request, svc: Services): Promise<Response> {
  const c = await session(req, svc, { anonymous: true });
  if (c instanceof Response) return c;
  const [profile, savedSearches, watchlist, notifications] = await Promise.all([
    c.user.isAnonymous ? null : c.store.profile(c.user),
    c.store.savedSearches(c.user),
    c.store.watchlist(c.user),
    c.user.isAnonymous ? [] : c.store.notifications(c.user, 3650),
  ]);
  const day = new Date().toISOString().slice(0, 10);
  const file = {
    exportedAt: new Date().toISOString(),
    account: {
      id: c.user.id,
      anonymous: c.user.isAnonymous,
      email: c.user.email ?? null,
      signInProvider: c.user.provider ?? null,
    },
    profile,
    savedSearches,
    watchlist,
    notifications,
  };
  return c.jar.apply(
    json(200, file, { 'content-disposition': `attachment; filename="my-data-${day}.json"` }),
  );
}
