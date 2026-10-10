// POST /api/contact (spec 013 FR-PRIV-007): grievance and general messages. Stored in `contact_messages` (kept one
// year, spec 012) where the owner reads them on /ops; the owner is told a message arrived, without its content
// (alerts never carry personal data). Human check and a small per-visitor limit keep it from being used for spam.
import { rateLimits } from '@domains-all/config';
import { log } from '@domains-all/log';
import { MemoryDedupe, sendAlert } from '@domains-all/metrics';
import * as z from 'zod/mini';
import { CookieJar } from './cookies';
import type { Services } from './services';
import { sameOrigin } from './session';
import { readLimited } from './sse';
import { clientIp, visitorHash } from './visitor';

const json = (status: number, body: unknown) =>
  Response.json(body, { status, headers: { 'cache-control': 'no-store' } });

const ContactSchema = z.object({
  email: z.email().check(z.maxLength(254)),
  message: z.string().check(z.minLength(10), z.maxLength(rateLimits.contactMessageMax)),
  turnstileToken: z.string().check(z.minLength(1), z.maxLength(4096)),
});

const dedupe = new MemoryDedupe();

export async function handleContact(req: Request, svc: Services, fetchFn?: typeof fetch): Promise<Response> {
  if (!sameOrigin(req)) return json(403, { error: 'forbidden' });
  const raw = await readLimited(req, rateLimits.contactMessageMax * 4 + 2048);
  if (raw === null) return json(413, { error: 'too_large' });
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return json(400, { error: 'validation' });
  }
  const parsed = ContactSchema.safeParse(body);
  if (!parsed.success)
    return json(400, { error: 'validation', message: 'Please enter an e-mail address and a message.' });

  const ip = clientIp(req.headers);
  const human = await svc.verifyHuman(parsed.data.turnstileToken, ip);
  if (human === 'failed') return json(403, { error: 'human_check_failed', message: 'Please try again.' });
  if (svc.limitsEnforced) {
    let salt: string;
    try {
      salt = svc.secrets().visitorSalt;
    } catch {
      return json(503, { error: 'not_configured' });
    }
    const visitor = visitorHash(ip, req.headers.get('user-agent') ?? '', salt);
    const r = await svc.limiter.check('contact', visitor, 'anonymous', 1);
    if (!r.ok)
      return json(429, {
        error: 'rate_limited',
        retryAfterSec: r.retryAfterSec,
        message: 'Please try again later.',
      });
  }

  let id: string;
  try {
    id = await svc.accounts(svc.auth(new CookieJar(null))).addContactMessage({
      email: parsed.data.email,
      message: parsed.data.message,
    });
  } catch (e) {
    log.error({ event: 'contact.failed', error: (e as Error).message });
    return json(500, { error: 'internal', message: `Please write to ${svc.env.GRIEVANCE_EMAIL} instead.` });
  }
  const env = svc.env;
  const outcome = await sendAlert(
    {
      level: 'info',
      notify: true,
      key: `contact:${id}`,
      message: 'A new message arrived on the contact page. Read it on /ops (answer within 30 days).',
      data: { characters: parsed.data.message.length },
    },
    {
      channel: env.ALERT_CHANNEL,
      siteName: env.NEXT_PUBLIC_SITE_NAME,
      resendApiKey: env.RESEND_API_KEY,
      ownerEmail: env.OWNER_ALERT_EMAIL,
      from: env.EMAIL_FROM,
      webhookUrl: env.ALERT_WEBHOOK_URL,
    },
    { dedupe, fetchFn },
  ).catch(() => 'failed');
  log.info({ event: 'contact.received', alert: outcome });
  return json(201, { ok: true });
}
