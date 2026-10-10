// Chip editing (spec 003 FR-FEAT-011, US-2): a signed-in user changes or removes detected features and the results
// are ranked again with the edited profile, without running detection again. Values must come from the same
// catalogs the detector uses, so an edited profile is always one the pipeline understands. Browser-safe.
import type { ChoiceDef } from '@domains-all/jev';
import { audience, FLAG_STATEMENTS, geoScope, language, nameStyle, siteType } from '@domains-all/jev/catalog';
import * as z from 'zod/mini';
import { INDUSTRY_OPTIONS } from './seed/taxonomy';
import type { Detected, SiteProfile } from './types';

const keys = (def: ChoiceDef) => (def.criteria === 'runtime' ? [] : Object.keys(def.criteria));

/** Allowed values per editable field (the same option lists the chips show). */
export const EDIT_OPTIONS = {
  siteType: keys(siteType),
  industry: Object.keys(INDUSTRY_OPTIONS),
  audience: keys(audience),
  geo: keys(geoScope),
  language: keys(language),
  nameStyle: keys(nameStyle),
} as const;

export const FLAG_KEYS = Object.keys(FLAG_STATEMENTS);

const oneOf = (values: readonly string[]) =>
  z.optional(z.string().check(z.refine((v) => values.includes(v), 'unknown value')));

export const FeatureEditsSchema = z.object({
  siteType: oneOf(EDIT_OPTIONS.siteType),
  industry: oneOf(EDIT_OPTIONS.industry),
  audience: oneOf(EDIT_OPTIONS.audience),
  geo: oneOf(EDIT_OPTIONS.geo),
  language: oneOf(EDIT_OPTIONS.language),
  nameStyle: oneOf(EDIT_OPTIONS.nameStyle),
  tone: z.optional(z.int().check(z.minimum(0), z.maximum(4))),
  flags: z.optional(
    z.record(z.string().check(z.refine((k) => FLAG_KEYS.includes(k), 'unknown feature')), z.boolean()),
  ),
});

export type FeatureEdits = z.infer<typeof FeatureEditsSchema>;

function edited(d: Detected, value: string | undefined): Detected {
  if (value === undefined || value === d.value) return d;
  return { value, confidence: 1, alternatives: [], edited: true, source: 'user', unsure: false };
}

/** The profile with the user's edits applied and marked as edited (spec 003 §6: "which values were edited"). */
export function applyFeatureEdits(p: SiteProfile, e: FeatureEdits): SiteProfile {
  const flags = { ...p.flags };
  for (const [key, on] of Object.entries(e.flags ?? {})) {
    const cur = flags[key as keyof typeof flags];
    flags[key as keyof typeof flags] = { p: cur?.p ?? (on ? 1 : 0), on, edited: true };
  }
  return {
    ...p,
    siteType: edited(p.siteType, e.siteType),
    industry: edited(p.industry, e.industry),
    audience: edited(p.audience, e.audience),
    geo: edited(p.geo, e.geo),
    language: edited(p.language, e.language),
    nameStyle: edited(p.nameStyle, e.nameStyle),
    tone:
      e.tone === undefined || e.tone === p.tone.level
        ? p.tone
        : {
            ...p.tone,
            level: e.tone as SiteProfile['tone']['level'],
            score: e.tone,
            confidence: 1,
            edited: true,
          },
    flags,
  };
}

/** True when the edits change anything at all. */
export function hasEdits(p: SiteProfile, e: FeatureEdits): boolean {
  return JSON.stringify(applyFeatureEdits(p, e)) !== JSON.stringify(p);
}
