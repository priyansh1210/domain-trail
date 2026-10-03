// TLD pool (spec 003 tech §5.3, FR-FEAT-013): ≤ 80 extensions that suit the site, input to `tld_fit@1` and pairing.
import { TAXONOMY } from '../features/seed/taxonomy';
import type { SiteProfile } from '../features/types';
import { ADULT_TLDS, BASE_TLDS, FLAG_TLDS, GEO_TLDS, TLD_INFO } from './tlds';

export const MAX_POOL = 80;

export function buildTldPool(
  profile: SiteProfile,
  prefs: { preferredTlds: readonly string[]; country: string },
): string[] {
  const pool: string[] = [];
  const add = (tld: string) => {
    const t = tld.toLowerCase().replace(/^\./, '');
    if (!pool.includes(t)) pool.push(t);
  };
  const geo =
    prefs.country !== 'auto'
      ? prefs.country === 'global'
        ? 'global'
        : `country_${prefs.country}`
      : profile.geo.value;
  const local = GEO_TLDS[geo] ?? [];

  prefs.preferredTlds.forEach(add); // the user's choices first
  if (profile.flags.feat_local?.on) local.forEach(add); // local businesses: country extension promoted
  BASE_TLDS.forEach(add);
  local.forEach(add);
  Object.entries(profile.flags)
    .filter(([, f]) => f.on)
    .sort((a, b) => b[1].p - a[1].p)
    .forEach(([flag]) => (FLAG_TLDS[flag] ?? []).forEach(add));
  (TAXONOMY.find((i) => i.key === profile.industry.value)?.tldHints ?? []).forEach(add);

  const adult = profile.sensitive.includes('adult');
  return pool
    .filter(
      (t) => (TLD_INFO[t] !== undefined || prefs.preferredTlds.includes(t)) && (adult || !ADULT_TLDS.has(t)),
    )
    .slice(0, MAX_POOL);
}

/** `tld_fit@1` options: tld_<name> (dots → underscores) → ".shop — for online stores". */
export function tldOptions(pool: readonly string[]): {
  criteria: Record<string, string>;
  keyToTld: Map<string, string>;
} {
  const criteria: Record<string, string> = {};
  const keyToTld = new Map<string, string>();
  for (const tld of pool) {
    const key = `tld_${tld.replace(/[^a-z0-9]/g, '_')}`;
    criteria[key] = `.${tld} — ${TLD_INFO[tld] ?? 'extension chosen by the user'}`;
    keyToTld.set(key, tld);
  }
  return { criteria, keyToTld };
}
