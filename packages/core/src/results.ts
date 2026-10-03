// Result shape shared by the server stream and the results page (spec 009 tech §3). Types only plus the section
// order, so browser code can import it without pulling in availability, pricing or word data.
import type { CheckStatus } from '@domains-all/availability';
import type { PricedResult, Restriction, Tier } from '@domains-all/pricing';
import type { Reason } from './ranking/score';

export type Section = Tier | 'unpriced';

/** Display order: Free · $1–100 · $101–300 · $300+ · Price at registrar (FR-UX-002). */
export const SECTIONS: readonly Section[] = ['free', 'budget', 'mid', 'premium', 'unpriced'];

export interface FreeConditions {
  steps: string[];
  waitTime: string;
  eligibility: string;
  url: string;
}

export interface ResultItem {
  fqdn: string;
  label: string;
  tld: string;
  section: Section;
  status: CheckStatus | 'appears_free' | 'not_verifiable';
  checkedAt: string;
  price?: Omit<PricedResult, 'priced' | 'tier' | 'restriction' | 'requiresHttps'>;
  restriction?: Restriction;
  requiresHttps?: boolean;
  free?: {
    providerId: string;
    providerName: string;
    kind: 'subdomain_service' | 'community_registry' | 'platform_address';
    conditions: FreeConditions;
  };
  score: number;
  reasons: Reason[];
  strategy: string;
  source: 'jev' | 'deterministic';
}
