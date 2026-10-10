// Daily newly-registered names (spec 010 tech §5.3; FR-REF-003, 004, 005; research R-07). The whoisds free daily
// file is read in memory only: cached "available" answers for those names become "taken", watchers get an in-app
// notification, and only aggregate naming trends are stored. The list itself is never written anywhere.
import { jobs as cfg } from '@domains-all/config/defaults';
import { segment } from '@domains-all/core';
import { unzipSync } from 'fflate';
import { json } from '../_lib/db';
import { download, HttpError } from '../_lib/fetch';
import type { JobContext, JobDefinition, JobStats } from '../_lib/run';

const NAME = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9-]{2,63})+$/;

export function nrdUrl(day: string, template: string = cfg.nrd.urlTemplate): string {
  return template.replace('{file}', Buffer.from(`${day}.zip`).toString('base64'));
}

/** Unzips the daily file and returns the distinct, lower-cased names; throws when it does not look like the list. */
export function parseNrdZip(bytes: Uint8Array): string[] {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new NotPublished('not a zip file');
  }
  const entry = Object.entries(files).find(([name]) => name.endsWith('.txt'));
  if (!entry) throw new Error('newly-registered list: no text file in the zip');
  const names = new Set<string>();
  for (const line of new TextDecoder().decode(entry[1]).split(/\r?\n/)) {
    const n = line.trim().toLowerCase();
    if (NAME.test(n)) names.add(n);
  }
  if (names.size < cfg.nrd.minNames) throw new Error(`newly-registered list: only ${names.size} names`);
  return [...names];
}

/** The file for a day is not (or no longer) on the free page. */
export class NotPublished extends Error {}

export interface Trends {
  token: Map<string, number>;
  prefix: Map<string, number>;
  suffix: Map<string, number>;
  tld: Map<string, number>;
}

/** Frequent words, first and last words of a name and extensions (FR-REF-004). Junk labels count only their extension. */
export function computeTrends(names: readonly string[]): Trends {
  const t: Trends = { token: new Map(), prefix: new Map(), suffix: new Map(), tld: new Map() };
  const add = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
  for (const name of names) {
    const dot = name.indexOf('.');
    add(t.tld, name.slice(dot + 1));
    const label = name.slice(0, dot);
    if (label.length > 30) continue;
    const parts = label.split(/[^a-z]+/).filter(Boolean);
    const segs: string[] = [];
    for (const p of parts) {
      const s = segment(p);
      if (!s) {
        segs.length = 0;
        break;
      }
      segs.push(...s);
    }
    if (segs.length === 0) continue;
    for (const s of new Set(segs)) if (s.length >= 3) add(t.token, s);
    if (segs.length >= 2) {
      if (segs[0]!.length >= 3) add(t.prefix, segs[0]!);
      if (segs.at(-1)!.length >= 3) add(t.suffix, segs.at(-1)!);
    }
  }
  return t;
}

const top = (m: Map<string, number>, n: number) =>
  [...m].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, n);

async function processDay(ctx: JobContext, day: string, names: string[]): Promise<JobStats> {
  let invalidated = 0;
  let notified = 0;
  for (let i = 0; i < names.length; i += cfg.nrd.chunk) {
    const part = json(names.slice(i, i + cfg.nrd.chunk));
    const hit = await ctx.db.query(
      `update public.domain_checks set status = 'taken', method = 'nrd', checked_at = now(),
         expires_at = now() + interval '7 days'
       where fqdn in (select jsonb_array_elements_text($1::text::jsonb))
         and status in ('available', 'likely_available', 'available_premium')
       returning fqdn`,
      [part],
    );
    invalidated += hit.length;
    // Watched names that were registered (spec 011): one in-app notification per user and name.
    const watchers = await ctx.db.tx(async (t) => {
      const rows = await t.query(
        `with hit as (
           update public.watchlist w set last_status = 'taken', last_checked_at = now()
           where w.fqdn in (select jsonb_array_elements_text($1::text::jsonb)) and w.last_status is distinct from 'taken'
           returning w.user_id, w.fqdn
         )
         insert into public.notifications (user_id, kind, fqdn, payload)
         select h.user_id, 'registered', h.fqdn, jsonb_build_object('source', 'newly_registered', 'day', $2::text)
         from hit h
         where not exists (select 1 from public.notifications n where n.user_id = h.user_id and n.fqdn = h.fqdn
                             and n.kind = 'registered' and n.created_at > now() - interval '7 days')
         returning id`,
        [part, day],
      );
      return rows.length;
    });
    notified += watchers;
  }

  const trends = computeTrends(names);
  const rows = [
    ...top(trends.token, cfg.nrd.topTokens).map(([token, count]) => ({ kind: 'token', token, count })),
    ...top(trends.prefix, cfg.nrd.topAffixes).map(([token, count]) => ({ kind: 'prefix', token, count })),
    ...top(trends.suffix, cfg.nrd.topAffixes).map(([token, count]) => ({ kind: 'suffix', token, count })),
    ...[...trends.tld].map(([token, count]) => ({ kind: 'tld', token, count })),
  ];
  await ctx.db.tx(async (t) => {
    await t.query(`delete from public.keyword_trends where day = $1::date`, [day]);
    await t.query(
      `insert into public.keyword_trends (day, token, kind, count)
       select $2::date, r.token, r.kind, r.count from jsonb_to_recordset($1::text::jsonb) as r(token text, kind text, count int)`,
      [json(rows), day],
    );
  });
  return { names: names.length, invalidated, notified, trendRows: rows.length };
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

export const nrdIngest: JobDefinition = {
  name: 'nrd-ingest',
  async run(ctx) {
    const days = Array.from({ length: cfg.nrd.lookbackDays }, (_, k) =>
      isoDay(new Date(ctx.now.getTime() - (k + 1) * 86_400_000)),
    );
    const doneRows = await ctx.db.query<{ day: string }>(
      `select distinct day::text as day from public.keyword_trends
       where kind = 'tld' and day in (select jsonb_array_elements_text($1::text::jsonb)::date)`,
      [json(days)],
    );
    const done = new Set(doneRows.map((r) => r.day));
    const todo = days.filter((d, i) => !done.has(d) || (ctx.force && i === 0));

    const stats: JobStats = {
      daysChecked: todo.length,
      daysProcessed: 0,
      names: 0,
      invalidated: 0,
      notified: 0,
    };
    const missing: string[] = [];
    for (const day of todo.reverse()) {
      let names: string[];
      try {
        const bytes = await download(ctx, nrdUrl(day, ctx.env.NRD_URL_TEMPLATE), {
          maxBytes: cfg.nrd.maxBytes,
          timeoutMs: 120_000,
        });
        names = parseNrdZip(bytes);
      } catch (e) {
        if (e instanceof NotPublished || (e instanceof HttpError && e.status === 404)) {
          missing.push(day);
          continue;
        }
        throw e;
      }
      const s = await processDay(ctx, day, names);
      stats.daysProcessed = Number(stats.daysProcessed) + 1;
      for (const k of ['names', 'invalidated', 'notified'] as const)
        stats[k] = Number(stats[k]) + Number(s[k]);
      names.length = 0; // nothing of the list outlives the day it was processed (FR-REF-005)
    }
    if (missing.length) stats.notPublished = missing.join(',');
    // Yesterday's file usually appears after midnight UTC; fail only when two days in a row are missing.
    const latestDone = [...done, ...todo.filter((d) => !missing.includes(d))].sort().at(-1);
    if (!latestDone || latestDone < days[1]!)
      throw new Error(`no newly-registered list for ${missing.join(', ') || 'recent days'}`);
    return stats;
  },
};
