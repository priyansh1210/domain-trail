// Decision service behaviour: batching into requests, partial failures, budget and outage fallbacks
// (FR-JEV-001, 009, 016; NFR-JEV-005).
import { describe, expect, it, vi } from 'vitest';
import { CircuitBreaker } from '../src/breaker';
import { BudgetGuard, MemoryUsageStore } from '../src/budget';
import { flags, profile, safety } from '../src/catalog';
import { createMockTransport } from '../src/mock';
import { createDecisionService } from '../src/service';
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

describe('decision service', () => {
  it('answers all S1 questions in two parallel requests with id@version refs', async () => {
    const { svc, sent } = service(createMockTransport({ model: 'jev-1.13.0' }));
    const r = await svc.ask({ state, questions: s1Questions(), deadline: deadline(), searchId: 's' });
    expect(r.failed).toEqual([]);
    expect(r.degraded).toBe(false);
    expect(Object.keys(r.answers)).toHaveLength(52);
    expect(sent).toHaveLength(2);
    expect(r.refs.site_type).toBe('site_type@1');
    expect(r.usage.requests).toBe(2);
  });

  it('marks everything failed when Jev is down (fallback path, NFR-JEV-005)', async () => {
    const { svc } = service({ send: async () => ({ ok: false, error: 'retryable', status: 503 }) });
    const r = await svc.ask({ state, questions: s1Questions(), deadline: deadline(), searchId: 's' });
    expect(r.failed).toHaveLength(52);
    expect(r).toMatchObject({ degraded: true, degradedReason: 'jev_unavailable' });
  });

  it('fails only the questions whose answers are malformed', async () => {
    const mock = createMockTransport({ model: 'jev-1.13.0' });
    const { svc } = service({
      send: async (body, ctx) => {
        const res = await mock.send(body, ctx);
        if (res.ok && res.response.answers.tone) res.response.answers.tone = { type: 'score', score: 9 };
        return res;
      },
    });
    const r = await svc.ask({ state, questions: s1Questions(), deadline: deadline(), searchId: 's' });
    expect(r.failed).toEqual(['tone']);
  });

  it('switches to degraded mode instead of exceeding the budget (FR-JEV-009)', async () => {
    const send = vi.fn();
    const { svc } = service({ send }, { monthlyTokens: 100, dailyTokens: 100 });
    const r = await svc.ask({ state, questions: s1Questions(), deadline: deadline(), searchId: 's' });
    expect(send).not.toHaveBeenCalled();
    expect(r).toMatchObject({ degraded: true, degradedReason: 'budget' });
  });
});
