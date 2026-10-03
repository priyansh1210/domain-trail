// Spec 002 tech §11 `breaker.test.ts` (FR-JEV-007).
import { describe, expect, it } from 'vitest';
import { CircuitBreaker } from '../src/breaker';

describe('circuit breaker', () => {
  it('opens after 5 failures within 60 s, probes after 30 s, closes on success', () => {
    let t = 0;
    const b = new CircuitBreaker({ now: () => t });
    for (let i = 0; i < 4; i++) b.failure();
    expect(b.state).toBe('closed');
    b.failure();
    expect(b.state).toBe('open');
    expect(b.allow()).toBe(false);
    t += 30_000;
    expect(b.state).toBe('half_open');
    expect(b.allow()).toBe(true);
    expect(b.allow()).toBe(false); // only one probe at a time
    b.success();
    expect(b.state).toBe('closed');
  });

  it('re-opens when the probe fails', () => {
    let t = 0;
    const b = new CircuitBreaker({ now: () => t });
    for (let i = 0; i < 5; i++) b.failure();
    t += 30_000;
    b.allow();
    b.failure();
    expect(b.state).toBe('open');
  });

  it('forgets failures older than the window', () => {
    let t = 0;
    const b = new CircuitBreaker({ now: () => t });
    for (let i = 0; i < 4; i++) b.failure();
    t += 61_000;
    b.failure();
    expect(b.state).toBe('closed');
  });
});
