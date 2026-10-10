// Spec 008 tech §13 FR-RANK-013 "job unit test + report": regression, AUC and the weight proposal.
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Db, memoryDb } from '../_lib/db';
import { rng } from '../_lib/fixtures';
import { auc, type Example, fitLogistic, proposeWeights, tuneWeights } from '../tune-weights';
import { one, run } from './support';

describe('maths', () => {
  it('computes AUC with ties counted half', () => {
    expect(auc([0.9, 0.8, 0.1], [1, 1, 0])).toBe(1);
    expect(auc([0.5, 0.5], [1, 0])).toBe(0.5);
    expect(auc([0.5], [1])).toBeNull();
  });

  it('learns which signal predicts a liked result', () => {
    const rand = rng(1);
    const examples: Example[] = Array.from({ length: 400 }, () => {
      const x = [rand(), rand(), rand(), rand(), rand()];
      return { x, y: x[1]! > 0.5 ? 1 : 0, validation: false }; // only Q matters
    });
    const proposed = proposeWeights(fitLogistic(examples));
    expect(proposed.Q).toBeGreaterThan(0.5);
    const sum = Object.values(proposed).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 1);
  });
});

describe('tune-weights job', () => {
  let db: Db;
  beforeAll(async () => {
    db = await memoryDb();
  });
  afterAll(async () => {
    await db?.close();
  });

  it('reports "not enough labelled results" without proposing', async () => {
    const outcome = await run(tuneWeights, db, { now: new Date('2026-11-02T06:00:00Z') });
    expect(outcome.stats).toMatchObject({ examples: 0, proposed: false });
    const r = await one<{ metrics: { status: string } }>(
      db,
      `select metrics from public.quality_reports where kind = 'weights' and period = '2026-11'`,
    );
    expect(r.metrics.status).toMatch(/not enough/);
  });

  it('proposes weights and writes the report file when feedback exists', async () => {
    const rand = rng(2);
    const search = '0190f5a8-0000-7000-8000-000000000001';
    await db.query(
      `insert into public.searches (id, cache_key, status, prefs, pipeline_version, expires_at)
       values ($1, 'k', 'done', '{}', '0.1.0', now() + interval '7 days')`,
      [search],
    );
    const results = Array.from({ length: 300 }, (_, i) => {
      const s = { R: rand(), Q: rand(), T: rand(), K: rand(), P: rand() };
      return { fqdn: `n${i}.com`, signals: { signals: s }, vote: s.R > 0.5 ? 1 : -1 };
    });
    await db.query(
      `insert into public.search_results (search_id, fqdn, section, rank, score, status, signals, reasons, strategy)
       select $1, r.fqdn, 'budget', 0, 1, 'available', r.signals, '[]', 'x'
       from jsonb_to_recordset($2::jsonb) as r(fqdn text, signals jsonb)`,
      [search, JSON.stringify(results)],
    );
    await db.query(
      `insert into public.feedback (search_id, fqdn, visitor_hash, vote)
       select $1, r.fqdn, 'h', r.vote from jsonb_to_recordset($2::jsonb) as r(fqdn text, vote smallint)`,
      [search, JSON.stringify(results)],
    );
    const dir = mkdtempSync(join(tmpdir(), 'weights-'));
    process.env.REPORT_DIR = dir;
    const outcome = await run(tuneWeights, db, { now: new Date('2026-11-02T06:00:00Z') });
    delete process.env.REPORT_DIR;
    expect(outcome.stats).toMatchObject({ examples: 300, proposed: true });
    const r = await one<{ metrics: { proposed: Record<string, number>; aucProposed: number } }>(
      db,
      `select metrics from public.quality_reports where kind = 'weights' and period = '2026-11'`,
    );
    expect(r.metrics.proposed.R).toBeGreaterThan(0.5);
    expect(r.metrics.aucProposed).toBeGreaterThan(0.9);
    expect(readFileSync(join(dir, 'weights-2026-11.md'), 'utf8')).toContain('| R | 0.45 |');
  });
});
