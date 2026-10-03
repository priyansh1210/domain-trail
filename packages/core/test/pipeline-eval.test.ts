// Spec 016 / NFR-RANK-004 (task M3-F2): with Jev unavailable, the deterministic ranking still puts the owner's good
// names above the bad ones (NDCG@10 ≥ 0.4 on the golden set). NDCG maths is checked too.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseServerEnv } from '@domains-all/config';
import { createJev } from '@domains-all/jev';
import { describe, expect, it } from 'vitest';
import { evaluateGolden, ndcgAt, type GoldenItem } from '../src/eval/evaluate';

const golden = readFileSync(join(import.meta.dirname, '..', '..', 'jev', 'eval', 'golden.jsonl'), 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((l) => JSON.parse(l) as GoldenItem);

describe('NDCG@10', () => {
  it('is 1 for a perfect order and lower when bad names come first', () => {
    expect(ndcgAt([1, 1, 0, 0])).toBe(1);
    expect(ndcgAt([0, 0, 1, 1])).toBeLessThan(0.7);
    expect(ndcgAt([0, 0])).toBe(0);
  });
});

describe('golden set ranking (degraded mode)', () => {
  it('reaches NDCG@10 ≥ 0.4 when Jev is down', async () => {
    const jev = createJev({ env: parseServerEnv({ MOCK_EXTERNALS: '0' }) }); // live without a key → every ask fails
    const { meanNdcg, results } = await evaluateGolden(golden, jev);
    expect(results.length).toBeGreaterThanOrEqual(20);
    expect(meanNdcg).toBeGreaterThanOrEqual(0.4);
  }, 60_000);
});
