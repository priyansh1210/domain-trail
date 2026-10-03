// Turns catalog definitions into wire questions (contract `Question`).
import type { AskQuestion, WireQuestion } from './types';

const NAME = /^[a-z0-9_]{1,80}$/;
const KEY = /^[a-z0-9_]{1,64}$/;

export function fillVars(text: string, vars: Record<string, string> = {}): string {
  return text.replace(/\{(\w+)\}/g, (match, key: string) => {
    const value = vars[key];
    if (value === undefined) throw new Error(`missing value for {${key}}`);
    return value;
  });
}

export function toWire(q: AskQuestion): WireQuestion {
  if (!NAME.test(q.name)) throw new Error(`invalid question name: ${q.name}`);
  const instructions = fillVars(q.def.instructions, q.vars);

  if (q.def.type === 'noul') return { type: 'noul', instructions };

  if (q.def.type === 'score') {
    const criteria = Array.isArray(q.criteriaOverride) ? q.criteriaOverride : q.def.criteria;
    if (criteria.length < 2 || criteria.length > 10) throw new Error(`${q.name}: score needs 2–10 levels`);
    return { type: 'score', instructions, criteria };
  }

  const criteria =
    q.criteriaOverride && !Array.isArray(q.criteriaOverride)
      ? q.criteriaOverride
      : q.def.criteria === 'runtime'
        ? undefined
        : q.def.criteria;
  if (!criteria) throw new Error(`${q.name}: options must be supplied at runtime`);
  const keys = Object.keys(criteria);
  if (keys.length < 2 || keys.length > 255) throw new Error(`${q.name}: choice needs 2–255 options`);
  const badKey = keys.find((k) => !KEY.test(k));
  if (badKey) throw new Error(`${q.name}: invalid option key ${badKey}`);
  return { type: 'choice', instructions, criteria };
}

/** Rough token estimate used only for batching and budget pre-checks (tech §5.1: chars / 3.5). */
export function estimateTokens(value: unknown): number {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return Math.ceil(text.length / 3.5);
}
