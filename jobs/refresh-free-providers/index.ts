// Daily free-provider refresh (spec 007 tech §1, spec 010 §5.1; FR-REF-006, FR-FREE-005). The reviewed provider seed
// → `free_providers` with today's health, and the public lists of taken names → `free_provider_taken`. A provider
// whose check fails is marked unhealthy with a short note; its previous taken list is kept.
import { dohQuery } from '@domains-all/availability';
import {
  type FreeProvider,
  parseTakenList,
  PROVIDERS,
  PROVIDERS_REVIEWED_AT,
} from '@domains-all/free-domains';
import { json } from '../_lib/db';
import { download, downloadText } from '../_lib/fetch';
import type { JobContext, JobDefinition } from '../_lib/run';

const MIN_TAKEN = 100;

interface Health {
  healthy: boolean;
  note?: string;
  taken?: Set<string>;
}

async function checkProvider(ctx: JobContext, p: FreeProvider): Promise<Health> {
  try {
    if (p.checkMethod === 'github_list') {
      const cfg = p.checkConfig;
      if (!cfg?.url || !cfg.format) return { healthy: false, note: 'no list configured' };
      const github = new URL(cfg.url).host === 'api.github.com';
      const token = process.env.GITHUB_TOKEN; // Actions token: higher API limits on shared runners
      const body = await downloadText(ctx, cfg.url, {
        maxBytes: 30_000_000,
        headers: {
          accept: cfg.format === 'tree' ? 'application/vnd.github+json' : 'text/plain',
          ...(github && token ? { authorization: `Bearer ${token}` } : {}),
        },
      });
      const taken = parseTakenList(cfg.format, body, cfg);
      return taken.size >= MIN_TAKEN
        ? { healthy: true, taken }
        : { healthy: false, note: `taken list has only ${taken.size} names` };
    }
    if (p.checkMethod === 'doh') {
      const answer = await dohQuery(p.suffix, 'NS', { fetchFn: ctx.fetch, timeoutMs: 5000 });
      if (!answer) return { healthy: false, note: 'DNS lookup failed' };
      return answer.status === 0 && answer.answer.length > 0
        ? { healthy: true }
        : { healthy: false, note: `no name servers for ${p.suffix}` };
    }
    await download(ctx, p.officialUrl, { maxBytes: 5_000_000, timeoutMs: 20_000 });
    return { healthy: true };
  } catch (e) {
    return { healthy: false, note: (e as Error).message.slice(0, 200) };
  }
}

export const refreshFreeProviders: JobDefinition = {
  name: 'refresh-free-providers',
  async run(ctx) {
    const checked = await Promise.all(PROVIDERS.map(async (p) => ({ p, h: await checkProvider(ctx, p) })));
    // Every check failing points at our network, not at the providers: keep yesterday's state.
    if (checked.every(({ h }) => !h.healthy))
      throw new Error('every provider check failed (network problem?)');
    const rows = checked.map(({ p, h }) => ({
      id: p.id,
      name: p.name,
      suffix: p.suffix,
      kind: p.kind,
      eligibility: p.eligibility,
      steps: p.steps,
      wait_time: p.waitTime,
      official_url: p.officialUrl,
      check_method: p.checkMethod === 'github_list' ? 'github_tree' : p.checkMethod,
      check_config: p.checkConfig ?? null,
      healthy: p.healthy && h.healthy, // a provider closed by hand in the seed stays closed
      health_note: !p.healthy ? (p.healthNote ?? 'closed in the reviewed list') : (h.note ?? null),
    }));

    let takenRows = 0;
    await ctx.db.tx(async (t) => {
      await t.query(
        `insert into public.free_providers (id, name, suffix, kind, eligibility, steps, wait_time, official_url,
           check_method, check_config, healthy, health_note, last_health_at, reviewed_at)
         select r.id, r.name, r.suffix, r.kind, r.eligibility,
                array(select jsonb_array_elements_text(r.steps)), r.wait_time, r.official_url,
                r.check_method, r.check_config, r.healthy, r.health_note, now(), $2::date
         from jsonb_to_recordset($1::text::jsonb) as r(id text, name text, suffix text, kind text, eligibility jsonb,
           steps jsonb, wait_time text, official_url text, check_method text, check_config jsonb, healthy boolean,
           health_note text)
         on conflict (id) do update set name = excluded.name, suffix = excluded.suffix, kind = excluded.kind,
           eligibility = excluded.eligibility, steps = excluded.steps, wait_time = excluded.wait_time,
           official_url = excluded.official_url, check_method = excluded.check_method,
           check_config = excluded.check_config, healthy = excluded.healthy, health_note = excluded.health_note,
           last_health_at = excluded.last_health_at, reviewed_at = excluded.reviewed_at`,
        [json(rows), PROVIDERS_REVIEWED_AT],
      );
      // Providers removed from the seed are kept but closed, so old saved results still explain themselves.
      await t.query(
        `update public.free_providers set healthy = false, health_note = 'removed from the reviewed list'
         where id not in (select jsonb_array_elements_text($1::text::jsonb)) and healthy`,
        [json(rows.map((r) => r.id))],
      );
      for (const { p, h } of checked) {
        if (!h.taken) continue;
        await t.query(`delete from public.free_provider_taken where provider_id = $1`, [p.id]);
        await t.query(
          `insert into public.free_provider_taken (provider_id, label, synced_at)
           select $1, l, now() from jsonb_array_elements_text($2::text::jsonb) as l`,
          [p.id, json([...h.taken])],
        );
        takenRows += h.taken.size;
      }
    });

    const unhealthy = rows.filter((r) => !r.healthy).map((r) => r.id);
    return {
      providers: rows.length,
      healthy: rows.length - unhealthy.length,
      takenNames: takenRows,
      ...(unhealthy.length ? { unhealthy: unhealthy.join(',') } : {}),
    };
  },
};
