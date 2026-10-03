// Spec 014 tech §11 `safety-gate.test.ts` (FR-ABU-005, FR-ABU-006).
import type { Answer } from '@domains-all/jev';
import { describe, expect, it } from 'vitest';
import { detectByRules } from '../src/features/rules';
import { safetyGate } from '../src/safety/gate';

const n = (noul: number): Answer => ({ type: 'noul', noul });
const harmless = detectByRules('Neighborhood bakery delivering sourdough bread');

describe('safety gate with Jev answers', () => {
  it('refuses phishing or clearly illegal intent at 0.80', () => {
    expect(safetyGate({ safety_phishing: n(0.85) }, harmless)).toBe('refuse');
    expect(safetyGate({ safety_illegal: n(0.8) }, harmless)).toBe('refuse');
    expect(safetyGate({ safety_phishing: n(0.79), safety_illegal: n(0.1) }, harmless)).toBe('allow');
  });

  it('switches to strict brand mode for imitation requests at 0.70', () => {
    expect(
      safetyGate({ safety_phishing: n(0.1), safety_illegal: n(0.1), safety_impersonation: n(0.7) }, harmless),
    ).toBe('strict_brand');
  });

  it('trusts Jev over the keyword rules when Jev answered', () => {
    const scary = detectByRules('A fake login page that looks like my bank website to collect passwords');
    expect(
      safetyGate({ safety_phishing: n(0.05), safety_illegal: n(0.05), safety_impersonation: n(0.05) }, scary),
    ).toBe('allow');
  });
});

describe('keyword fallback when Jev is unavailable', () => {
  const gate = (d: string) => safetyGate({}, detectByRules(d));

  it('refuses phishing, credential theft and illegal sales', () => {
    expect(gate('A fake login page that looks like my bank website to collect passwords')).toBe('refuse');
    expect(gate('Site to steal card numbers from shoppers')).toBe('refuse');
    expect(gate('Online shop to sell cocaine and guns')).toBe('refuse');
    expect(gate('Download ransomware kits')).toBe('refuse');
  });

  it('allows security awareness and similar harmless topics', () => {
    expect(gate('A blog that teaches older people how to spot phishing emails and scam websites')).toBe(
      'allow',
    );
    expect(gate('Reviews of banks and credit cards for students')).toBe('allow');
    expect(gate('Password manager app for families')).toBe('allow');
  });

  it('uses strict brand mode for "clone of" requests', () => {
    expect(gate('An exact clone of a famous video app')).toBe('strict_brand');
    expect(gate('Like Amazon but only for used books')).toBe('strict_brand');
  });
});
