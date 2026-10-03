// Shared availability answers (FR-AVL-005, FR-AVL-009): availability is public information, so every search reuses
// fresh answers. Memory here; the web app adds a Supabase-backed cache (`domain_checks`) when configured.
import { availability } from '@domains-all/config/defaults';
import type { CheckMethod, CheckResult, CheckStatus } from './types';

export interface AvailabilityCache {
  /** Fresh results only (expiresAt in the future). */
  getMany(fqdns: readonly string[], now: number): Promise<Map<string, CheckResult>>;
  putMany(results: readonly CheckResult[]): Promise<void>;
}

/** Builds a result with the freshness window of its status. */
export function makeResult(
  fqdn: string,
  tld: string,
  status: CheckStatus,
  method: Exclude<CheckMethod, 'cache'>,
  now: number,
  extra: Pick<CheckResult, 'premium' | 'dropWindow'> = {},
): CheckResult {
  return {
    fqdn,
    tld,
    status,
    method,
    checkedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + availability.ttlSeconds[status] * 1000).toISOString(),
    ...extra,
  };
}

/** Bounded in-memory cache; the oldest entries go first when it is full. */
export class MemoryAvailabilityCache implements AvailabilityCache {
  private readonly map = new Map<string, CheckResult>();

  constructor(private readonly maxEntries = 20_000) {}

  async getMany(fqdns: readonly string[], now: number): Promise<Map<string, CheckResult>> {
    const out = new Map<string, CheckResult>();
    for (const fqdn of fqdns) {
      const hit = this.map.get(fqdn);
      if (hit && Date.parse(hit.expiresAt) > now) out.set(fqdn, hit);
    }
    return out;
  }

  async putMany(results: readonly CheckResult[]): Promise<void> {
    for (const r of results) {
      this.map.delete(r.fqdn);
      this.map.set(r.fqdn, r);
    }
    while (this.map.size > this.maxEntries) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }
}
