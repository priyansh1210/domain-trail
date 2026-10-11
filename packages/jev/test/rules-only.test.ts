// Searches without AI answers (FR-JEV-018, 021): nothing is sent, every question falls back, nothing is degraded.
import { describe, expect, it } from 'vitest';
import { flags, profile, safety } from '../src/catalog';
import { rulesOnly } from '../src/service';
import { buildState } from '../src/state';

describe('rulesOnly', () => {
  it('answers no question and reports no degradation or usage', async () => {
    const questions = [...safety, ...profile, ...flags].map((def) => ({ name: def.id, def }));
    const r = await rulesOnly().ask({
      state: buildState('S1', { description: 'Neighborhood bakery delivering sourdough bread and cakes' }),
      questions,
      deadline: Date.now() + 4000,
      searchId: 's',
    });
    expect(r.answers).toEqual({});
    expect(r.failed).toEqual(questions.map((q) => q.name));
    expect(r.degraded).toBe(false);
    expect(r.degradedReason).toBeUndefined();
    expect(r.usage).toEqual({ inputTokens: 0, requests: 0 });
    expect(Object.keys(r.refs)).toEqual(questions.map((q) => q.name));
  });
});
