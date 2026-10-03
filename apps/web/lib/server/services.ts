// One set of server-side services per instance. Mock mode (MOCK_EXTERNALS=1) or missing configuration uses
// in-process implementations so local development and previews work without accounts.
import { rulesMockHint } from '@domains-all/core';
import { serverEnv, type ServerEnv } from '@domains-all/config';
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
import {
  MemorySearchStore,
  SupabaseSearchStore,
  SupabaseUsageStore,
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
  limitsEnforced: boolean;
  verifyHuman(token: string, ip: string | undefined): Promise<HumanCheck>;
  /** Throws NotConfiguredError in live mode when a secret is missing. */
  secrets(): { searchLink: string; visitorSalt: string };
}

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

  return {
    env,
    jev: createJev({ env, usageStore: sb ? new SupabaseUsageStore(sb) : undefined, mockHint: rulesMockHint }),
    store: sb ? new SupabaseSearchStore(sb) : new MemorySearchStore(),
    limiter: redis
      ? new UpstashLimiter(redis, (e) =>
          log.warn({ event: 'ratelimit.fallback', error: (e as Error).message }),
        )
      : new MemoryLimiter(live ? 0.5 : 1),
    idempotency: redis ? new UpstashIdempotency(redis) : new MemoryIdempotency(),
    limitsEnforced: !(env.MOCK_EXTERNALS && env.RATE_LIMIT_MODE === 'off'),
    async verifyHuman(token, ip) {
      if (env.MOCK_EXTERNALS) return 'ok';
      if (!env.TURNSTILE_SECRET_KEY) return 'unavailable';
      return verifyTurnstile(token, ip, env.TURNSTILE_SECRET_KEY);
    },
    secrets() {
      const pick = (name: 'SEARCH_LINK_SECRET' | 'VISITOR_SALT_SECRET') => {
        const v = env[name];
        if (v) return v;
        if (env.MOCK_EXTERNALS) return DEV_SECRET;
        throw new NotConfiguredError(name);
      };
      return { searchLink: pick('SEARCH_LINK_SECRET'), visitorSalt: pick('VISITOR_SALT_SECRET') };
    },
  };
}

let instance: Services | undefined;
export function services(): Services {
  instance ??= buildServices(serverEnv());
  return instance;
}
