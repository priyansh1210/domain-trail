// One set of server-side services per instance. Mock mode (MOCK_EXTERNALS=1) or missing configuration uses
// in-process implementations so local development and previews work without accounts.
import {
  type Checker,
  createChecker,
  createDirectorySource,
  fixtureFetch,
  HostLimiter,
  MemoryAvailabilityCache,
} from '@domains-all/availability';
import { MemoryWordCache, rulesMockHint, type WordCache } from '@domains-all/core';
import { PIPELINE_VERSION, serverEnv, siteIdentity, type ServerEnv } from '@domains-all/config';
import { createFreeChecker, type FreeChecker } from '@domains-all/free-domains';
import { createPriceSource, type PriceSource } from '@domains-all/pricing';
import { createJev } from '@domains-all/jev';
import { log } from '@domains-all/log';
import {
  MemoryIdempotency,
  MemoryLimiter,
  UpstashIdempotency,
  UpstashLimiter,
  upstashRedis,
  verifyTurnstile,
  type HumanCheck,
  type Idempotency,
  type Limiter,
} from './limits';
import { type AccountStore, MemoryAccountStore, SupabaseAccountStore } from './accounts';
import { createBrandListSource } from './brand-list';
import type { CookieJar } from './cookies';
import { type Auth, mockAuth, supabaseAuth } from './session';
import {
  type FeedbackStore,
  MemoryFeedbackStore,
  MemorySearchStore,
  SupabaseAvailabilityCache,
  SupabaseFeedbackStore,
  SupabaseSearchStore,
  SupabaseUsageStore,
  SupabaseWordCache,
  supabaseAdmin,
  type SearchStore,
} from './store';

/** Only for MOCK_EXTERNALS=1; live mode refuses to run without real secrets. */
const DEV_SECRET = 'dev-only-secret-never-used-in-live-mode-000000';

export class NotConfiguredError extends Error {
  constructor(missing: string) {
    super(`not configured: ${missing}`);
  }
}

export interface Services {
  env: ServerEnv;
  jev: ReturnType<typeof createJev>;
  store: SearchStore;
  limiter: Limiter;
  idempotency: Idempotency;
  wordCache: WordCache;
  /** Availability checks (spec 005): real DNS/RDAP unless PUBLIC_DATA_MODE=fixture. */
  checker: Checker;
  freeChecker: FreeChecker;
  prices: PriceSource;
  /** Popular-site names loaded into the brand check (0 = curated seed only). */
  brandCount(): number;
  /** Publication date of the RDAP directory in use (health check). */
  rdapPublication(): string;
  /** When this instance last downloaded the RDAP directory (Status page), if it has. */
  rdapRefreshedAt(): string | undefined;
  /** Refreshes prices, FX, the RDAP directory and the popular-site list when due, waiting at most `maxWaitMs`
   *  (inside the request: the host freezes work left running after a response). */
  refreshPublicData(maxWaitMs: number): Promise<void>;
  feedback: FeedbackStore;
  limitsEnforced: boolean;
  verifyHuman(token: string, ip: string | undefined): Promise<HumanCheck>;
  /** Throws NotConfiguredError in live mode when a secret is missing. */
  secrets(): { searchLink: string; visitorSalt: string };
  /** The session of one request: Supabase Auth live, signed demo sessions in mock mode (spec 011 §5.1). */
  auth(jar: CookieJar): Auth;
  /** Saved items of that request's user (row-level security live; memory in mock mode). */
  accounts(auth: Auth): AccountStore;
  /** May this user open the owner pages (`/ops`, `/ops/saved`)? */
  isAdmin(userId: string): boolean;
}

/** Sign-in is off: live mode without a database, or mock mode without MOCK_SIGN_IN (the pages say so). */
const NO_AUTH: Auth = {
  kind: 'supabase',
  available: false,
  user: async () => null,
  client: () => null,
  signInUrl: async () => null,
  exchange: async () => null,
  anonymous: async () => null,
  signOut: async () => undefined,
};

export function buildServices(env: ServerEnv): Services {
  const live = !env.MOCK_EXTERNALS;
  const sb =
    live && env.NEXT_PUBLIC_SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY
      ? supabaseAdmin(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
      : null;
  const redis =
    live && env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN
      ? upstashRedis(env.UPSTASH_REDIS_REST_URL, env.UPSTASH_REDIS_REST_TOKEN)
      : null;

  // Free, keyless public data is real even in mock mode (tasks/M4-verify.md decision 1); tests use fixtures.
  const publicLive = env.PUBLIC_DATA_MODE === 'live';
  const fetchFn: typeof fetch = publicLive ? (input, init) => fetch(input, init) : fixtureFetch;
  const site = siteIdentity(env);
  // Honest user agent with a contact address for registry operators (spec 005 tech §5.2, §9).
  const userAgent = `${site.name.replace(/[^\w.-]/g, '')}/${PIPELINE_VERSION} (+${site.origin})`;

  const directory = createDirectorySource({ live: publicLive, fetchFn });
  // The daily price job's tables are public reference data, read with the public key even in mock mode
  // (tasks/M5-freshness.md decision 2); fixtures never touch a database.
  const database =
    publicLive && env.NEXT_PUBLIC_SUPABASE_URL && env.NEXT_PUBLIC_SUPABASE_ANON_KEY
      ? { url: env.NEXT_PUBLIC_SUPABASE_URL, anonKey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY }
      : undefined;
  const prices = createPriceSource({ live: publicLive, fetchFn, ...(database ? { database } : {}) });
  const brands = createBrandListSource(sb);
  const memoryAccounts = new MemoryAccountStore();
  const pickSecret = (name: 'SEARCH_LINK_SECRET' | 'VISITOR_SALT_SECRET') => {
    const v = env[name];
    if (v) return v;
    if (env.MOCK_EXTERNALS) return DEV_SECRET;
    throw new NotConfiguredError(name);
  };

  return {
    env,
    rdapPublication: () => directory.get().publication,
    rdapRefreshedAt: () => directory.refreshedAt(),
    async refreshPublicData(maxWaitMs) {
      await Promise.all([
        prices.ensureFresh(maxWaitMs),
        directory.ensureFresh(maxWaitMs),
        brands.ensureFresh(maxWaitMs),
      ]);
    },
    brandCount: () => brands.count(),
    checker: createChecker({
      directory,
      userAgent,
      cache: sb ? new SupabaseAvailabilityCache(sb) : new MemoryAvailabilityCache(),
      fetchFn,
      // Fixtures never touch a registry, so they need no request spacing.
      ...(publicLive ? {} : { limiter: new HostLimiter({ rps: 10_000, burst: 10_000, concurrency: 100 }) }),
    }),
    freeChecker: createFreeChecker({ live: publicLive, fetchFn }),
    prices,
    feedback: sb ? new SupabaseFeedbackStore(sb) : new MemoryFeedbackStore(),
    jev: createJev({ env, usageStore: sb ? new SupabaseUsageStore(sb) : undefined, mockHint: rulesMockHint }),
    store: sb ? new SupabaseSearchStore(sb) : new MemorySearchStore(),
    limiter: redis
      ? new UpstashLimiter(redis, (e) =>
          log.warn({ event: 'ratelimit.fallback', error: (e as Error).message }),
        )
      : new MemoryLimiter(live ? 0.5 : 1),
    idempotency: redis ? new UpstashIdempotency(redis) : new MemoryIdempotency(),
    wordCache: sb ? new SupabaseWordCache(sb) : new MemoryWordCache(),
    limitsEnforced: !(env.MOCK_EXTERNALS && env.RATE_LIMIT_MODE === 'off'),
    async verifyHuman(token, ip) {
      if (env.MOCK_EXTERNALS) return 'ok';
      if (!env.TURNSTILE_SECRET_KEY) return 'unavailable';
      return verifyTurnstile(token, ip, env.TURNSTILE_SECRET_KEY);
    },
    secrets() {
      return { searchLink: pickSecret('SEARCH_LINK_SECRET'), visitorSalt: pickSecret('VISITOR_SALT_SECRET') };
    },
    auth(jar) {
      if (!live) return env.MOCK_SIGN_IN ? mockAuth(jar, `session:${DEV_SECRET}`) : NO_AUTH;
      return env.NEXT_PUBLIC_SUPABASE_URL && env.NEXT_PUBLIC_SUPABASE_ANON_KEY
        ? supabaseAuth(jar, env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
        : NO_AUTH;
    },
    accounts(auth) {
      const userDb = auth.client();
      return sb && userDb ? new SupabaseAccountStore(userDb, sb) : memoryAccounts;
    },
    isAdmin: (userId) => env.ADMIN_USER_IDS.includes(userId),
  };
}

let instance: Services | undefined;
export function services(): Services {
  instance ??= buildServices(serverEnv());
  return instance;
}
