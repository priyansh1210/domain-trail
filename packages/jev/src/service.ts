// The single decision service every feature uses (spec 002 tech §1, FR-JEV-001). Combines catalog → wire
// conversion, per-search memo, budget guard, circuit breaker, batching, transport and answer validation.
// Any question that cannot be answered ends up in `failed` so the caller applies its fallback (FR-JEV-016).
import { createHash } from 'node:crypto';
import type { Logger } from '@domains-all/log';
import { batchQuestions, DEFAULT_LIMITS, type BatchLimits } from './batcher';
import type { CircuitBreaker } from './breaker';
import type { BudgetGuard } from './budget';
import type { Transport } from './transport';
import type { Answer, AskParams, AskResult, DegradedReason, WireQuestion } from './types';
import { refOf } from './types';
import { validateAnswer } from './validate';
import { estimateTokens, toWire } from './wire';

/** Answers reused within one search, e.g. when re-ranking after an edit (FR-JEV-017). */
export class AnswerMemo {
  private readonly map = new Map<string, Answer>();
  static key(name: string, q: WireQuestion, state: unknown): string {
    return createHash('sha256')
      .update(JSON.stringify([name, q, state]))
      .digest('base64url');
  }
  get(key: string) {
    return this.map.get(key);
  }
  set(key: string, a: Answer) {
    this.map.set(key, a);
  }
  get size() {
    return this.map.size;
  }
}

export interface DecisionServiceOptions {
  transport: Transport;
  breaker: CircuitBreaker;
  budget: BudgetGuard;
  model: string;
  limits?: BatchLimits;
  concurrency?: number;
  log?: Pick<Logger, 'info' | 'warn' | 'error'>;
}

export interface DecisionService {
  ask(params: AskParams & { stage?: string; memo?: AnswerMemo }): Promise<AskResult>;
  recordSearch(usage: { tokens: number; requests: number; degraded: boolean }): Promise<void>;
  breakerState(): 'closed' | 'open';
}

async function pool<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]!);
      }
    }),
  );
  return out;
}

export function createDecisionService(opts: DecisionServiceOptions): DecisionService {
  const limits = opts.limits ?? DEFAULT_LIMITS;
  const concurrency = opts.concurrency ?? 4;

  return {
    breakerState: () => (opts.breaker.state === 'closed' ? 'closed' : 'open'),
    recordSearch: (usage) => opts.budget.recordSearch(usage),

    async ask(params) {
      const answers: Record<string, Answer> = {};
      const refs: Record<string, string> = {};
      const failed: string[] = [];
      const requestIds: string[] = [];
      let inputTokens = 0;
      let requests = 0;
      let modelVersion = opts.model;
      let degradedReason: DegradedReason | undefined;

      const wire = new Map<string, WireQuestion>();
      for (const q of params.questions) {
        wire.set(q.name, toWire(q));
        refs[q.name] = refOf(q.def);
      }

      const pending: Array<[string, WireQuestion]> = [];
      for (const [name, q] of wire) {
        const hit = params.memo?.get(AnswerMemo.key(name, q, params.state));
        if (hit) answers[name] = hit;
        else pending.push([name, q]);
      }

      const done = (): AskResult => ({
        answers,
        failed,
        usage: { inputTokens, requests },
        requestIds,
        degraded: failed.length > 0,
        ...(failed.length > 0 ? { degradedReason: degradedReason ?? 'jev_unavailable' } : {}),
        modelVersion,
        refs,
      });

      if (pending.length === 0) return done();

      const batches = batchQuestions(params.state, pending, limits);
      const estimate =
        batches.length * estimateTokens(params.state) + estimateTokens(pending.map(([, q]) => q));
      if (!(await opts.budget.allows(estimate))) {
        degradedReason = 'budget';
        failed.push(...pending.map(([n]) => n));
        opts.log?.warn({ event: 'jev.budget_blocked', searchId: params.searchId, estimate });
        return done();
      }

      await pool(batches, concurrency, async (batch) => {
        const names = batch.map(([n]) => n);
        if (!opts.breaker.allow()) {
          failed.push(...names);
          return;
        }
        const result = await opts.transport.send(
          { model: opts.model, state: params.state, questions: Object.fromEntries(batch) },
          { deadline: params.deadline, searchId: params.searchId, stage: params.stage },
        );
        requests++;
        if (!result.ok) {
          if (result.error !== 'invalid') opts.breaker.failure();
          if (result.requestId) requestIds.push(result.requestId);
          failed.push(...names);
          return;
        }
        opts.breaker.success();
        if (result.requestId) requestIds.push(result.requestId);
        inputTokens += result.response.usage?.input_tokens ?? 0;
        if (result.response.model) modelVersion = result.response.model;
        for (const [name, q] of batch) {
          const v = validateAnswer(result.response.answers?.[name], q);
          if (v.ok) {
            answers[name] = v.answer;
            params.memo?.set(AnswerMemo.key(name, q, params.state), v.answer);
          } else {
            failed.push(name);
            opts.log?.warn({
              event: 'jev.invalid_answer',
              searchId: params.searchId,
              question: name,
              reason: v.reason,
              requestId: result.requestId,
            });
          }
        }
      });

      return done();
    },
  };
}
