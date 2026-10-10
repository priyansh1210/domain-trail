// Monthly ranking-weight proposal (spec 008 tech §5.8; FR-RANK-013, FR-REF-017). Shown results with their score
// components (R, Q, T, K, P) and what visitors did — thumbs up, buy click or copy = 1, thumbs down = 0 — feed a small
// logistic regression. The job only proposes: a person compares the validation AUC and decides whether to change
// RANK_WEIGHTS. Results are kept for 7 days (spec 012), so each run learns from the last week of feedback.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { jobs as cfg } from '@domains-all/config/defaults';
import type { JobDefinition } from '../_lib/run';

export const FEATURES = ['R', 'Q', 'T', 'K', 'P'] as const;
export const CURRENT = { R: 0.45, Q: 0.2, T: 0.15, K: 0.1, P: 0.1 }; // packages/core ranking/score.ts WEIGHTS

export interface Example {
  x: number[];
  y: 0 | 1;
  validation: boolean;
}

/** Logistic regression by gradient descent with a little L2 regularisation; returns [bias, ...weights]. */
export function fitLogistic(examples: readonly Example[], steps = 3000, rate = 0.5, l2 = 0.001): number[] {
  const n = FEATURES.length;
  const w = Array<number>(n + 1).fill(0);
  if (examples.length === 0) return w;
  for (let s = 0; s < steps; s++) {
    const g = Array<number>(n + 1).fill(0);
    for (const e of examples) {
      const z = w[0]! + e.x.reduce((a, v, i) => a + v * w[i + 1]!, 0);
      const err = 1 / (1 + Math.exp(-z)) - e.y;
      g[0]! += err;
      e.x.forEach((v, i) => (g[i + 1]! += err * v));
    }
    for (let i = 0; i <= n; i++) w[i]! -= rate * (g[i]! / examples.length + (i > 0 ? l2 * w[i]! : 0));
  }
  return w;
}

/** Area under the ROC curve (probability a liked result scores above a disliked one); ties count half. */
export function auc(scores: readonly number[], labels: readonly (0 | 1)[]): number | null {
  const pos = scores.filter((_, i) => labels[i] === 1);
  const neg = scores.filter((_, i) => labels[i] === 0);
  if (!pos.length || !neg.length) return null;
  let wins = 0;
  for (const p of pos) for (const q of neg) wins += p > q ? 1 : p === q ? 0.5 : 0;
  return wins / (pos.length * neg.length);
}

/** Positive coefficients scaled to sum to 1, the same form as RANK_WEIGHTS. */
export function proposeWeights(w: readonly number[]): Record<(typeof FEATURES)[number], number> {
  const pos = FEATURES.map((_, i) => Math.max(0, w[i + 1]!));
  const sum = pos.reduce((a, b) => a + b, 0) || 1;
  return Object.fromEntries(FEATURES.map((f, i) => [f, Math.round((pos[i]! / sum) * 100) / 100])) as Record<
    (typeof FEATURES)[number],
    number
  >;
}

const linear = (weights: Record<string, number>, x: readonly number[]) =>
  FEATURES.reduce((a, f, i) => a + weights[f]! * x[i]!, 0);

export const tuneWeights: JobDefinition = {
  name: 'tune-weights',
  async run(ctx) {
    const rows = await ctx.db.query<{
      signals: Record<string, number>;
      up: boolean;
      down: boolean;
      acted: boolean;
      bucket: number;
    }>(
      `select sr.signals -> 'signals' as signals,
              coalesce(bool_or(f.vote = 1), false) as up, coalesce(bool_or(f.vote = -1), false) as down,
              coalesce(bool_or(e.action in ('buy', 'copy')), false) as acted,
              abs(hashtext(sr.search_id::text || sr.fqdn)) % 5 as bucket
       from public.search_results sr
       left join public.feedback f on f.search_id = sr.search_id and f.fqdn = sr.fqdn
       left join public.result_events e on e.search_id = sr.search_id and e.fqdn = sr.fqdn
       where sr.signals ? 'signals'
       group by sr.search_id, sr.fqdn, sr.signals
       having bool_or(f.vote is not null) or bool_or(e.action in ('buy', 'copy'))`,
    );
    const examples: Example[] = rows.map((r) => ({
      x: FEATURES.map((f) => Number(r.signals?.[f] ?? 0)),
      y: r.up || r.acted ? 1 : 0,
      validation: Number(r.bucket) === 0,
    }));
    const period = ctx.now.toISOString().slice(0, 7);
    const enough = examples.length >= cfg.tuneWeightsMinExamples;

    let metrics: Record<string, unknown> = { examples: examples.length, current: CURRENT };
    if (enough) {
      const train = examples.filter((e) => !e.validation);
      const val = examples.filter((e) => e.validation);
      const proposed = proposeWeights(fitLogistic(train));
      const labels = val.map((e) => e.y);
      metrics = {
        ...metrics,
        proposed,
        validationExamples: val.length,
        aucCurrent: auc(
          val.map((e) => linear(CURRENT, e.x)),
          labels,
        ),
        aucProposed: auc(
          val.map((e) => linear(proposed, e.x)),
          labels,
        ),
      };
    } else metrics.status = `not enough labelled results (need ${cfg.tuneWeightsMinExamples})`;

    await ctx.db.tx(async (t) => {
      await t.query(`delete from public.quality_reports where kind = 'weights' and period = $1`, [period]);
      await t.query(
        `insert into public.quality_reports (kind, period, metrics) values ('weights', $1, $2::text::jsonb)`,
        [period, JSON.stringify(metrics)],
      );
    });
    const dir = process.env.REPORT_DIR;
    if (dir) {
      const md = [
        `# Ranking weight proposal ${period}`,
        '',
        `Labelled results: ${examples.length}`,
        '',
        '| Weight | Current | Proposed |',
        '|---|---|---|',
        ...FEATURES.map(
          (f) =>
            `| ${f} | ${CURRENT[f]} | ${(metrics.proposed as Record<string, number> | undefined)?.[f] ?? '-'} |`,
        ),
        '',
        `Validation AUC: current ${metrics.aucCurrent ?? '-'}, proposed ${metrics.aucProposed ?? '-'}`,
        '',
        'A person decides: change RANK_WEIGHTS only when the proposed AUC is clearly higher.',
        ...(metrics.status ? ['', String(metrics.status)] : []),
      ].join('\n');
      writeFileSync(join(dir, `weights-${period}.md`), `${md}\n`);
    }
    return { examples: examples.length, proposed: enough };
  },
};
