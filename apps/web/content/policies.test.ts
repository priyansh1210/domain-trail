// Spec 013 tech §11 `policy-content.test.ts` (FR-PRIV-001, 002, 007, 009, 017; FR-ACC-021): every required section,
// the grievance contact, the operator-access line and the data locations are in the published texts.
import { describe, expect, it } from 'vitest';
import { POLICY_VERSION_DEFAULT } from './policy-version';
import { privacyPolicy, terms } from './policies';

const ctx = {
  siteName: 'Domain_Trail',
  siteUrl: 'https://domain-trail.vercel.app',
  grievanceName: 'Priyansh K',
  grievanceEmail: 'priyansh1210@gmail.com',
};
const text = (p: ReturnType<typeof privacyPolicy>) => JSON.stringify(p.sections);

describe('Privacy Policy', () => {
  const p = privacyPolicy(ctx);

  it('has every section spec 013 §5.7 requires', () => {
    expect(p.sections.map((s) => s.id)).toEqual([
      'summary',
      'collected',
      'access',
      'purposes',
      'decision-model',
      'retention',
      'processors',
      'rights',
      'children',
      'security',
      'transfers',
      'changes',
    ]);
  });

  it('says the operator can see saved items, where data is stored, and who to contact', () => {
    const t = text(p);
    expect(t).toContain('Saved items are stored on our servers and can be seen by the site operator.');
    expect(t).toContain('Mumbai, India');
    expect(t).toContain('Priyansh K — priyansh1210@gmail.com');
    expect(t).toContain('Data Protection Board of India');
    expect(t).toContain('18 or over');
  });

  it('matches the version users accept', () => {
    expect(p.version).toBe(POLICY_VERSION_DEFAULT);
    expect(terms(ctx).version).toBe(POLICY_VERSION_DEFAULT);
  });
});

describe('Terms', () => {
  it('covers the spec 013 §5.8 outline', () => {
    expect(terms(ctx).sections.map((s) => s.id)).toEqual([
      'service',
      'no-guarantee',
      'registrars',
      'trademarks',
      'acceptable-use',
      'accounts',
      'liability',
      'law',
      'changes',
    ]);
  });
});

describe('policy version', () => {
  it('is the environment default', async () => {
    const { parseServerEnv } = await import('@domains-all/config');
    expect(parseServerEnv({}).POLICY_VERSION).toBe(POLICY_VERSION_DEFAULT);
  });
});
