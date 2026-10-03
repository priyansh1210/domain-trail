// Mock Jev for MOCK_EXTERNALS=1 (FR-JEV-014, spec 016 FR-QA-003): answers every question locally with
// contract-valid, deterministic responses, so tests, local development and preview deployments need no network
// or API key. A `hint` hook lets callers (e.g. the rule-based feature detector) supply better answers.
import type { Transport } from './transport';
import type { Answer, SystemOneRequest, WireQuestion } from './types';
import { estimateTokens } from './wire';

export type MockHint = (name: string, question: WireQuestion, state: unknown) => Answer | undefined;

const STOP = new Set(
  'a an and are as at be by for from has have in is it its of on or that the this to was were will with website described your our their'.split(
    ' ',
  ),
);

export function tokens(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
    if (raw.length < 3 || STOP.has(raw)) continue;
    out.add(raw.replace(/(ies)$/, 'y').replace(/(es|s|ing|ed)$/, '') || raw);
  }
  return out;
}

function stateText(state: unknown): string {
  if (typeof state === 'string') return state;
  const parts: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === 'string') parts.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(state);
  return parts.join(' ');
}

function overlap(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const t of b) if (a.has(t)) n++;
  return n;
}

const round = (p: number) => Math.round(p * 1e6) / 1e6;

export function genericAnswer(question: WireQuestion, state: unknown): Answer {
  const st = tokens(stateText(state));
  if (question.type === 'noul') {
    const hits = overlap(st, tokens(question.instructions));
    return { type: 'noul', noul: round(Math.min(0.95, 0.08 + 0.3 * hits)) };
  }
  if (question.type === 'score') {
    const n = question.criteria.length;
    const mid = Math.floor((n - 1) / 2);
    const raw = question.criteria.map((_, i) => (i === mid ? 0.6 : 0.4 / (n - 1)));
    return {
      type: 'score',
      score: round(raw.reduce((acc, p, i) => acc + p * i, 0)),
      probabilities: raw.map(round),
      confidence: 0.6,
    };
  }
  const keys = Object.keys(question.criteria);
  const scores = keys.map((k) => overlap(st, tokens(`${k.replace(/_/g, ' ')} ${question.criteria[k]}`)));
  const exps = scores.map((s) => Math.exp(1.5 * s));
  const sum = exps.reduce((a, b) => a + b, 0);
  const probs = exps.map((e) => e / sum);
  let best = 0;
  probs.forEach((p, i) => {
    if (p > probs[best]!) best = i;
  });
  return {
    type: 'choice',
    choice: keys[best]!,
    probabilities: Object.fromEntries(keys.map((k, i) => [k, round(probs[i]!)])),
    confidence: round(probs[best]!),
  };
}

export function createMockTransport(opts: { hint?: MockHint; model: string; latencyMs?: number }): Transport {
  return {
    async send(body: SystemOneRequest) {
      if (opts.latencyMs) await new Promise((r) => setTimeout(r, opts.latencyMs));
      const answers: Record<string, Answer> = {};
      for (const [name, q] of Object.entries(body.questions)) {
        answers[name] = opts.hint?.(name, q, body.state) ?? genericAnswer(q, body.state);
      }
      return {
        ok: true,
        response: {
          model: opts.model,
          answers,
          usage: { input_tokens: estimateTokens(body), output_tokens: 0 },
        },
        requestId: 'mock',
        latencyMs: opts.latencyMs ?? 0,
      };
    },
  };
}
