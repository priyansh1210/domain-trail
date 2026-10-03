// Politeness towards registries and DNS providers (spec 005 tech §5.2; FR-AVL-007, NFR-AVL-006): per-host request
// spacing with a small burst, a per-host concurrency limit, and halving of the rate for 10 minutes after a 429.
import { availability } from '@domains-all/config/defaults';

/** Runs at most `size` tasks at a time. */
export class Semaphore {
  private active = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(private readonly size: number) {}

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.size) await new Promise<void>((resolve) => this.waiting.push(resolve));
    this.active++;
    try {
      return await task();
    } finally {
      this.active--;
      this.waiting.shift()?.();
    }
  }
}

interface HostState {
  /** Theoretical arrival time of the next request (GCRA). */
  tat: number;
  slowUntil: number;
  gate: Semaphore;
}

export interface HostLimiterOptions {
  rps?: number;
  burst?: number;
  concurrency?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Per-host overrides, e.g. a lower rate for a small registry. */
  rpsFor?: (host: string) => number | undefined;
}

const SLOW_DOWN_MS = 10 * 60_000;

export class HostLimiter {
  private readonly hosts = new Map<string, HostState>();
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly opts: HostLimiterOptions = {}) {
    this.now = opts.now ?? Date.now;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  private state(host: string): HostState {
    let s = this.hosts.get(host);
    if (!s) {
      s = {
        tat: 0,
        slowUntil: 0,
        gate: new Semaphore(this.opts.concurrency ?? availability.rdapPerHostConcurrency),
      };
      this.hosts.set(host, s);
    }
    return s;
  }

  /** Current requests per second for the host (halved while it is slowed down). */
  rateFor(host: string): number {
    const base = this.opts.rpsFor?.(host) ?? this.opts.rps ?? availability.rdapPerHostRps;
    return this.state(host).slowUntil > this.now() ? base / 2 : base;
  }

  /** Waits for the host's turn, then runs the task inside its concurrency limit. */
  async run<T>(host: string, task: () => Promise<T>): Promise<T> {
    const s = this.state(host);
    return s.gate.run(async () => {
      const interval = 1000 / this.rateFor(host);
      const tolerance = ((this.opts.burst ?? availability.rdapPerHostRps) - 1) * interval;
      const t = this.now();
      const tat = Math.max(s.tat, t);
      const wait = tat - tolerance - t;
      s.tat = tat + interval;
      if (wait > 0) await this.sleep(wait);
      return task();
    });
  }

  /** The host answered 429: halve its rate for 10 minutes. */
  slowDown(host: string): void {
    this.state(host).slowUntil = this.now() + SLOW_DOWN_MS;
  }
}
