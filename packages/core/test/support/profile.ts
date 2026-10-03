// Shared test helpers: a site profile from the rule-based detector, and a scripted decision service.
import type { Answer, AskParams, AskResult, DecisionService } from '@domains-all/jev';
import { interpretFeatures } from '../../src/features/interpret';
import { detectByRules } from '../../src/features/rules';

export const profileFor = (description: string, country = 'auto') =>
  interpretFeatures({ answers: {}, rules: detectByRules(description), prefs: { country }, refs: {} });

/** Answers questions with `answer(name, params)`; returns failures for names it leaves undefined. */
export function scriptedJev(
  answer: (name: string, params: AskParams) => Answer | undefined,
): DecisionService & { calls: AskParams[] } {
  const calls: AskParams[] = [];
  return {
    calls,
    breakerState: () => 'closed',
    recordSearch: async () => undefined,
    async ask(params): Promise<AskResult> {
      calls.push(params);
      const answers: Record<string, Answer> = {};
      const failed: string[] = [];
      for (const q of params.questions) {
        const a = answer(q.name, params);
        if (a) answers[q.name] = a;
        else failed.push(q.name);
      }
      return {
        answers,
        failed,
        usage: { inputTokens: 100, requests: 1 },
        requestIds: [],
        degraded: failed.length > 0,
        ...(failed.length ? { degradedReason: 'jev_unavailable' as const } : {}),
        modelVersion: 'jev-1.13.0',
        refs: {},
      };
    },
  };
}

export const failingJev = () => scriptedJev(() => undefined);
