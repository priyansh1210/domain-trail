// Monthly usage report (spec 015 tech §5.4; FR-OBS-008, 011). Meters, job success rates and product metrics of the
// previous month → `quality_reports` (kind 'monthly') and one message to the owner. Services without a usage API
// are listed as a short manual checklist.
import { budgets, jev, retention } from '@domains-all/config/defaults';
import type { Db } from '../_lib/db';
import type { JobDefinition, JobStats } from '../_lib/run';

export const MANUAL_CHECKS = [
  'Vercel: Usage page — functions, bandwidth and AI Gateway credit within the Hobby limits',
  'Supabase: Usage page — database size, egress, monthly active users',
  'GitHub Actions: public repository, minutes unmetered — check no workflow is disabled',
  'Upstash and Turnstile dashboards (once they are set up)',
];

export interface MonthlyReport {
  period: string;
  meters: Record<string, { used: number; limit: number; percent: number }>;
  jobs: Record<string, { success: number; failed: number; successRate: number | null }>;
  product: Record<string, number | null>;
  manual: string[];
}

const pct = (used: number, limit: number) => (limit > 0 ? Math.round((used / limit) * 1000) / 10 : 0);

export async function compileReport(db: Db, now: Date): Promise<MonthlyReport> {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const [from, to] = [start.toISOString().slice(0, 10), end.toISOString().slice(0, 10)];

  const [u] = await db.query<{ tokens: string; eval: string; emails: number }>(
    `select coalesce((select sum(input_tokens) from public.jev_usage where day >= $1::date and day < $2::date), 0)::text as tokens,
            coalesce((select sum(eval_tokens) from public.jev_usage where day >= $1::date and day < $2::date), 0)::text as eval,
            coalesce((select sum(sent) from public.email_log where day >= $1::date and day < $2::date), 0)::int as emails`,
    [from, to],
  );
  const [size] = await db.query<{ bytes: string }>(
    `select pg_database_size(current_database())::text as bytes`,
  );
  const dbMb = Math.round(Number(size?.bytes ?? 0) / 1024 / 1024);
  const meter = (used: number, limit: number) => ({ used, limit, percent: pct(used, limit) });

  const jobRows = await db.query<{ job: string; success: number; failed: number }>(
    `select job, count(*) filter (where status = 'success')::int as success,
            count(*) filter (where status = 'failed')::int as failed
     from public.job_runs where started_at >= $1::date and started_at < $2::date group by job order by job`,
    [from, to],
  );
  const [p] = await db.query<Record<string, number | null>>(
    `select coalesce(sum(searches), 0)::int as searches, coalesce(sum(degraded), 0)::int as degraded,
            coalesce(sum(refused), 0)::int as refused, coalesce(sum(needs_detail), 0)::int as needs_detail,
            coalesce(sum(actions), 0)::int as actions, coalesce(sum(thumbs_up), 0)::int as thumbs_up,
            coalesce(sum(thumbs_down), 0)::int as thumbs_down, max(p95_ms) as worst_day_p95_ms
     from public.search_metrics_daily where day >= $1::date and day < $2::date`,
    [from, to],
  );
  return {
    period: from.slice(0, 7),
    meters: {
      'jev-tokens': meter(Number(u?.tokens ?? 0), jev.monthlyTokenCap),
      'eval-tokens': meter(Number(u?.eval ?? 0), jev.evalMonthlyTokenCap),
      emails: meter(u?.emails ?? 0, budgets.emailsPerMonth),
      'db-mb': meter(dbMb, retention.dbSizeLimitMb),
    },
    jobs: Object.fromEntries(
      jobRows.map((j) => [
        j.job,
        {
          success: j.success,
          failed: j.failed,
          successRate:
            j.success + j.failed ? Math.round((j.success / (j.success + j.failed)) * 1000) / 10 : null,
        },
      ]),
    ),
    product: p ?? {},
    manual: MANUAL_CHECKS,
  };
}

/** Plain-text body for the owner (no personal data: counts only). */
export function reportText(r: MonthlyReport): string {
  const lines = [`Usage report for ${r.period}`, '', 'Budgets:'];
  for (const [k, m] of Object.entries(r.meters))
    lines.push(`  ${k}: ${m.used} of ${m.limit} (${m.percent}%)`);
  lines.push('', 'Jobs (success rate, target 98%):');
  for (const [k, j] of Object.entries(r.jobs))
    lines.push(
      `  ${k}: ${j.success} ok, ${j.failed} failed${j.successRate === null ? '' : ` (${j.successRate}%)`}`,
    );
  lines.push('', 'Searches:');
  for (const [k, v] of Object.entries(r.product)) lines.push(`  ${k}: ${v ?? '-'}`);
  lines.push('', 'Check by hand:', ...r.manual.map((m) => `  - ${m}`));
  return lines.join('\n');
}

export const usageReport: JobDefinition = {
  name: 'usage-report',
  async run(ctx) {
    const report = await compileReport(ctx.db, ctx.now);
    await ctx.db.tx(async (t) => {
      await t.query(`delete from public.quality_reports where kind = 'monthly' and period = $1`, [
        report.period,
      ]);
      await t.query(
        `insert into public.quality_reports (kind, period, metrics) values ('monthly', $1, $2::text::jsonb)`,
        [report.period, JSON.stringify(report)],
      );
    });
    const sent = await ctx.report(`usage-report:${report.period}`, reportText(report));
    const rates = Object.values(report.jobs)
      .map((j) => j.successRate)
      .filter((v): v is number => v !== null);
    const stats: JobStats = { period: report.period, jobs: Object.keys(report.jobs).length, sent };
    if (rates.length) stats.lowestSuccessRate = Math.min(...rates);
    return stats;
  },
};
