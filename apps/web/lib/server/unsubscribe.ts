// /api/unsubscribe (spec 011 FR-ACC-009, NFR-ACC-005; OpenAPI): GET shows a confirmation page, POST is the RFC 8058
// one-click endpoint mail programs call. Both work without signing in and take effect at once.
import { verifyUnsubscribeToken } from '@domains-all/email';
import { log } from '@domains-all/log';
import { CookieJar } from './cookies';
import type { Services } from './services';

const page = (status: number, title: string, text: string) =>
  new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title></head><body style="font-family:system-ui,sans-serif;max-width:36rem;margin:3rem auto;padding:0 1rem"><h1>${title}</h1><p>${text}</p><p><a href="/account">Account settings</a></p></body></html>`,
    { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } },
  );

export async function handleUnsubscribe(req: Request, svc: Services): Promise<Response> {
  const token = new URL(req.url).searchParams.get('token') ?? '';
  const secret = svc.env.UNSUBSCRIBE_SECRET;
  const userId = secret ? verifyUnsubscribeToken(token, secret) : null;
  if (!userId)
    return page(
      400,
      'Link not valid',
      'This unsubscribe link is not valid. You can turn alerts off on your account page.',
    );
  // No session needed: the store's service role updates the profile the signed token names.
  const ok = await svc
    .accounts(svc.auth(new CookieJar(null)))
    .unsubscribe(userId)
    .catch(() => false);
  log.info({ event: 'alerts.unsubscribed', ok });
  if (req.method === 'POST') return new Response(null, { status: ok ? 200 : 404 });
  return page(
    200,
    'Alerts turned off',
    'You will not get alert e-mails any more. Alerts still appear on your account page.',
  );
}
