// CI dry run (spec 010 tech §11): every job in schedule order against fixtures and one in-process database, so the
// later jobs see the data the earlier ones wrote. Fails when any job fails.
import { parseServerEnv } from '@domains-all/config';
import { createLogger } from '@domains-all/log';
import { report } from './cli';
import { memoryDb } from './db';
import { fixtureFetch } from './fixtures';
import { JOBS } from './registry';
import { type JobName, runJob } from './run';

const ORDER: JobName[] = [
  'tld-registry',
  'refresh-prices',
  'nrd-ingest',
  'refresh-free-providers',
  'brand-list',
  'watchlist',
  'cleanup',
  'backup',
  'usage-report',
  'tune-weights',
];

const db = await memoryDb();
const env = parseServerEnv({
  ...process.env,
  BACKUP_AGE_PUBLIC_KEY: 'age1qyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqs3290gq',
});
let failed = 0;
for (const name of ORDER) {
  const outcome = await runJob(JOBS[name], {
    db,
    env,
    log: createLogger({ name: `job:${name}`, level: 'warn' }),
    dryRun: true,
    force: true,
    fetch: fixtureFetch,
    sleep: async () => undefined,
  });
  report(name, outcome, true);
  if (outcome.status !== 'success') failed++;
}
await db.close();
process.exitCode = failed ? 1 : 0;
