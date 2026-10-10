// Spec 007 tech §11 `free-health.int.test.ts`: provider seed, daily health and taken lists (FR-REF-006, FR-FREE-005).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Db, memoryDb } from '../_lib/db';
import { refreshFreeProviders } from '../refresh-free-providers';
import { fetchWith, one, run } from './support';

let db: Db;
beforeAll(async () => {
  db = await memoryDb();
});
afterAll(async () => {
  await db?.close();
});

describe('refresh-free-providers job', () => {
  it('stores every provider from the reviewed seed with its health', async () => {
    const outcome = await run(refreshFreeProviders, db);
    expect(outcome.status).toBe('success');
    const rows = await db.query<{ id: string; healthy: boolean; check_method: string }>(
      `select id, healthy, check_method from public.free_providers order by id`,
    );
    expect(rows.length).toBeGreaterThanOrEqual(9);
    expect(rows.every((r) => r.healthy)).toBe(true);
    expect(rows.find((r) => r.id === 'is-a-dev')?.check_method).toBe('github_tree');
  });

  it('syncs the public lists of taken names', async () => {
    const n = await one<{ n: number }>(
      db,
      `select count(*)::int as n from public.free_provider_taken where provider_id = 'is-a-dev'`,
    );
    expect(n.n).toBe(150);
  });

  it('marks a provider unhealthy and keeps its previous taken list when its check fails', async () => {
    const outcome = await run(refreshFreeProviders, db, {
      fetch: fetchWith({ 'api.github.com': () => new Response('rate limited', { status: 403 }) }),
    });
    expect(outcome.status).toBe('success');
    expect(outcome.stats).toMatchObject({ unhealthy: 'is-a-dev' });
    const p = await one<{ healthy: boolean; health_note: string }>(
      db,
      `select healthy, health_note from public.free_providers where id = 'is-a-dev'`,
    );
    expect(p.healthy).toBe(false);
    expect(p.health_note).toMatch(/403/);
    const n = await one<{ n: number }>(
      db,
      `select count(*)::int as n from public.free_provider_taken where provider_id = 'is-a-dev'`,
    );
    expect(n.n).toBe(150);
  });

  it('fails when every check fails (likely our network), keeping yesterday’s state', async () => {
    const before = await db.query(`select id, healthy, health_note from public.free_providers order by id`);
    const outcome = await run(refreshFreeProviders, db, {
      fetch: (async () => new Response('down', { status: 503 })) as typeof fetch,
    });
    expect(outcome.status).toBe('failed');
    expect(await db.query(`select id, healthy, health_note from public.free_providers order by id`)).toEqual(
      before,
    );
  });
});
