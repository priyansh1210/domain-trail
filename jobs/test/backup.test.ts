// Spec 012 tech §5.4 (FR-DATA-008): the backup never runs without encryption, and the user export is valid CSV.
import { existsSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Db, memoryDb } from '../_lib/db';
import { backup, toCsv } from '../backup';
import { run, testEnv } from './support';

const KEY = 'age1qyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqs3290gq';

let db: Db;
beforeAll(async () => {
  db = await memoryDb();
});
afterAll(async () => {
  await db?.close();
});

describe('backup', () => {
  it('quotes CSV values', () => {
    expect(toCsv([{ a: 'x"y', b: null }], ['a', 'b'])).toBe('a,b\n"x""y",""\n');
  });

  it('refuses to run without the owner’s public key', async () => {
    const outcome = await run(backup, db, { dryRun: true });
    expect(outcome.status).toBe('failed');
    expect(outcome.error).toMatch(/BACKUP_AGE_PUBLIC_KEY/);
  });

  it('leaves only the encrypted file behind', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'backup-'));
    process.env.BACKUP_DIR = dir;
    const outcome = await run(backup, db, { dryRun: true, env: testEnv({ BACKUP_AGE_PUBLIC_KEY: KEY }) });
    delete process.env.BACKUP_DIR;
    expect(outcome.status).toBe('success');
    expect(readdirSync(dir)).toEqual([expect.stringMatching(/^backup-\d{4}-\d{2}-\d{2}\.tar\.gz\.age$/)]);
    expect(existsSync(join(dir, 'plain'))).toBe(false);
  });
});
