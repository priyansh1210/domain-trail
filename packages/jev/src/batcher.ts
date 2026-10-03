// Groups questions into as few requests as the limits allow, balanced so parallel requests finish together
// (spec 002 tech §5.1, FR-JEV-012).
import type { WireQuestion } from './types';
import { estimateTokens } from './wire';

export interface BatchLimits {
  maxQuestions: number; // per request (R-01: 50 until confirmed)
  maxRequestTokens: number; // state + all questions
  maxStatePlusQuestionTokens: number; // "state + longest question ≤ 32k"
}

export const DEFAULT_LIMITS: BatchLimits = {
  maxQuestions: 50,
  maxRequestTokens: 60_000,
  maxStatePlusQuestionTokens: 31_000,
};

export type Batch = Array<[name: string, question: WireQuestion]>;

export function batchQuestions(
  state: unknown,
  questions: Array<[string, WireQuestion]>,
  limits: BatchLimits = DEFAULT_LIMITS,
): Batch[] {
  if (questions.length === 0) return [];
  const stateTokens = estimateTokens(state);
  const sized = questions
    .map(([name, q]) => ({ name, q, tokens: estimateTokens(q) }))
    .sort((a, b) => b.tokens - a.tokens || a.name.localeCompare(b.name));

  for (let n = Math.ceil(sized.length / limits.maxQuestions); n <= sized.length; n++) {
    const cap = Math.ceil(sized.length / n);
    const bins = Array.from({ length: n }, () => ({ items: [] as typeof sized, tokens: stateTokens }));
    let fits = true;
    for (const item of sized) {
      // Oversized single questions still get their own request; the API decides.
      const candidates = bins
        .filter(
          (b) =>
            b.items.length < cap &&
            (b.items.length === 0 ||
              (b.tokens + item.tokens <= limits.maxRequestTokens &&
                stateTokens + item.tokens <= limits.maxStatePlusQuestionTokens)),
        )
        .sort((a, b) => a.tokens - b.tokens);
      const bin = candidates[0];
      if (!bin) {
        fits = false;
        break;
      }
      bin.items.push(item);
      bin.tokens += item.tokens;
    }
    if (fits) return bins.filter((b) => b.items.length > 0).map((b) => b.items.map((i) => [i.name, i.q]));
  }
  return sized.map((i) => [[i.name, i.q]]);
}
