// PII-safe structured logger (spec 013 tech §2, FR-PRIV-004): descriptions, e-mail addresses, IP addresses,
// tokens and cookies never reach logs. Sensitive keys are replaced at any depth, and e-mail / IP patterns
// inside free text are masked as a second line of defence.
import pino, { type DestinationStream, type Logger } from 'pino';

export const REDACTED = '[redacted]';

const SENSITIVE_KEYS = new Set([
  'description',
  'email',
  'ip',
  'authorization',
  'cookie',
  'set-cookie',
  'token',
  'turnstiletoken',
  'apikey',
  'password',
  'secret',
]);

// Bounded parts and a start-of-run lookbehind keep matching linear (CodeQL js/polynomial-redos).
const EMAIL = /(?<![\w.+-])[\w.+-]{1,64}@[\w-]{1,63}(?:\.[\w-]{1,63}){1,8}/g;
const IPV4 = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
const IPV6 = /\b(?:[0-9a-f]{1,4}:){2,7}[0-9a-f]{1,4}\b/gi;

/** Longest text kept in a log field; longer values are cut so scrubbing stays cheap. */
const MAX_LOG_TEXT = 10_000;

export function scrubText(input: string): string {
  const text = input.length > MAX_LOG_TEXT ? `${input.slice(0, MAX_LOG_TEXT)}…[cut]` : input;
  return text.replace(EMAIL, '[email]').replace(IPV4, '[ip]').replace(IPV6, '[ip]');
}

export function scrub(value: unknown, depth = 0): unknown {
  if (depth > 8) return '[depth]';
  if (typeof value === 'string') return scrubText(value);
  if (Array.isArray(value)) return value.map((v) => scrub(v, depth + 1));
  if (value instanceof Error) return { name: value.name, message: scrubText(value.message) };
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k,
        SENSITIVE_KEYS.has(k.toLowerCase().replace(/[_-]/g, '')) || SENSITIVE_KEYS.has(k.toLowerCase())
          ? REDACTED
          : scrub(v, depth + 1),
      ]),
    );
  }
  return value;
}

export function createLogger(
  options: { name?: string; level?: string } = {},
  destination?: DestinationStream,
): Logger {
  return pino(
    {
      name: options.name ?? 'domains-all',
      level: options.level ?? process.env.LOG_LEVEL ?? 'info',
      base: undefined, // no pid/hostname
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: { log: (obj) => scrub(obj) as Record<string, unknown> },
      hooks: {
        logMethod(args, method) {
          method.apply(
            this,
            args.map((a) => (typeof a === 'string' ? scrubText(a) : a)) as Parameters<typeof method>,
          );
        },
      },
    },
    destination,
  );
}

export const log = createLogger();
export type { Logger };
