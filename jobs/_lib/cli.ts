// `pnpm job <name> [--dry-run | --fixtures] [--force]` (spec 010 tech §1, FR-REF-013). Exit code 1 on failure, so
// GitHub e-mails the owner about failed scheduled runs. Output is counts only: workflow logs of a public repository
// are public. --dry-run: recorded sources + in-process database. --fixtures: recorded sources + the real database
// (CI runs every job against its local Supabase stack this way, without going online).
import { appendFileSync } from 'node:fs';
import { parseServerEnv, type ServerEnv } from '@domains-all/config';
import { createLogger } from '@domains-all/log';
import { type Db, memoryDb, postgresDb } from './db';
import { fixtureFetch } from './fixtures';
import { isJobName, JOBS } from './registry';
import { type JobName, type RunOutcome, runJob } from './run';

/** GitHub annotation + step summary when running in Actions; plain lines otherwise. */
export function report(job: JobName, outcome: RunOutcome, dryRun: boolean): void {
  const out = (line: string) => process.stdout.write(`${line}\n`);
  const label = `${job}${dryRun ? ' (dry run)' : ''}`;
  if (outcome.status === 'failed') out(`::error title=${label} failed::${outcome.error ?? 'unknown error'}`);
  else if (outcome.status === 'skipped') out(`::warning title=${label} skipped::another run is still going`);
  else
    out(
      `::notice title=${label}::${Object.entries(outcome.stats ?? {})
        .map(([k, v]) => `${k}=${v}`)
        .join(' ')}`,
    );
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) {
    const rows = Object.entries(outcome.stats ?? {}).map(([k, v]) => `| ${k} | ${v} |`);
    appendFileSync(
      summary,
      [
        `### ${label}: ${outcome.status}`,
        '',
        ...(rows.length ? ['| | |', '|---|---|', ...rows] : []),
        outcome.error ? `\n${outcome.error}` : '',
        '',
      ].join('\n'),
    );
  }
}

export async function main(argv: string[]): Promise<number> {
  const name = argv.find((a) => !a.startsWith('--')) ?? '';
  if (!isJobName(name)) {
    process.stderr.write(`usage: pnpm job <${Object.keys(JOBS).join('|')}> [--dry-run] [--force]\n`);
    return 2;
  }
  const dryRun = argv.includes('--dry-run');
  const recorded = dryRun || argv.includes('--fixtures');
  const force = argv.includes('--force');
  const env: ServerEnv = parseServerEnv(process.env);
  const log = createLogger({ name: `job:${name}` });

  let db: Db;
  if (dryRun) db = await memoryDb();
  else if (env.SUPABASE_DB_URL) db = postgresDb(env.SUPABASE_DB_URL);
  else {
    // Before the owner sets up the `jobs` environment (tasks/M5-freshness.md G2) runs end quietly instead of
    // failing every day; the Status page shows the data as not refreshed yet.
    process.stdout.write(
      `::warning title=${name} not configured::SUPABASE_DB_URL is not set in the GitHub environment "jobs"\n`,
    );
    return 0;
  }
  try {
    const outcome = await runJob(JOBS[name], {
      db,
      env,
      log,
      force,
      dryRun,
      ...(recorded ? { fetch: fixtureFetch, sleep: async () => undefined } : {}),
    });
    report(name, outcome, dryRun);
    return outcome.status === 'failed' ? 1 : 0;
  } finally {
    await db.close();
  }
}
