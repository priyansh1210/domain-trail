// Sessions (spec 011 tech §5.1, §5.5, §5.6; tasks/M5b-accounts.md decisions 1–3). Everything runs on the server: the
// browser never loads a sign-in library, it only follows redirects and calls our own routes. Supabase Auth keeps the
// session in httpOnly cookies; mock mode uses a signed cookie with fixed demo users so every flow can be tested
// without accounts.
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { createServerClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { CookieJar } from './cookies';

export type Provider = 'google' | 'github';
export const PROVIDERS: readonly Provider[] = ['google', 'github'];

export interface SessionUser {
  id: string;
  isAnonymous: boolean;
  email?: string;
  provider?: string;
}

export interface Auth {
  readonly kind: 'supabase' | 'mock';
  /** False when sign-in and saving are switched off (see services.ts). */
  readonly available: boolean;
  /** The signed-in (or anonymous) user of this request, or null. */
  user(): Promise<SessionUser | null>;
  /** Database client acting as this user (row-level security applies); null in mock mode. */
  client(): SupabaseClient | null;
  /** Where to send the browser to sign in; the provider returns to `callbackUrl` with a code. */
  signInUrl(provider: Provider, callbackUrl: string): Promise<string | null>;
  exchange(code: string): Promise<SessionUser | null>;
  /** Anonymous session for signed-out saving (spec 011 §5.6); Supabase checks the Turnstile token. */
  anonymous(captchaToken: string): Promise<SessionUser | null>;
  signOut(scope: 'local' | 'global'): Promise<void>;
}

const COOKIE_DAYS = 400;

// ----- mock provider (MOCK_EXTERNALS=1) -----

export const MOCK_SESSION_COOKIE = 'da_mock_session';
/** Test-only: sign in to the mock provider as this user id instead of the shared demo account. */
export const MOCK_AS_COOKIE = 'da_mock_as';
/** Fixed demo accounts; tests make the Google one the owner through ADMIN_USER_IDS. */
export const MOCK_USERS: Record<Provider, SessionUser> = {
  google: {
    id: '0190f5a8-0000-7000-8000-00000000a001',
    isAnonymous: false,
    email: 'demo.google@example.com',
    provider: 'google',
  },
  github: {
    id: '0190f5a8-0000-7000-8000-00000000a002',
    isAnonymous: false,
    email: 'demo.github@example.com',
    provider: 'github',
  },
};

const sign = (secret: string, payload: string) =>
  createHmac('sha256', secret).update(payload).digest('base64url').slice(0, 22);

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** `payload.signature` with an HMAC; used for the mock session and the "move my saved items" cookie. */
export function sealed(secret: string, value: unknown): string {
  const payload = Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${payload}.${sign(secret, payload)}`;
}

export function unseal<T>(secret: string, token: string | undefined): T | null {
  if (!token) return null;
  const dot = token.lastIndexOf('.');
  if (dot < 1) return null;
  const payload = token.slice(0, dot);
  if (!safeEqual(token.slice(dot + 1), sign(secret, payload))) return null;
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString()) as T;
  } catch {
    return null;
  }
}

export function mockAuth(jar: CookieJar, secret: string): Auth {
  const save = (u: SessionUser) =>
    jar.set(MOCK_SESSION_COOKIE, sealed(secret, u), { maxAge: COOKIE_DAYS * 86_400, sameSite: 'lax' });
  return {
    kind: 'mock',
    available: true,
    async user() {
      return unseal<SessionUser>(secret, jar.get(MOCK_SESSION_COOKIE));
    },
    client: () => null,
    async signInUrl(provider, callbackUrl) {
      const url = new URL(callbackUrl);
      url.searchParams.set('code', `mock-${provider}`);
      return url.toString();
    },
    async exchange(code) {
      const provider = code.replace(/^mock-/, '') as Provider;
      const base = MOCK_USERS[provider];
      if (!base) return null;
      // Tests that need their own account set `da_mock_as` to a uuid before signing in.
      const as = jar.get(MOCK_AS_COOKIE);
      const user =
        as && /^[0-9a-f-]{36}$/.test(as) ? { ...base, id: as, email: `${as.slice(-8)}@example.com` } : base;
      save(user);
      return user;
    },
    async anonymous() {
      const user = { id: randomUUID(), isAnonymous: true };
      save(user);
      return user;
    },
    async signOut() {
      jar.delete(MOCK_SESSION_COOKIE);
    },
  };
}

// ----- Supabase Auth -----

export function supabaseAuth(jar: CookieJar, url: string, anonKey: string): Auth {
  let client: SupabaseClient | undefined;
  const sb = () =>
    (client ??= createServerClient(url, anonKey, {
      cookies: {
        getAll: () => jar.getAll(),
        setAll: (list) => {
          for (const c of list) jar.set(c.name, c.value, { ...c.options, httpOnly: true, sameSite: 'lax' });
        },
      },
      cookieOptions: { path: '/', sameSite: 'lax', maxAge: COOKIE_DAYS * 86_400 },
    }) as unknown as SupabaseClient);
  const toUser = (u: {
    id: string;
    is_anonymous?: boolean;
    email?: string;
    app_metadata?: { provider?: string };
  }): SessionUser => ({
    id: u.id,
    isAnonymous: u.is_anonymous === true,
    ...(u.email ? { email: u.email } : {}),
    ...(u.app_metadata?.provider ? { provider: u.app_metadata.provider } : {}),
  });
  const hasSession = () => jar.getAll().some((c) => c.name.startsWith('sb-'));
  return {
    kind: 'supabase',
    available: true,
    async user() {
      if (!hasSession()) return null; // no cookie, no round trip
      const { data, error } = await sb().auth.getUser();
      return error || !data.user ? null : toUser(data.user);
    },
    client: () => sb(),
    async signInUrl(provider, callbackUrl) {
      const { data, error } = await sb().auth.signInWithOAuth({
        provider,
        options: { redirectTo: callbackUrl, skipBrowserRedirect: true },
      });
      return error ? null : (data.url ?? null);
    },
    async exchange(code) {
      const { data, error } = await sb().auth.exchangeCodeForSession(code);
      return error || !data.user ? null : toUser(data.user);
    },
    async anonymous(captchaToken) {
      const options = captchaToken && captchaToken !== 'none' ? { captchaToken } : undefined;
      const { data, error } = await sb().auth.signInAnonymously(options ? { options } : undefined);
      return error || !data.user ? null : toUser(data.user);
    },
    async signOut(scope) {
      await sb().auth.signOut({ scope });
    },
  };
}

// ----- request helpers -----

/**
 * CSRF guard for state-changing requests (spec 011 §9): a browser always sends `Origin` on such requests, and it
 * must be this site. Requests without `Origin` come from non-browser clients, which cannot carry a victim's cookies.
 */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get('origin');
  if (!origin) return true;
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? new URL(req.url).host;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** Only same-site paths may be used as the page to return to (no open redirects). */
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return '/';
  return next.length > 500 ? '/' : next;
}

/** Signed-out saver about to sign in: remembered for 15 minutes so the callback can move their items (decision 2). */
export const MERGE_COOKIE = 'da_anon_merge';
export const MERGE_MINUTES = 15;

export function rememberAnonymous(jar: CookieJar, secret: string, anonId: string, now = Date.now()): void {
  jar.set(MERGE_COOKIE, sealed(`merge:${secret}`, { id: anonId, until: now + MERGE_MINUTES * 60_000 }), {
    maxAge: MERGE_MINUTES * 60,
    sameSite: 'lax',
  });
}

export function takeAnonymous(jar: CookieJar, secret: string, now = Date.now()): string | null {
  const v = unseal<{ id: string; until: number }>(`merge:${secret}`, jar.get(MERGE_COOKIE));
  if (jar.get(MERGE_COOKIE)) jar.delete(MERGE_COOKIE);
  return v && v.until > now ? v.id : null;
}
