// Database access for jobs (spec 010 tech §2). Production connects to the Supabase pooler URL; tests and `--dry-run`
// use an in-process Postgres (PGlite) with every migration applied. Bulk writes pass one JSON text parameter
// (`jsonb_to_recordset($1::text::jsonb)`) so no statement hits the parameter limit. The `::text` matters: typed as
// jsonb, the production driver JSON-encodes the string a second time (found 2026-10-10 against a real socket).
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import postgres from 'postgres';

export type Row = Record<string, unknown>;

export interface Db {
  query<T = Row>(text: string, params?: readonly unknown[]): Promise<T[]>;
  /** Runs `fn` in one transaction: everything or nothing (spec 012 §5.5). */
  tx<T>(fn: (db: Db) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/** Supabase pooler URL. `prepare: false` because the transaction pooler cannot keep prepared statements. */
export function postgresDb(url: string): Db {
  const sql = postgres(url, {
    max: 1,
    prepare: false,
    connect_timeout: 30,
    idle_timeout: 20,
    onnotice: () => undefined,
  });
  const wrap = (s: postgres.Sql | postgres.TransactionSql, root: boolean): Db => ({
    query: async <T>(text: string, params: readonly unknown[] = []) =>
      (await s.unsafe(text, params as postgres.ParameterOrJSON<never>[])) as unknown as T[],
    tx: async <T>(fn: (db: Db) => Promise<T>) =>
      root ? ((await (s as postgres.Sql).begin((t) => fn(wrap(t, false)))) as T) : fn(wrap(s, false)),
    close: () => sql.end({ timeout: 5 }),
  });
  return wrap(sql, true);
}

const repoRoot = join(import.meta.dirname, '..', '..');

/** Fresh in-process Postgres with the Supabase auth stub and all migrations (tests, `--dry-run`). */
export async function memoryDb(): Promise<Db & { pg: PGlite }> {
  const pg = await PGlite.create();
  await pg.exec(
    readFileSync(join(repoRoot, 'packages', 'db', 'test', 'support', 'supabase-auth-stub.sql'), 'utf8'),
  );
  const dir = join(repoRoot, 'supabase', 'migrations');
  for (const file of readdirSync(dir)
    .filter((f) => /^\d+_.+\.sql$/.test(f))
    .sort())
    await pg.exec(readFileSync(join(dir, file), 'utf8'));

  type Querier = Pick<PGlite, 'query'>;
  const wrap = (q: Querier, root: boolean): Db => ({
    query: async <T>(text: string, params: readonly unknown[] = []) =>
      (await q.query<T>(text, [...params])).rows,
    tx: async <T>(fn: (db: Db) => Promise<T>) =>
      root ? pg.transaction((t) => fn(wrap(t, false))) : fn(wrap(q, false)),
    close: () => pg.close(),
  });
  return Object.assign(wrap(pg, true), { pg });
}

/** One JSON text parameter for `$n::text::jsonb` (`jsonb_to_recordset`, `jsonb_array_elements_text`). */
export const json = (value: unknown): string => JSON.stringify(value);

/** Splits a list into chunks (bulk statements stay small enough for the pooler and the runner). */
export function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
