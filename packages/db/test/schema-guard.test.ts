// Spec 012 tech §11 `schema-guard.test.ts`: FR-DATA-001, 002, 004, 006, 012.
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migratedDb, migrationFiles } from './support/pg';

let db: PGlite;
beforeAll(async () => {
  db = await migratedDb();
});
afterAll(async () => {
  await db?.close();
});

const col = async (sql: string) => (await db.query<Record<string, string>>(sql)).rows;

describe('migrations', () => {
  it('apply cleanly from scratch, in order', () => {
    expect(migrationFiles().length).toBeGreaterThan(0);
  });

  it('create every dataset of the spec 012 inventory', async () => {
    const tables = (await col(`select tablename from pg_tables where schemaname = 'public'`)).map(
      (r) => r.tablename,
    );
    expect(tables).toEqual(
      expect.arrayContaining([
        'tlds',
        'tld_policies',
        'tld_prices',
        'tld_price_history',
        'fx_rates',
        'free_providers',
        'domain_checks',
        'free_provider_taken',
        'brand_labels',
        'keyword_trends',
        'word_cache',
        'searches',
        'search_results',
        'result_cache',
        'feedback',
        'result_events',
        'feedback_monthly',
        'profiles',
        'saved_searches',
        'watchlist',
        'notifications',
        'anon_visitors',
        'contact_messages',
        'jev_usage',
        'email_log',
        'job_runs',
        'quality_reports',
        'search_metrics_daily',
      ]),
    );
  });
});

describe('schema guard', () => {
  it('enables row level security on every table (FR-DATA-004)', async () => {
    const open = await col(`
      select relname from pg_class
      where relnamespace = 'public'::regnamespace and relkind = 'r' and not relrowsecurity`);
    expect(open).toEqual([]);
  });

  it('never stores descriptions with anonymous search data (FR-DATA-002, FR-DATA-012)', async () => {
    const cols = await col(`
      select table_name, column_name from information_schema.columns
      where table_schema = 'public'
        and table_name in ('searches', 'search_results', 'result_cache', 'feedback', 'result_events', 'anon_visitors')
        and (column_name ilike '%desc%' or column_name ilike '%prompt%' or column_name ilike '%email%'
             or column_name ilike '%ip%addr%')`);
    expect(cols).toEqual([]);
  });

  it('stores money as integer cents (FR-DATA-006)', async () => {
    const bad = await col(`
      select table_name, column_name, data_type from information_schema.columns
      where table_schema = 'public' and column_name like '%cents' and data_type not in ('integer', 'bigint')`);
    expect(bad).toEqual([]);
  });

  it('stores times in UTC-aware columns (FR-DATA-006)', async () => {
    const bad = await col(`
      select table_name, column_name from information_schema.columns
      where table_schema = 'public' and data_type = 'timestamp without time zone'`);
    expect(bad).toEqual([]);
  });
});
