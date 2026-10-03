// Curated free providers (spec 007 tech §3, §5.1–5.2; FR-FREE-001, 002, 009). Adding a provider means adding an
// entry to data/providers.json (and a checker only for a new check method).
import seed from '../data/providers.json';

export type ProviderKind = 'subdomain_service' | 'community_registry' | 'platform_address';
export type CheckMethod = 'github_list' | 'doh' | 'none';

export interface Eligibility {
  /** At least one of these flags or site types must match (when either list is given). */
  anyFlags?: string[];
  anySiteTypes?: string[];
  /** Every one of these flags must be on. */
  allFlags?: string[];
  excludeFlags?: string[];
  note: string;
}

export interface FreeProvider {
  id: string;
  name: string;
  suffix: string;
  kind: ProviderKind;
  eligibility: Eligibility;
  /** Steps with `{label}` placeholders (FR-FREE-004). */
  steps: string[];
  waitTime: string;
  officialUrl: string;
  checkMethod: CheckMethod;
  checkConfig?: { format?: 'tree' | 'js_keys'; url?: string; prefix?: string; ext?: string; type?: 'NS' | 'A' };
  healthy: boolean;
  healthNote?: string;
}

export const PROVIDERS = seed.providers as FreeProvider[];
export const PROVIDERS_REVIEWED_AT = seed.reviewedAt;

export interface ProfileForFree {
  siteType: string;
  flagsOn: readonly string[];
  /** Adult or otherwise sensitive sites get no free providers (spec 007 tech §5.2). */
  sensitive: boolean;
}

export function eligible(p: FreeProvider, profile: ProfileForFree): boolean {
  if (!p.healthy || profile.sensitive) return false;
  const on = new Set(profile.flagsOn);
  const e = p.eligibility;
  if (e.excludeFlags?.some((f) => on.has(f))) return false;
  if (e.allFlags && !e.allFlags.every((f) => on.has(f))) return false;
  const anyGiven = (e.anyFlags?.length ?? 0) + (e.anySiteTypes?.length ?? 0) > 0;
  if (!anyGiven) return true;
  return !!e.anyFlags?.some((f) => on.has(f)) || !!e.anySiteTypes?.includes(profile.siteType);
}

/** Providers whose rules fit the detected website (FR-FREE-002). */
export function selectProviders(profile: ProfileForFree, providers: readonly FreeProvider[] = PROVIDERS): FreeProvider[] {
  return providers.filter((p) => eligible(p, profile));
}
