// In MOCK_EXTERNALS mode the mock Jev answers profile and safety questions from the rule-based detector, so
// local development and preview deployments show sensible chips without an API key (spec 002 FR-JEV-014).
import type { Answer, MockHint, WireQuestion } from '@domains-all/jev';
import { detectByRules } from './rules';
import type { RawFeatures } from './types';

const cache = new Map<string, RawFeatures>();
function rulesFor(description: string): RawFeatures {
  let r = cache.get(description);
  if (!r) {
    r = detectByRules(description);
    if (cache.size > 200) cache.clear();
    cache.set(description, r);
  }
  return r;
}

const round = (p: number) => Math.round(p * 1e6) / 1e6;

function choice(dist: Record<string, number>, q: Extract<WireQuestion, { type: 'choice' }>): Answer {
  const keys = Object.keys(q.criteria);
  const probs = keys.map((k) => 0.85 * (dist[k] ?? 0) + 0.15 / keys.length);
  const sum = probs.reduce((a, b) => a + b, 0);
  const norm = probs.map((p) => p / sum);
  let best = 0;
  norm.forEach((p, i) => {
    if (p > norm[best]!) best = i;
  });
  return {
    type: 'choice',
    choice: keys[best]!,
    probabilities: Object.fromEntries(keys.map((k, i) => [k, round(norm[i]!)])),
    confidence: round(norm[best]!),
  };
}

/** Probability vector over `n` levels whose expected value is `value` (spread over the two nearest levels). */
function levels(value: number, n: number): Answer {
  const v = Math.max(0, Math.min(n - 1, value));
  const lo = Math.floor(v);
  const hi = Math.min(n - 1, lo + 1);
  const probabilities = Array.from({ length: n }, () => 0);
  probabilities[lo] = round(hi === lo ? 1 : hi - v);
  if (hi !== lo) probabilities[hi] = round(v - lo);
  return { type: 'score', score: round(v), probabilities, confidence: 0.7 };
}

export const rulesMockHint: MockHint = (name, q, state) => {
  const description = (state as { description?: unknown })?.description;
  if (typeof description !== 'string') return undefined;
  const r = rulesFor(description);
  const dists: Record<string, Record<string, number>> = {
    site_type: r.siteType,
    industry: r.industry,
    audience: r.audience,
    geo_scope: r.geo,
    language: r.language,
    name_style: r.nameStyle,
  };
  if (q.type === 'choice' && dists[name]) return choice(dists[name]!, q);
  if (q.type === 'score' && name === 'tone') return levels(r.tone, q.criteria.length);
  if (q.type === 'score' && name === 'clarity') return levels(r.clarity, q.criteria.length);
  if (q.type === 'noul') {
    const safety: Record<string, number> = {
      safety_phishing: r.safety.phishing,
      safety_illegal: r.safety.illegal,
      safety_impersonation: r.safety.impersonation,
      safety_adult: r.safety.adult,
    };
    const p = safety[name] ?? r.flags[name];
    if (p !== undefined) return { type: 'noul', noul: p };
  }
  return undefined;
};
