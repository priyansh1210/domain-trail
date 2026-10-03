// Spec 013 tech §11 `log-redaction.test.ts`: description / e-mail / IP never logged.
import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createLogger, REDACTED, scrub } from '../src/index';

function capture() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, done) {
      lines.push(String(chunk));
      done();
    },
  });
  return { logger: createLogger({ name: 'test', level: 'debug' }, stream), lines };
}

const DESCRIPTION = 'Neighborhood bakery delivering sourdough bread and cakes';
const EMAIL = 'someone@example.com';
const IP = '203.0.113.42';

describe('logger redaction', () => {
  it('removes sensitive fields at any depth', () => {
    const { logger, lines } = capture();
    logger.info(
      {
        description: DESCRIPTION,
        user: { email: EMAIL },
        req: { ip: IP, headers: { cookie: 'sb=1', authorization: 'Bearer x' } },
      },
      'search started',
    );
    const out = lines.join('');
    expect(out).not.toContain(DESCRIPTION);
    expect(out).not.toContain(EMAIL);
    expect(out).not.toContain(IP);
    expect(out).not.toContain('Bearer x');
    expect(out).toContain(REDACTED);
    expect(out).toContain('search started');
  });

  it('masks e-mail and IP patterns inside free text', () => {
    const { logger, lines } = capture();
    logger.warn({ detail: `contact ${EMAIL} from ${IP}` }, `failed for ${EMAIL}`);
    const out = lines.join('');
    expect(out).not.toContain(EMAIL);
    expect(out).not.toContain(IP);
    expect(out).toContain('[email]');
    expect(out).toContain('[ip]');
  });

  it('keeps operational numbers', () => {
    expect(scrub({ stage: 'S7', ms: 812, tokens: 15000 })).toEqual({ stage: 'S7', ms: 812, tokens: 15000 });
  });

  it('scrubs error messages', () => {
    expect(scrub(new Error(`bounce from ${EMAIL}`))).toEqual({
      name: 'Error',
      message: 'bounce from [email]',
    });
  });
});
