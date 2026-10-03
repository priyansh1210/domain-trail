// Spec 005 tech §11 `rate-limit.test.ts` (FR-AVL-007, NFR-AVL-006): token spacing, burst, concurrency, halving.
import { describe, expect, it } from 'vitest';
import { HostLimiter, Semaphore } from '../src/limiter';

function clock() {
  let t = 0;
  return {
    now: () => t,
    sleep: async (ms: number) => {
      t += ms;
    },
  };
}

describe('per-host limiter', () => {
  it('allows a burst of 5, then spaces requests at 5 per second', async () => {
    const c = clock();
    const limiter = new HostLimiter({ rps: 5, burst: 5, concurrency: 1, ...c });
    const times: number[] = [];
    for (let i = 0; i < 8; i++) await limiter.run('rdap.verisign.com', async () => times.push(c.now()));
    expect(times.slice(0, 5)).toEqual([0, 0, 0, 0, 0]);
    expect(times[5]).toBe(200);
    expect(times[7]).toBe(600);
  });

  it('keeps hosts independent and halves a host after a 429', async () => {
    const c = clock();
    const limiter = new HostLimiter({ rps: 5, burst: 1, concurrency: 1, ...c });
    expect(limiter.rateFor('a')).toBe(5);
    limiter.slowDown('a');
    expect(limiter.rateFor('a')).toBe(2.5);
    expect(limiter.rateFor('b')).toBe(5);
  });

  it('never runs more than the concurrency limit at once', async () => {
    const gate = new Semaphore(2);
    let active = 0;
    let peak = 0;
    await Promise.all(
      Array.from({ length: 6 }, () =>
        gate.run(async () => {
          active++;
          peak = Math.max(peak, active);
          await new Promise((r) => setTimeout(r, 5));
          active--;
        }),
      ),
    );
    expect(peak).toBe(2);
  });
});
