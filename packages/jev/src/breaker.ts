// Circuit breaker per server instance (spec 002 tech §5.3, FR-JEV-007): after 5 failed requests within 60 s,
// stop calling Jev for 30 s; then let one probe through.

export type BreakerState = 'closed' | 'open' | 'half_open';

export interface BreakerOptions {
  failureThreshold?: number;
  windowMs?: number;
  openMs?: number;
  now?: () => number;
}

export class CircuitBreaker {
  private failures: number[] = [];
  private openedAt: number | null = null;
  private probeInFlight = false;
  private readonly threshold: number;
  private readonly windowMs: number;
  private readonly openMs: number;
  private readonly now: () => number;

  constructor(opts: BreakerOptions = {}) {
    this.threshold = opts.failureThreshold ?? 5;
    this.windowMs = opts.windowMs ?? 60_000;
    this.openMs = opts.openMs ?? 30_000;
    this.now = opts.now ?? Date.now;
  }

  get state(): BreakerState {
    if (this.openedAt === null) return 'closed';
    return this.now() - this.openedAt >= this.openMs ? 'half_open' : 'open';
  }

  /** Whether a request may be sent now. In half-open state only one probe is allowed at a time. */
  allow(): boolean {
    const state = this.state;
    if (state === 'closed') return true;
    if (state === 'open' || this.probeInFlight) return false;
    this.probeInFlight = true;
    return true;
  }

  success(): void {
    this.failures = [];
    this.openedAt = null;
    this.probeInFlight = false;
  }

  failure(): void {
    const t = this.now();
    if (this.state === 'half_open') {
      this.openedAt = t;
      this.probeInFlight = false;
      return;
    }
    this.failures = [...this.failures.filter((f) => t - f < this.windowMs), t];
    if (this.failures.length >= this.threshold) {
      this.openedAt = t;
      this.failures = [];
    }
  }
}
