// Pipeline stage S1: safety + features in one round of Jev requests (spec 000 tech §4, spec 003 tech §1).
import { stageDeadlinesMs } from '@domains-all/config';
import {
  buildState,
  flags,
  profile,
  safety,
  type AnswerMemo,
  type AskQuestion,
  type DecisionService,
  type DegradedReason,
} from '@domains-all/jev';
import { interpretFeatures } from '../features/interpret';
import { detectByRules } from '../features/rules';
import { INDUSTRY_OPTIONS } from '../features/seed/taxonomy';
import type { SiteProfile } from '../features/types';
import type { Preferences } from '../intake/schema';
import { safetyGate } from '../safety/gate';

export interface StageUsage {
  tokens: number;
  requests: number;
}

/** Codes the UI turns into guiding hints (FR-INT-009; texts live in the UI message file, FR-UX-019). */
export type DetailHint = 'offering' | 'audience' | 'place';

export type S1Outcome =
  | { kind: 'refused'; usage: StageUsage }
  | { kind: 'needs_detail'; hints: DetailHint[]; usage: StageUsage; degraded?: DegradedReason }
  | {
      kind: 'features';
      profile: SiteProfile;
      strictBrand: boolean;
      usage: StageUsage;
      degraded?: DegradedReason;
    };

export function s1Questions(): AskQuestion[] {
  return [...safety, ...profile, ...flags].map((def) => ({
    name: def.id,
    def,
    ...(def.id === 'industry' ? { criteriaOverride: INDUSTRY_OPTIONS } : {}),
  }));
}

export async function runS1(ctx: {
  description: string;
  preferences: Preferences;
  searchId: string;
  jev: DecisionService;
  memo?: AnswerMemo;
  now?: () => number;
}): Promise<S1Outcome> {
  const now = ctx.now ?? Date.now;
  const state = buildState('S1', {
    description: ctx.description,
    preferences: { country: ctx.preferences.country, preferredTlds: ctx.preferences.preferredTlds },
  });
  const result = await ctx.jev.ask({
    state,
    questions: s1Questions(),
    deadline: now() + stageDeadlinesMs.S1,
    searchId: ctx.searchId,
    stage: 'S1',
    memo: ctx.memo,
  });
  const usage = { tokens: result.usage.inputTokens, requests: result.usage.requests };
  const rules = detectByRules(ctx.description);
  const degraded = result.degraded ? result.degradedReason : undefined;

  const action = safetyGate(result.answers, rules);
  if (action === 'refuse') return { kind: 'refused', usage };

  const p = interpretFeatures({ answers: result.answers, rules, prefs: ctx.preferences, refs: result.refs });

  if (p.clarity.tooVague && !ctx.preferences.forceSearch) {
    const hints: DetailHint[] = ['offering', 'audience'];
    if (p.geo.value === 'global' && !p.geo.edited) hints.push('place');
    return { kind: 'needs_detail', hints, usage, ...(degraded ? { degraded } : {}) };
  }

  return {
    kind: 'features',
    profile: p,
    strictBrand: action === 'strict_brand',
    usage,
    ...(degraded ? { degraded } : {}),
  };
}
