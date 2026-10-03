// Spec 002 tech §11 `memo.test.ts` (FR-JEV-017).
import { describe, expect, it } from 'vitest';
import { CircuitBreaker } from '../src/breaker';
import { BudgetGuard, MemoryUsageStore } from '../src/budget';
import { flags, profile, safety } from '../src/catalog';
import { createMockTransport } from '../src/mock';
import { AnswerMemo, createDecisionService } from '../src/service';
import { buildState } from '../src/state';
import type { Transport } from '../src/transport';
import type { AskQuestion, SystemOneRequest } from '../src/types';

const INDUSTRY = { food__bakery: 'Bakery', tech__saas_b2b: 'B2B software', other__other: 'Other' };
const s1Questions = (): AskQuestion[] =>
  [...safety, ...profile, ...flags].map((def) => ({
    name: def.id,
    def,
    ...(def.id === 'industry' ? { criteriaOverride: INDUSTRY } : {}),
  }));

function service(transport: Transport, caps = { monthlyTokens: 1e9, dailyTokens: 1e9 }) {
  const sent: SystemOneRequest[] = [];
  const spy: Transport = {
    send: (body, ctx) => {
      sent.push(body);
      return transport.send(body, ctx);
    },
  };
  const svc = createDecisionService({
    transport: spy,
    breaker: new CircuitBreaker(),
    budget: new BudgetGuard(new MemoryUsageStore(), caps),
    model: 'jev-1.13.0',
  });
  return { svc, sent };
}

const state = buildState('S1', { description: 'Neighborhood bakery delivering sourdough bread and cakes' });
const deadline = () => Date.now() + 4000;

describe('answer memo', () => {
  it('reuses answers within a search (FR-JEV-017)', async () => {
    const { svc, sent } = service(createMockTransport({ model: 'jev-1.13.0' }));
    const memo = new AnswerMemo();
    await svc.ask({ state, questions: s1Questions(), deadline: deadline(), searchId: 's', memo });
    const again = await svc.ask({
      state,
      questions: s1Questions(),
      deadline: deadline(),
      searchId: 's',
      memo,
    });
    expect(sent).toHaveLength(2);
    expect(Object.keys(again.answers)).toHaveLength(52);
  });
});
