// Environment schema (spec 017 tech §4, FR-INF-005). Values come only from the environment; this file holds
// names, validation and safe defaults. Error messages name variables, never their values.
import { z } from 'zod';
import { jev } from './defaults';

const secret = z.string().min(32, 'must be at least 32 characters');
const csv = z
  .string()
  .default('')
  .transform((s) =>
    s
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean),
  );

export const publicEnvSchema = z.object({
  NEXT_PUBLIC_SITE_NAME: z.string().min(1).default('domains-all'),
  NEXT_PUBLIC_SITE_URL: z.url().default('http://localhost:3000'),
  NEXT_PUBLIC_SUPABASE_URL: z.url().optional(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().optional(),
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: z.string().optional(),
  NEXT_PUBLIC_CF_ANALYTICS_TOKEN: z.string().optional(),
});

export const serverEnvSchema = publicEnvSchema
  .extend({
    // Mock mode serves every external service from fixtures (spec 016 FR-QA-003). Safe default: on.
    MOCK_EXTERNALS: z.stringbool().default(true),
    EMAIL_MODE: z.enum(['off', 'on']).default('off'),
    ALERT_CHANNEL: z.enum(['email', 'chat']).default('email'),
    // 'off' is honoured only together with MOCK_EXTERNALS=1 (local end-to-end tests); production always enforces.
    RATE_LIMIT_MODE: z.enum(['enforce', 'off']).default('enforce'),
    // Free, keyless public data (DNS, RDAP, Porkbun prices, FX rates) is real even in mock mode so the public site
    // never shows a simulated "available" (P3); tests and CI use recorded fixtures (tasks/M4-verify.md decision 1).
    PUBLIC_DATA_MODE: z.enum(['live', 'fixture']).default('live'),

    SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
    SUPABASE_DB_URL: z.string().optional(),

    AI_GATEWAY_API_KEY: z.string().optional(),
    TYPESAFE_API_KEY: z.string().optional(),
    NGROK_AI_API_KEY: z.string().optional(),
    JEV_ROUTE: z.enum(['gateway', 'direct', 'ngrok']).default('gateway'),
    // FR-JEV-003: production uses a pinned version, never a moving alias such as "latest".
    JEV_MODEL: z
      .string()
      .regex(/^jev-\d+\.\d+\.\d+$/, 'must be a pinned version like jev-1.13.0')
      .default(jev.model),

    UPSTASH_REDIS_REST_URL: z.url().optional(),
    UPSTASH_REDIS_REST_TOKEN: z.string().optional(),
    TURNSTILE_SECRET_KEY: z.string().optional(),

    SEARCH_LINK_SECRET: secret.optional(),
    VISITOR_SALT_SECRET: secret.optional(),
    UNSUBSCRIBE_SECRET: secret.optional(),

    RESEND_API_KEY: z.string().optional(),
    RESEND_WEBHOOK_SECRET: z.string().optional(),
    EMAIL_FROM: z.email().optional(),
    BREVO_API_KEY: z.string().optional(),

    OWNER_ALERT_EMAIL: z.email().optional(),
    OWNER_USER_ID: z.uuid().optional(),
    ADMIN_USER_IDS: csv.pipe(z.array(z.uuid())),

    PORKBUN_API_KEY: z.string().optional(),
    PORKBUN_SECRET_KEY: z.string().optional(),
    NAMECOM_API_USER: z.string().optional(),
    NAMECOM_API_TOKEN: z.string().optional(),
    DYNADOT_API_KEY: z.string().optional(),
    PRICE_PROVIDERS: csv.pipe(z.array(z.string())).default(['porkbun-pricing']),
    PREMIUM_PROVIDERS: csv.pipe(z.array(z.string())),
    NRD_URL_TEMPLATE: z.string().optional(),

    SENTRY_DSN: z.url().optional(),
    SENTRY_AUTH_TOKEN: z.string().optional(),

    POLICY_VERSION: z.string().default('v1'),
    // Spec 013 FR-PRIV-007 (owner decision 2026-10-03).
    GRIEVANCE_NAME: z.string().default('Priyansh K'),
    GRIEVANCE_EMAIL: z.email().default('priyansh1210@gmail.com'),

    VERCEL_GIT_COMMIT_SHA: z.string().optional(),
  })
  .transform((env) => ({
    ...env,
    // Spec 011 tech §5.8: the admin list defaults to the owner.
    ADMIN_USER_IDS:
      env.ADMIN_USER_IDS.length > 0 ? env.ADMIN_USER_IDS : env.OWNER_USER_ID ? [env.OWNER_USER_ID] : [],
  }));

export type PublicEnv = z.infer<typeof publicEnvSchema>;
export type ServerEnv = z.infer<typeof serverEnvSchema>;
type Source = Record<string, string | undefined>;

export class EnvError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Invalid environment:\n  ${problems.join('\n  ')}`);
    this.name = 'EnvError';
  }
}

/** Hosting dashboards often store unset variables as empty strings; treat those as missing. */
function withoutEmpty(source: Source): Source {
  return Object.fromEntries(Object.entries(source).filter(([, v]) => v !== undefined && v.trim() !== ''));
}

function parse<S extends z.ZodType>(schema: S, source: Source): z.infer<S> {
  const result = schema.safeParse(withoutEmpty(source));
  if (!result.success) {
    throw new EnvError(result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`));
  }
  return result.data;
}

/**
 * Public variables must be read with literal `process.env.NEXT_PUBLIC_*` accesses so the bundler can inline
 * them into browser code.
 */
export function readPublicEnv(): PublicEnv {
  return parse(publicEnvSchema, {
    NEXT_PUBLIC_SITE_NAME: process.env.NEXT_PUBLIC_SITE_NAME,
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY,
    NEXT_PUBLIC_CF_ANALYTICS_TOKEN: process.env.NEXT_PUBLIC_CF_ANALYTICS_TOKEN,
  });
}

export function parseServerEnv(source: Source): ServerEnv {
  return parse(serverEnvSchema, source);
}

let cached: ServerEnv | undefined;

/** Server-only. Never import the result into browser code: it contains secrets. */
export function serverEnv(): ServerEnv {
  cached ??= parseServerEnv(process.env);
  return cached;
}

/** The Jev API key variable for the chosen route (spec 002 tech §5.2): name and value. */
export function jevKey(
  env: Pick<ServerEnv, 'JEV_ROUTE' | 'AI_GATEWAY_API_KEY' | 'TYPESAFE_API_KEY' | 'NGROK_AI_API_KEY'>,
): [string, string | undefined] {
  if (env.JEV_ROUTE === 'gateway') return ['AI_GATEWAY_API_KEY', env.AI_GATEWAY_API_KEY];
  if (env.JEV_ROUTE === 'ngrok') return ['NGROK_AI_API_KEY', env.NGROK_AI_API_KEY];
  return ['TYPESAFE_API_KEY', env.TYPESAFE_API_KEY];
}

/** Names of variables that live mode (MOCK_EXTERNALS=0) still needs. Used by /api/health and startup logs. */
export function missingForLive(env: ServerEnv): string[] {
  const required: Array<[string, unknown]> = [
    ['NEXT_PUBLIC_SUPABASE_URL', env.NEXT_PUBLIC_SUPABASE_URL],
    ['NEXT_PUBLIC_SUPABASE_ANON_KEY', env.NEXT_PUBLIC_SUPABASE_ANON_KEY],
    ['SUPABASE_SERVICE_ROLE_KEY', env.SUPABASE_SERVICE_ROLE_KEY],
    ['UPSTASH_REDIS_REST_URL', env.UPSTASH_REDIS_REST_URL],
    ['UPSTASH_REDIS_REST_TOKEN', env.UPSTASH_REDIS_REST_TOKEN],
    ['NEXT_PUBLIC_TURNSTILE_SITE_KEY', env.NEXT_PUBLIC_TURNSTILE_SITE_KEY],
    ['TURNSTILE_SECRET_KEY', env.TURNSTILE_SECRET_KEY],
    ['SEARCH_LINK_SECRET', env.SEARCH_LINK_SECRET],
    ['VISITOR_SALT_SECRET', env.VISITOR_SALT_SECRET],
    jevKey(env),
  ];
  if (env.EMAIL_MODE === 'on') {
    required.push(
      ['RESEND_API_KEY', env.RESEND_API_KEY],
      ['EMAIL_FROM', env.EMAIL_FROM],
      ['UNSUBSCRIBE_SECRET', env.UNSUBSCRIBE_SECRET],
    );
  }
  return required.filter(([, value]) => !value).map(([name]) => name);
}
