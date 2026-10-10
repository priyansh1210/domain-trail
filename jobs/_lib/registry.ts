// Every scheduled job by name (spec 010 tech §5.1). Workflows call `pnpm job <name>`.
import { backup } from '../backup';
import { brandList } from '../brand-list';
import { cleanup } from '../cleanup';
import { nrdIngest } from '../nrd-ingest';
import { refreshFreeProviders } from '../refresh-free-providers';
import { refreshPrices } from '../refresh-prices';
import { tldRegistry } from '../tld-registry';
import { tuneWeights } from '../tune-weights';
import { usageReport } from '../usage-report';
import { watchlist } from '../watchlist';
import type { JobDefinition, JobName } from './run';

export const JOBS: Record<JobName, JobDefinition> = {
  'tld-registry': tldRegistry,
  'refresh-prices': refreshPrices,
  'nrd-ingest': nrdIngest,
  'refresh-free-providers': refreshFreeProviders,
  'brand-list': brandList,
  cleanup,
  backup,
  'usage-report': usageReport,
  'tune-weights': tuneWeights,
  watchlist,
};

export const isJobName = (s: string): s is JobName => Object.hasOwn(JOBS, s);
