// Daily prices and currency rates (spec 006 tech §5.6, spec 010 §5.1; FR-REF-002, FR-PRC-011). Porkbun's public list
// → `tld_prices` (+ `tld_price_history` only when a price changed) and Frankfurter → `fx_rates`. A list that fails
// its sanity check writes nothing, so yesterday's prices stay. The site reads these public tables (decision 2 of
// tasks/M5-freshness.md), which is how prices stay fresh although Porkbun does not answer the hosting provider.
import {
  FRANKFURTER_URL,
  parseFrankfurter,
  parsePorkbun,
  PORKBUN,
  PORKBUN_PRICING_URL,
  policySeed,
  type TldPrice,
} from '@domains-all/pricing';
import type { FxTable } from '@domains-all/pricing/client';
import { json, type Db } from '../_lib/db';
import { downloadJson } from '../_lib/fetch';
import type { JobDefinition, JobStats } from '../_lib/run';
import { tldType } from '../tld-registry';

async function ensureTlds(db: Db, tlds: readonly string[]) {
  await db.query(
    `insert into public.tlds (tld, type)
     select r.tld, r.type from jsonb_to_recordset($1::text::jsonb) as r(tld text, type text)
     on conflict (tld) do nothing`,
    [json(tlds.map((tld) => ({ tld, type: tldType(tld) })))],
  );
}

export async function writePrices(db: Db, prices: ReadonlyMap<string, TldPrice>): Promise<JobStats> {
  const provider = PORKBUN.id;
  const rows = [...prices].map(([tld, p]) => ({ tld, reg: p.registerCents, ren: p.renewCents }));
  return db.tx(async (t) => {
    await ensureTlds(
      t,
      rows.map((r) => r.tld),
    );
    const changed = await t.query(
      `insert into public.tld_price_history (tld, provider, register_cents, renew_cents, changed_at)
       select r.tld, $2, r.reg, r.ren, now()
       from jsonb_to_recordset($1::text::jsonb) as r(tld text, reg int, ren int)
       left join public.tld_prices p on p.tld = r.tld and p.provider = $2
       where p.tld is null or p.register_cents is distinct from r.reg or p.renew_cents is distinct from r.ren
       on conflict do nothing
       returning tld`,
      [json(rows), provider],
    );
    await t.query(
      `insert into public.tld_prices (tld, provider, currency, register_cents, renew_cents, fetched_at)
       select r.tld, $2, 'USD', r.reg, r.ren, now() from jsonb_to_recordset($1::text::jsonb) as r(tld text, reg int, ren int)
       on conflict (tld, provider) do update set register_cents = excluded.register_cents,
         renew_cents = excluded.renew_cents, currency = excluded.currency, fetched_at = excluded.fetched_at`,
      [json(rows), provider],
    );
    // Extensions the registrar stopped selling must not keep an old price.
    const dropped = await t.query(
      `delete from public.tld_prices where provider = $2
         and tld not in (select jsonb_array_elements_text($1::text::jsonb)) returning tld`,
      [json(rows.map((r) => r.tld)), provider],
    );
    await t.query(
      `update public.tlds t set priced = x.has_price, updated_at = now()
       from (select tl.tld, exists (select 1 from public.tld_prices p where p.tld = tl.tld) as has_price
             from public.tlds tl) x
       where t.tld = x.tld and t.priced is distinct from x.has_price`,
    );
    return { prices: rows.length, priceChanges: changed.length, pricesDropped: dropped.length };
  });
}

export async function writeFx(db: Db, fx: FxTable): Promise<JobStats> {
  const rows = Object.entries(fx.rates).map(([quote, rate]) => ({ quote, rate }));
  await db.query(
    `insert into public.fx_rates (base, quote, rate, as_of)
     select 'USD', r.quote, r.rate, $2::date from jsonb_to_recordset($1::text::jsonb) as r(quote text, rate numeric)
     on conflict (base, quote, as_of) do update set rate = excluded.rate`,
    [json(rows), fx.asOf],
  );
  return { currencies: rows.length, fxAsOf: fx.asOf };
}

/** Extension policies (minimum years, restrictions, HTTPS-only) from the reviewed seed (research R-13). */
export async function writePolicies(db: Db): Promise<number> {
  const { reviewedAt, policies } = policySeed();
  const rows = Object.entries(policies).map(([tld, p]) => ({
    tld,
    restriction: p.restriction,
    note: p.note ?? null,
    min_years: p.minYears,
    https: p.requiresHttps,
    premium: p.premiumNames,
  }));
  await ensureTlds(
    db,
    rows.map((r) => r.tld),
  );
  await db.query(
    `insert into public.tld_policies (tld, restriction, restriction_note, min_years, requires_https,
       has_premium_names, reviewed_at)
     select r.tld, r.restriction, r.note, r.min_years, r.https, r.premium, $2::date
     from jsonb_to_recordset($1::text::jsonb)
       as r(tld text, restriction text, note text, min_years smallint, https boolean, premium boolean)
     on conflict (tld) do update set restriction = excluded.restriction, restriction_note = excluded.restriction_note,
       min_years = excluded.min_years, requires_https = excluded.requires_https,
       has_premium_names = excluded.has_premium_names, reviewed_at = excluded.reviewed_at`,
    [json(rows), reviewedAt],
  );
  return rows.length;
}

export const refreshPrices: JobDefinition = {
  name: 'refresh-prices',
  async run(ctx) {
    const [prices, fx] = await Promise.allSettled([
      downloadJson(ctx, PORKBUN_PRICING_URL, { maxBytes: 5_000_000 }).then(parsePorkbun),
      downloadJson(ctx, FRANKFURTER_URL, { maxBytes: 200_000 }).then(parseFrankfurter),
    ]);
    const stats: JobStats = { policies: await writePolicies(ctx.db) };
    if (prices.status === 'fulfilled') Object.assign(stats, await writePrices(ctx.db, prices.value));
    if (fx.status === 'fulfilled') Object.assign(stats, await writeFx(ctx.db, fx.value));

    const failed = [
      prices.status === 'rejected' ? `prices: ${(prices.reason as Error).message}` : '',
      fx.status === 'rejected' ? `FX: ${(fx.reason as Error).message}` : '',
    ].filter(Boolean);
    // The part that worked is saved; the run still fails so the owner hears about the other part.
    if (failed.length) throw new Error(`${failed.join('; ')} (previous data kept)`);
    return stats;
  },
};
