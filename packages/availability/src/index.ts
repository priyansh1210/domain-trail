// Public surface of the availability package (spec 005).
export { type AvailabilityCache, makeResult, MemoryAvailabilityCache } from './cache';
export {
  type CheckContext,
  type Checker,
  type CheckerOptions,
  type CheckStats,
  createChecker,
  type DailyCounter,
  MemoryDailyCounter,
} from './checker';
export { createDirectorySource, type DirectorySource, IANA_RDAP_URL, RdapDirectory } from './directory';
export { type DohAnswer, dohNs, dohQuery, nsVerdict, resolves } from './doh';
export { fixtureFetch, fixtureTaken } from './fixture';
export { HostLimiter, Semaphore } from './limiter';
export { classifyRecord, rdapLookup, type RdapOutcome } from './rdap';
export { type CheckMethod, type CheckResult, type CheckStatus, REGISTRABLE, splitFqdn } from './types';
