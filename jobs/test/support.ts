import { parseServerEnv, type ServerEnv } from '@domains-all/config';
import { createLogger } from '@domains-all/log';
import type { Db } from '../_lib/db';
import { fixtureFetch } from '../_lib/fixtures';
import { type JobDefinition, type RunOptions, runJob } from '../_lib/run';

export const quietLog = createLogger({ name: 'test', level: 'silent' });

export function testEnv(extra: Record<string, string> = {}): ServerEnv {
  return parseServerEnv({ MOCK_EXTERNALS: '1', PUBLIC_DATA_MODE: 'fixture', ...extra });
}

/** Runs a job against fixtures (or `fetch`), with no waiting between retries. */
export function run(job: JobDefinition, db: Db, opts: Partial<RunOptions> = {}) {
  return runJob(job, {
    db,
    env: testEnv(),
    log: quietLog,
    fetch: fixtureFetch,
    sleep: async () => undefined,
    ...opts,
  });
}

/** Wraps the fixture fetch so tests can override single hosts. */
export function fetchWith(
  overrides: Record<string, (url: URL) => Response | Promise<Response>>,
): typeof fetch {
  return (async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const handler = overrides[url.host];
    return handler ? handler(url) : fixtureFetch(input, init);
  }) as typeof fetch;
}

export async function one<T>(db: Db, sql: string, params: unknown[] = []): Promise<T> {
  const [row] = await db.query<T>(sql, params);
  return row as T;
}
