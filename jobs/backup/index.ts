// Weekly encrypted backup (spec 012 tech §5.4, spec 017 §5.5; FR-DATA-008). The free database plan has no
// downloadable backups, so this job dumps the schema and data, adds the minimal sign-in columns of the users, packs
// everything and encrypts it with the owner's `age` public key. The workflow uploads only the encrypted file as an
// artifact kept for 28 days. Workflow artifacts of a public repository can be downloaded by anyone signed in to
// GitHub — so there is never an unencrypted upload, and the private key never touches GitHub.
import { execFile } from 'node:child_process';
import { mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { JobDefinition } from '../_lib/run';

const run = promisify(execFile);

/** CSV with quotes doubled; every value quoted. */
export function toCsv(rows: ReadonlyArray<Record<string, unknown>>, columns: readonly string[]): string {
  const cell = (v: unknown) =>
    `"${(v instanceof Date ? v.toISOString() : String(v ?? '')).replace(/"/g, '""')}"`;
  return [columns.join(','), ...rows.map((r) => columns.map((c) => cell(r[c])).join(','))].join('\n') + '\n';
}

export const backup: JobDefinition = {
  name: 'backup',
  async run(ctx) {
    const key = ctx.env.BACKUP_AGE_PUBLIC_KEY;
    if (!key)
      throw new Error(
        'BACKUP_AGE_PUBLIC_KEY is not set (tasks/M5-freshness.md G4): refusing an unencrypted backup',
      );
    const dir = process.env.BACKUP_DIR ?? join(tmpdir(), 'domains-all-backup');
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const plain = join(dir, 'plain');
    mkdirSync(plain);

    const users = await ctx.db.query(
      `select id, email, is_anonymous, created_at from auth.users order by created_at`,
    );
    writeFileSync(join(plain, 'auth-users.csv'), toCsv(users, ['id', 'email', 'is_anonymous', 'created_at']));
    const out = join(dir, `backup-${ctx.runDate}.tar.gz.age`);

    if (ctx.dryRun) {
      writeFileSync(out, 'dry run: nothing dumped\n');
    } else {
      const url = ctx.env.SUPABASE_DB_URL!;
      const supabase = process.env.SUPABASE_BIN ?? 'supabase';
      // The CLI runs the matching pg_dump version in Docker (the runner's own client may be older than the server).
      await run(supabase, ['db', 'dump', '--db-url', url, '-f', join(plain, 'schema.sql')], {
        maxBuffer: 1 << 26,
      });
      await run(supabase, ['db', 'dump', '--db-url', url, '--data-only', '-f', join(plain, 'data.sql')], {
        maxBuffer: 1 << 26,
      });
      const tarball = join(dir, 'backup.tar.gz');
      await run('tar', ['-czf', tarball, '-C', plain, '.']);
      await run('age', ['-r', key, '-o', out, tarball]);
      rmSync(tarball, { force: true });
    }
    rmSync(plain, { recursive: true, force: true }); // only the encrypted file is left for the upload step
    return {
      users: users.length,
      encryptedBytes: statSync(out).size,
      file: `backup-${ctx.runDate}.tar.gz.age`,
    };
  },
};
