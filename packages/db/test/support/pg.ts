import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite, type Transaction } from '@electric-sql/pglite';

const repoRoot = join(import.meta.dirname, '..', '..', '..', '..');
export const migrationsDir = join(repoRoot, 'supabase', 'migrations');

export function migrationFiles(): string[] {
  return readdirSync(migrationsDir)
    .filter((f) => /^\d+_.+\.sql$/.test(f))
    .sort();
}

/** Fresh in-process Postgres with the Supabase auth stub and every migration applied in order. */
export async function migratedDb(): Promise<PGlite> {
  const db = await PGlite.create();
  await db.exec(readFileSync(join(import.meta.dirname, 'supabase-auth-stub.sql'), 'utf8'));
  for (const file of migrationFiles()) {
    await db.exec(readFileSync(join(migrationsDir, file), 'utf8'));
  }
  return db;
}

export interface Claims {
  sub?: string;
  role?: 'anon' | 'authenticated';
  is_anonymous?: boolean;
}

/**
 * Run `fn` as a browser request would: database role + JWT claims, scoped to one transaction (committed on
 * success, rolled back when `fn` throws).
 */
export async function as<T>(db: PGlite, claims: Claims, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.exec(`set local role ${claims.role ?? 'authenticated'}`);
    await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
    return fn(tx);
  });
}

export async function createUser(db: PGlite, id: string, isAnonymous = false): Promise<void> {
  await db.query('insert into auth.users (id, is_anonymous) values ($1, $2)', [id, isAnonymous]);
}
