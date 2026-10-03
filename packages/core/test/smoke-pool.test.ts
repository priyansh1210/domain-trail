// Spec 016 tech §3.3 smoke pool (task M3-A5, research R-14): 305 outside descriptions (Maikobi dataset, Apache-2.0)
// run through validation, the safety gate with Jev down, and — for a sample — the whole naming pipeline.
// Short rows must be rejected, harmful rows refused (adult content allowed: owner decision), names valid and clean.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseServerEnv } from '@domains-all/config';
import { createJev } from '@domains-all/jev';
import { describe, expect, it } from 'vitest';
import { rulesMockHint } from '../src/features/mock-hint';
import { isProfane } from '../src/generation/prefilter';
import { shape } from '../src/generation/quality';
import { DescriptionSchema } from '../src/intake/request';
import { PreferencesSchema } from '../src/intake/schema';
import { runNames } from '../src/pipeline/names';
import { runS1 } from '../src/pipeline/s1';
import { brandRisk } from '../src/safety/brand-risk';
import * as z from 'zod/mini';

interface SmokeRow {
  id: string;
  category: string;
  description: string;
  expect: 'allow' | 'refuse' | 'too_short';
}

const rows = readFileSync(join(import.meta.dirname, '..', '..', 'jev', 'eval', 'smoke.jsonl'), 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((l) => JSON.parse(l) as SmokeRow);
const valid = rows.filter((r) => r.expect !== 'too_short');
const LDH = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

describe('smoke pool', () => {
  it('has the expected mix of rows', () => {
    expect(rows.length).toBeGreaterThanOrEqual(300);
    expect(rows.filter((r) => r.category === 'safety').length).toBe(15);
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
  });

  it('rejects descriptions under the minimum length and accepts the rest', () => {
    const wrong = rows.filter(
      (r) => z.safeParse(DescriptionSchema, r.description).success !== (r.expect !== 'too_short'),
    );
    expect(wrong.map((r) => r.description)).toEqual([]);
  });

  it('refuses the harmful rows and nothing else when Jev is down', async () => {
    const jev = createJev({ env: parseServerEnv({ MOCK_EXTERNALS: '0' }) }); // live without a key → keyword fallback
    const preferences = PreferencesSchema.parse({});
    const wrong: string[] = [];
    for (const r of valid) {
      const out = await runS1({ description: r.description, preferences, searchId: r.id, jev });
      if ((out.kind === 'refused') !== (r.expect === 'refuse')) wrong.push(`${r.expect}: ${r.description}`);
    }
    expect(wrong).toEqual([]);
  }, 60_000);

  it('produces valid, clean name ideas for a sample of descriptions', async () => {
    const jev = createJev({ env: parseServerEnv({}), mockHint: rulesMockHint });
    const preferences = PreferencesSchema.parse({ forceSearch: true });
    const sample = valid.filter((r) => r.expect === 'allow').filter((_, i) => i % 32 === 0);
    expect(sample.length).toBeGreaterThanOrEqual(8);
    for (const r of sample) {
      const s1 = await runS1({ description: r.description, preferences, searchId: r.id, jev });
      expect(s1.kind, r.description).toBe('features');
      if (s1.kind !== 'features') continue;
      const out = await runNames({
        description: r.description,
        preferences,
        profile: s1.profile,
        strictBrand: s1.strictBrand,
        searchId: r.id,
        seed: r.id,
        jev,
        live: false,
      });
      expect(out.ideas.length, r.description).toBeGreaterThan(0);
      const bad = out.ideas.filter((idea) => {
        const { segments } = shape(idea.label);
        return (
          !LDH.test(idea.label) ||
          idea.label.length > preferences.maxLength ||
          idea.tlds.length === 0 ||
          isProfane(idea.label, segments) ||
          brandRisk(idea.label, { segments }).risky
        );
      });
      expect(
        bad.map((i) => i.label),
        r.description,
      ).toEqual([]);
    }
  }, 120_000);
});
