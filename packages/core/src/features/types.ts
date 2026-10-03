// Site profile (spec 003 tech §3). Persisted as `searches.features`; contains no description text.
import type { FeatureFlag } from '@domains-all/jev';

export interface Detected<T extends string = string> {
  value: T;
  confidence: number;
  alternatives: Array<{ value: T; p: number }>;
  /** True when the user set this value (preference or chip edit), not the detector. */
  edited: boolean;
  /** Where the value came from; `rules` when Jev could not answer this field. */
  source: 'jev' | 'rules' | 'user';
  unsure: boolean;
}

export type SensitiveCategory = 'adult' | 'gambling' | 'crypto' | 'health' | 'finance';

export interface SiteProfile {
  siteType: Detected;
  industry: Detected;
  audience: Detected;
  geo: Detected;
  language: Detected;
  tone: {
    score: number;
    level: 0 | 1 | 2 | 3 | 4;
    confidence: number;
    edited: boolean;
    source: 'jev' | 'rules';
  };
  nameStyle: Detected;
  clarity: { score: number; tooVague: boolean };
  flags: Record<FeatureFlag, { p: number; on: boolean; edited: boolean }>;
  sensitive: SensitiveCategory[];
  source: 'jev' | 'rules';
  catalogVersions: Record<string, number>;
}

/** Plain detector output before thresholds and user overrides are applied. */
export interface RawFeatures {
  siteType: Record<string, number>;
  industry: Record<string, number>;
  audience: Record<string, number>;
  geo: Record<string, number>;
  language: Record<string, number>;
  nameStyle: Record<string, number>;
  tone: number; // 0–4
  clarity: number; // 0–3
  flags: Record<string, number>;
  safety: { phishing: number; illegal: number; impersonation: number; adult: number };
  gambling: boolean;
}
