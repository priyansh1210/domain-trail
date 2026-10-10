// Chip labels for a site profile (spec 003 US-1, FR-FEAT-010). Browser-safe: catalog data and taxonomy only.
import { INDUSTRY_OPTIONS, type SiteProfile } from '@domains-all/core/client';
import { audience, COUNTRIES, LANGUAGES, siteType } from '@domains-all/jev/catalog';
import { messages, t } from './i18n';

export interface Chip {
  id: string;
  kind: string;
  label: string;
  unsure: boolean;
  alternatives: string[];
}

const options = (def: { criteria: Record<string, string> | 'runtime' }) =>
  def.criteria === 'runtime' ? {} : def.criteria;
const SITE_TYPES = options(siteType);
const AUDIENCES = options(audience);
const REGIONS = messages.chips.regions as Record<string, string>;

export function geoLabel(key: string): string {
  if (key.startsWith('country_')) return COUNTRIES[key.slice(8)] ?? key;
  return REGIONS[key] ?? key;
}

const label = {
  siteType: (k: string) => SITE_TYPES[k] ?? k,
  industry: (k: string) => INDUSTRY_OPTIONS[k] ?? k,
  audience: (k: string) => AUDIENCES[k] ?? k,
  geo: geoLabel,
  language: (k: string) => LANGUAGES[k] ?? k,
  nameStyle: (k: string) => (messages.chips.nameStyles as Record<string, string>)[k] ?? k,
};

type Field = keyof typeof label;

/** Display text for one option of an editable field (chip editor). */
export function optionLabel(field: Field, key: string): string {
  return label[field](key);
}

export const EDITABLE_FIELDS: readonly Field[] = [
  'siteType',
  'industry',
  'audience',
  'geo',
  'language',
  'nameStyle',
];

export function flagLabel(key: string): string {
  return (messages.chips.flags as Record<string, string>)[key] ?? key;
}
const FIELDS: Field[] = ['siteType', 'industry', 'audience', 'geo', 'language', 'nameStyle'];
const MAX_FLAG_CHIPS = 8;

export function profileChips(p: SiteProfile): Chip[] {
  const chips: Chip[] = FIELDS.map((field) => {
    const d = p[field];
    return {
      id: field,
      kind: t(`chips.${field}`),
      label: label[field](d.value),
      unsure: d.unsure,
      alternatives: d.alternatives.map((a) => label[field](a.value)),
    };
  });
  chips.splice(5, 0, {
    id: 'tone',
    kind: t('chips.tone'),
    label: messages.chips.toneLevels[p.tone.level] ?? '',
    unsure: p.tone.source === 'rules',
    alternatives: [],
  });
  const flags = Object.entries(p.flags)
    .filter(([, f]) => f.on)
    .sort((a, b) => b[1].p - a[1].p)
    .slice(0, MAX_FLAG_CHIPS)
    .map(([key, f]) => ({
      id: key,
      kind: '',
      label: (messages.chips.flags as Record<string, string>)[key] ?? key,
      unsure: f.p < 0.7,
      alternatives: [],
    }));
  return [...chips, ...flags];
}
