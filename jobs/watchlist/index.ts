// Daily watchlist and saved-search re-checks (spec 011 tech §5.2–5.3; FR-ACC-006, 007, 008, FR-REF-008). Watched
// names and the top 10 results of saved searches with alerts on are checked again; a change becomes an in-app
// notification: registered, available again, or an upfront price change of 10 % or more. Signed-out savers are
// skipped (no alert channel). Digest e-mails are sent only with EMAIL_MODE=on (off: owner decision 2026-10-03).
import {
  type CheckResult,
  createChecker,
  createDirectorySource,
  MemoryAvailabilityCache,
  REGISTRABLE,
  splitFqdn,
} from '@domains-all/availability';
import { siteIdentity } from '@domains-all/config';
import { accounts as limits, budgets } from '@domains-all/config/defaults';
import { buildDigest, type DigestItem, sendDigest, sendingOrder, unsubscribeToken } from '@domains-all/email';
import { PORKBUN, policyFor, type PriceBook, priceFor, type TldPrice } from '@domains-all/pricing';
import { chunks, json, type Db } from '../_lib/db';
import { userAgent } from '../_lib/fetch';
import type { JobContext, JobDefinition } from '../_lib/run';

/** Sign-in e-mails need some of the daily e-mail allowance too (spec 011 §5.3: AUTH_EMAIL_RESERVE). */
const AUTH_EMAIL_RESERVE = 20;

/** Digest e-mails (EMAIL_MODE=on only): one per user per day, or Mondays for weekly; urgent ones first. */
export async function sendDigests(ctx: JobContext): Promise<{ emailed: number; deferred: number }> {
  const { RESEND_API_KEY: apiKey, EMAIL_FROM: from, UNSUBSCRIBE_SECRET: secret } = ctx.env;
  if (!apiKey || !from || !secret)
    throw new Error('EMAIL_MODE=on needs RESEND_API_KEY, EMAIL_FROM and UNSUBSCRIBE_SECRET');
  const rows = await ctx.db.query<{
    id: string;
    user_id: string;
    kind: DigestItem['kind'];
    fqdn: string;
    email: string;
  }>(
    `select n.id::text, n.user_id::text, n.kind, n.fqdn, u.email
     from public.notifications n
     join public.profiles p on p.user_id = n.user_id
     join auth.users u on u.id = n.user_id
     where n.emailed_at is null and u.email is not null and p.email_status = 'ok'
       and (p.alerts_frequency = 'daily' or (p.alerts_frequency = 'weekly' and $1::boolean))`,
    [ctx.now.getUTCDay() === 1],
  );
  const byUser = new Map<string, { userId: string; email: string; ids: string[]; items: DigestItem[] }>();
  for (const r of rows) {
    const u = byUser.get(r.user_id) ?? { userId: r.user_id, email: r.email, ids: [], items: [] };
    u.ids.push(r.id);
    u.items.push({ kind: r.kind, fqdn: r.fqdn });
    byUser.set(r.user_id, u);
  }
  const [log] = await ctx.db.query<{ sent: number }>(
    `select coalesce(sum(sent), 0)::int as sent from public.email_log where day = current_date and provider = 'resend'`,
  );
  let capacity = budgets.emailsPerDay - (log?.sent ?? 0) - AUTH_EMAIL_RESERVE;
  const site = siteIdentity(ctx.env);
  let emailed = 0;
  const users = sendingOrder([...byUser.values()]);
  for (const u of users) {
    if (capacity <= 0) break;
    const url = `${site.origin}/api/unsubscribe?token=${encodeURIComponent(unsubscribeToken(u.userId, secret))}`;
    if (ctx.dryRun) continue;
    const out = await sendDigest(
      { apiKey, from, fetchFn: ctx.fetch },
      u.email,
      buildDigest(site, u.items, url),
      url,
    );
    if (out !== 'sent') continue;
    capacity--;
    emailed++;
    await ctx.db.query(
      `update public.notifications set emailed_at = now() where id = any($1::text::bigint[])`,
      [`{${u.ids.join(',')}}`],
    );
    await ctx.db.query(
      `insert into public.email_log (day, provider, sent) values (current_date, 'resend', 1)
       on conflict (day, provider) do update set sent = public.email_log.sent + 1`,
    );
  }
  return { emailed, deferred: users.length - emailed };
}

/** At most this many names a day (spec 011 §10: ≤ 5,000 registry look-ups for this job). */
export const MAX_CHECKS = 5000;
const BATCH = 100; // the checker caps registry look-ups per call

type Kind = 'registered' | 'available' | 'price_change';

/** What changed between the last known and the new answer (spec 011 §5.2). */
export function changes(
  before: { status: string | null; upfrontCents: number | null },
  after: { status: string; upfrontCents: number | null },
  watchPrice: boolean,
): Kind[] {
  const out: Kind[] = [];
  if (after.status === 'unknown' || before.status === null) return out; // no answer, or no baseline yet
  const wasFree = REGISTRABLE.has(before.status as CheckResult['status']);
  const isFree = REGISTRABLE.has(after.status as CheckResult['status']);
  if (wasFree && after.status === 'taken') out.push('registered');
  if (!wasFree && isFree) out.push('available');
  if (
    watchPrice &&
    isFree &&
    before.upfrontCents &&
    after.upfrontCents !== null &&
    Math.abs(after.upfrontCents - before.upfrontCents) / before.upfrontCents >= limits.priceChangeAlertRatio
  )
    out.push('price_change');
  return out;
}

async function priceBook(db: Db): Promise<PriceBook> {
  const rows = await db.query<{
    tld: string;
    register_cents: number;
    renew_cents: number;
    fetched_at: string;
  }>(
    `select tld, register_cents, renew_cents, fetched_at::text from public.tld_prices
     where provider = $1 and register_cents is not null and renew_cents is not null`,
    [PORKBUN.id],
  );
  const prices = new Map<string, TldPrice>(
    rows.map((r) => [r.tld, { registerCents: r.register_cents, renewCents: r.renew_cents }]),
  );
  return {
    provider: PORKBUN,
    prices,
    fx: { base: 'USD', asOf: '', rates: { USD: 1 } },
    pricesAt: rows[0]?.fetched_at ?? new Date(0).toISOString(),
    policyFor,
  };
}

export const watchlist: JobDefinition = {
  name: 'watchlist',
  async run(ctx) {
    const watched = await ctx.db.query<{
      user_id: string;
      fqdn: string;
      notify_on: string[];
      last_status: string | null;
      last_upfront_cents: number | null;
    }>(
      `select w.user_id::text, w.fqdn, w.notify_on, w.last_status::text, w.last_upfront_cents
       from public.watchlist w join auth.users u on u.id = w.user_id
       where not coalesce(u.is_anonymous, false)`,
    );
    const saved = await ctx.db.query<{
      user_id: string;
      saved_id: string;
      search_id: string;
      fqdn: string;
      status: string;
      upfront_cents: number | null;
    }>(
      `select * from (
         select s.user_id::text, s.id::text as saved_id, s.search_id::text, r.fqdn, r.status, r.upfront_cents,
                row_number() over (partition by s.id order by r.score desc, r.fqdn) as n
         from public.saved_searches s
         join auth.users u on u.id = s.user_id and not coalesce(u.is_anonymous, false)
         join public.search_results r on r.search_id = s.search_id and r.section <> 'free'
         where s.alerts_enabled
       ) x where n <= 10`,
    );

    const fqdns = [...new Set([...watched.map((w) => w.fqdn), ...saved.map((s) => s.fqdn)])].slice(
      0,
      MAX_CHECKS,
    );
    const checker = createChecker({
      directory: createDirectorySource({ live: !ctx.dryRun, fetchFn: ctx.fetch }),
      userAgent: userAgent(ctx),
      cache: new MemoryAvailabilityCache(),
      fetchFn: ctx.fetch,
    });
    const answers = new Map<string, CheckResult>();
    for (const part of chunks(fqdns, BATCH)) {
      const { results } = await checker.checkMany(part, { deadline: Date.now() + 60_000, force: true });
      for (const r of results) answers.set(r.fqdn, r);
    }
    const book = await priceBook(ctx.db);
    const upfront = (fqdn: string, status: string) => {
      if (!REGISTRABLE.has(status as CheckResult['status'])) return null;
      const { label, tld } = splitFqdn(fqdn);
      const p = priceFor({ label, tld, status: status as CheckResult['status'] }, book);
      return p.priced ? p.upfrontUsdCents : null;
    };

    const notes: Array<{ user_id: string; kind: Kind; fqdn: string; payload: Record<string, unknown> }> = [];
    const watchUpdates: Array<{ user_id: string; fqdn: string; status: string; upfront: number | null }> = [];
    for (const w of watched) {
      const a = answers.get(w.fqdn);
      if (!a || a.status === 'unknown') continue;
      const cents = upfront(w.fqdn, a.status);
      for (const kind of changes(
        { status: w.last_status, upfrontCents: w.last_upfront_cents },
        { status: a.status, upfrontCents: cents },
        w.notify_on.includes('price_change'),
      ))
        notes.push({
          user_id: w.user_id,
          kind,
          fqdn: w.fqdn,
          payload:
            kind === 'price_change'
              ? { fromCents: w.last_upfront_cents, toCents: cents }
              : { source: 'watchlist' },
        });
      watchUpdates.push({ user_id: w.user_id, fqdn: w.fqdn, status: a.status, upfront: cents });
    }
    const resultUpdates: Array<{ search_id: string; fqdn: string; status: string; upfront: number | null }> =
      [];
    for (const s of saved) {
      const a = answers.get(s.fqdn);
      if (!a || a.status === 'unknown') continue;
      const cents = upfront(s.fqdn, a.status) ?? s.upfront_cents;
      for (const kind of changes(
        { status: s.status, upfrontCents: s.upfront_cents },
        { status: a.status, upfrontCents: cents },
        true,
      ))
        notes.push({
          user_id: s.user_id,
          kind,
          fqdn: s.fqdn,
          payload: { source: 'saved_search', savedSearchId: s.saved_id },
        });
      resultUpdates.push({ search_id: s.search_id, fqdn: s.fqdn, status: a.status, upfront: cents });
    }

    let created = 0;
    await ctx.db.tx(async (t) => {
      // One notification per user, name and kind a day, however many saved searches contain the name.
      const inserted = await t.query(
        `insert into public.notifications (user_id, kind, fqdn, payload)
         select distinct on (n.user_id, n.kind, n.fqdn) n.user_id::uuid, n.kind, n.fqdn, n.payload
         from jsonb_to_recordset($1::text::jsonb) as n(user_id text, kind text, fqdn text, payload jsonb)
         where not exists (select 1 from public.notifications x where x.user_id = n.user_id::uuid
                             and x.fqdn = n.fqdn and x.kind = n.kind and x.created_at > now() - interval '20 hours')
         returning id`,
        [json(notes)],
      );
      created = inserted.length;
      await t.query(
        `update public.watchlist w set last_status = u.status::public.check_status, last_upfront_cents = u.upfront,
           last_checked_at = now()
         from jsonb_to_recordset($1::text::jsonb) as u(user_id text, fqdn text, status text, upfront int)
         where w.user_id = u.user_id::uuid and w.fqdn = u.fqdn`,
        [json(watchUpdates)],
      );
      await t.query(
        `update public.search_results r set status = u.status, upfront_cents = coalesce(u.upfront, r.upfront_cents)
         from jsonb_to_recordset($1::text::jsonb) as u(search_id text, fqdn text, status text, upfront int)
         where r.search_id = u.search_id::uuid and r.fqdn = u.fqdn`,
        [json(resultUpdates)],
      );
      await t.query(
        `update public.saved_searches set last_checked_at = now()
         where id in (select (jsonb_array_elements_text($1::text::jsonb))::uuid)`,
        [json([...new Set(saved.map((s) => s.saved_id))])],
      );
    });
    // In-app notifications are the alert channel; e-mail only once the owner switches it on (FR-ACC-008).
    const mail = ctx.env.EMAIL_MODE === 'on' ? await sendDigests(ctx) : undefined;
    return {
      watched: watched.length,
      savedResults: saved.length,
      checked: answers.size,
      unknown: [...answers.values()].filter((a) => a.status === 'unknown').length,
      notifications: created,
      ...(mail ? { emailed: mail.emailed, emailDeferred: mail.deferred } : { email: 'off' }),
    };
  },
};
