// Availability results (spec 005 tech §4). Statuses follow FR-AVL-003.

export type CheckStatus =
  | 'available'
  | 'likely_available' // no registry RDAP for this extension; DNS has no record (FR-AVL-008)
  | 'available_premium'
  | 'taken'
  | 'dropping_soon'
  | 'unknown';

export type CheckMethod = 'dns' | 'rdap' | 'registrar' | 'nrd' | 'cache';

export interface CheckResult {
  fqdn: string;
  tld: string;
  status: CheckStatus;
  method: CheckMethod;
  checkedAt: string;
  expiresAt: string;
  premium?: { priceCents: number; currency: string; source: string };
  dropWindow?: { start: string; end: string };
}

/** `label.tld`, where the extension may have two levels (`co.in`). Names are built by us, so the split is safe. */
export function splitFqdn(fqdn: string): { label: string; tld: string } {
  const dot = fqdn.indexOf('.');
  return { label: fqdn.slice(0, dot), tld: fqdn.slice(dot + 1) };
}

/** Statuses a visitor may act on as "free to register" (ranking and sections treat the rest differently). */
export const REGISTRABLE: ReadonlySet<CheckStatus> = new Set([
  'available',
  'likely_available',
  'available_premium',
]);
