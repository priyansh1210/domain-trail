// Public surface of the Jev package. Features import only from here (FR-JEV-001); the transport is reached
// through `createJev`, never directly.
import { jev as jevDefaults, jevKey, type ServerEnv } from '@domains-all/config';
import { log as defaultLog, type Logger } from '@domains-all/log';
import { CircuitBreaker } from './breaker';
import { BudgetGuard, MemoryUsageStore, type UsageStore } from './budget';
import { createMockTransport, type MockHint } from './mock';
import { createDecisionService, type DecisionService } from './service';
import { createHttpTransport, type Transport } from './transport';

export * from './catalog';
export { AnswerMemo, type DecisionService } from './service';
export { BudgetGuard, MemoryUsageStore, type UsageStore } from './budget';
export { CircuitBreaker } from './breaker';
export { buildState, type S1Input, type S5Input } from './state';
export { genericAnswer, tokens as mockTokens, type MockHint } from './mock';
export type * from './types';
export { refOf } from './types';

export interface CreateJevOptions {
  env: Pick<
    ServerEnv,
    | 'MOCK_EXTERNALS'
    | 'JEV_ROUTE'
    | 'JEV_MODEL'
    | 'AI_GATEWAY_API_KEY'
    | 'TYPESAFE_API_KEY'
    | 'NGROK_AI_API_KEY'
  >;
  usageStore?: UsageStore;
  mockHint?: MockHint;
  log?: Logger;
  now?: () => number;
}

/**
 * Builds the decision service for this server instance. Mock mode (MOCK_EXTERNALS=1) uses the in-process mock
 * engine. Live mode without an API key never falls back to mock answers: every ask fails, so features use their
 * honest degraded fallback and the banner says so.
 */
export function createJev(opts: CreateJevOptions): DecisionService & { mode: 'live' | 'mock' } {
  const { env } = opts;
  const [, apiKey] = jevKey(env);
  const mode = env.MOCK_EXTERNALS ? 'mock' : 'live';
  const log = opts.log ?? defaultLog;
  const transport: Transport =
    mode === 'mock'
      ? createMockTransport({ model: env.JEV_MODEL, hint: opts.mockHint })
      : apiKey
        ? createHttpTransport({
            route: env.JEV_ROUTE,
            apiKey,
            requestTimeoutMs: jevDefaults.requestTimeoutMs,
            log,
          })
        : { send: async () => ({ ok: false, error: 'auth' }) };
  const service = createDecisionService({
    transport,
    breaker: new CircuitBreaker({ now: opts.now }),
    budget: new BudgetGuard(
      opts.usageStore ?? new MemoryUsageStore(),
      { monthlyTokens: jevDefaults.monthlyTokenCap, dailyTokens: jevDefaults.dailyTokenCap },
      opts.now,
    ),
    model: env.JEV_MODEL,
    limits: {
      maxQuestions: jevDefaults.maxQuestionsPerRequest,
      maxRequestTokens: 60_000,
      maxStatePlusQuestionTokens: 31_000,
    },
    log,
  });
  return { ...service, mode };
}
