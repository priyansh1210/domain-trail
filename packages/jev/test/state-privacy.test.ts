// Spec 002 tech §11 `state-privacy.test.ts` (FR-JEV-013).
import { describe, expect, it } from 'vitest';
import { buildState } from '../src/state';

describe('state privacy (FR-JEV-013)', () => {
  it('copies only whitelisted fields into the state', () => {
    const sneaky = {
      description: 'A site',
      email: 'someone@example.com',
      userId: 'u-1',
      ip: '203.0.113.9',
      preferences: { country: 'in', preferredTlds: ['com'], email: 'x@example.com', allowDigits: true },
    } as unknown as Parameters<typeof buildState>[1];
    const s = JSON.stringify(buildState('S1', sneaky));
    expect(s).toBe('{"description":"A site","preferences":{"country":"in","preferredTlds":["com"]}}');
  });

  it('drops the automatic country setting', () => {
    expect(buildState('S1', { description: 'x', preferences: { country: 'auto' } })).toEqual({
      description: 'x',
      preferences: {},
    });
  });
});
