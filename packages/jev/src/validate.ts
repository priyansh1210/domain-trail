// Answer validation (spec 002 tech §5.4, FR-JEV-004): malformed answers are failures, never guesses.
import { z } from 'zod';
import type { Answer, WireQuestion } from './types';

const SUM_TOLERANCE = 0.02;
const prob = z.number().min(0).max(1);

const choiceSchema = z.object({
  type: z.literal('choice'),
  choice: z.string(),
  probabilities: z.record(z.string(), prob),
  confidence: prob,
});
const scoreSchema = z.object({
  type: z.literal('score'),
  score: z.number().min(0),
  probabilities: z.union([z.array(prob), z.record(z.string(), prob)]),
  legend: z.record(z.string(), z.string()).optional(),
  confidence: prob,
});
const noulSchema = z.object({ type: z.literal('noul'), noul: prob });

export type Validation = { ok: true; answer: Answer } | { ok: false; reason: string };

function normalized(values: number[]): number[] | null {
  const sum = values.reduce((a, b) => a + b, 0);
  if (sum <= 0 || Math.abs(sum - 1) > SUM_TOLERANCE) return null;
  return values.map((v) => v / sum);
}

export function validateAnswer(raw: unknown, question: WireQuestion): Validation {
  if (question.type === 'noul') {
    const r = noulSchema.safeParse(raw);
    return r.success ? { ok: true, answer: r.data } : { ok: false, reason: 'shape' };
  }

  if (question.type === 'choice') {
    const r = choiceSchema.safeParse(raw);
    if (!r.success) return { ok: false, reason: 'shape' };
    const keys = Object.keys(question.criteria);
    if (!keys.includes(r.data.choice)) return { ok: false, reason: 'unknown_choice' };
    const entries = Object.entries(r.data.probabilities);
    if (entries.some(([k]) => !keys.includes(k))) return { ok: false, reason: 'unknown_key' };
    const norm = normalized(entries.map(([, p]) => p));
    if (!norm) return { ok: false, reason: 'probability_sum' };
    const probabilities = Object.fromEntries(entries.map(([k], i) => [k, norm[i]!]));
    return { ok: true, answer: { ...r.data, probabilities } };
  }

  const r = scoreSchema.safeParse(raw);
  if (!r.success) return { ok: false, reason: 'shape' };
  const levels = question.criteria.length;
  if (r.data.score > levels - 1) return { ok: false, reason: 'score_range' };
  // R-01: the probability shape is unconfirmed — accept an array or an object keyed by level index.
  const values = Array.isArray(r.data.probabilities)
    ? r.data.probabilities
    : Array.from({ length: levels }, (_, i) => {
        const p = r.data.probabilities as Record<string, number>;
        return p[String(i)] ?? p[question.criteria[i]!] ?? 0;
      });
  if (values.length !== levels) return { ok: false, reason: 'levels' };
  const norm = normalized(values);
  if (!norm) return { ok: false, reason: 'probability_sum' };
  return { ok: true, answer: { ...r.data, probabilities: norm } };
}
