// Spec 002 tech §11 `contract.test.ts` (FR-JEV-004, FR-JEV-014).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
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

describe('contract (FR-JEV-004, 014)', () => {
  const schema = JSON.parse(
    readFileSync(
      join(
        import.meta.dirname,
        '..',
        '..',
        '..',
        'specs',
        '002-jev-integration',
        'contracts',
        'jev-systemone.schema.json',
      ),
      'utf8',
    ),
  ) as Record<string, unknown>;
  const ajv = new Ajv2020({ strict: false });
  ajv.addSchema(schema, 'jev');
  const validRequest = ajv.compile({ $ref: 'jev#/properties/request' });
  const validResponse = ajv.compile({ $ref: 'jev#/properties/response' });

  it('sends requests and receives mock responses that match the published contract', async () => {
    const mock = createMockTransport({ model: 'jev-1.13.0' });
    const { svc, sent } = service(mock);
    await svc.ask({ state, questions: s1Questions(), deadline: deadline(), searchId: 's' });
    for (const body of sent) {
      expect(validRequest(body), JSON.stringify(validRequest.errors)).toBe(true);
      const res = await mock.send(body, { deadline: deadline(), searchId: 's' });
      expect(res.ok && validResponse(res.response), JSON.stringify(validResponse.errors)).toBe(true);
    }
  });
});
