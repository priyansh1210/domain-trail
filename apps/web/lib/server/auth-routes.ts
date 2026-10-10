// /auth/sign-in, /auth/callback, /auth/sign-out (spec 011 tech §5.1, §5.5, §5.7; FR-ACC-002, 003, 013, 015, 018).
// Redirect-only routes: the browser never runs sign-in code. After the callback the visitor returns to the page they
// started from; a first sign-in passes through the terms page; a signed-out saver's items move into the account.
import { log } from '@domains-all/log';
import { CookieJar } from './cookies';
import type { Services } from './services';
import { PROVIDERS, type Provider, rememberAnonymous, safeNext, sameOrigin, takeAnonymous } from './session';

/** Redirect that can carry cookies (`Response.redirect` headers cannot be changed). */
const redirect = (jar: CookieJar, location: string) =>
  jar.apply(new Response(null, { status: 303, headers: { location, 'cache-control': 'no-store' } }));

export async function handleSignIn(req: Request, svc: Services): Promise<Response> {
  const url = new URL(req.url);
  const jar = CookieJar.from(req);
  const next = safeNext(url.searchParams.get('next'));
  const provider = url.searchParams.get('provider') as Provider;
  const back = (reason: string) => redirect(jar, `/sign-in?${new URLSearchParams({ next, error: reason })}`);
  if (!PROVIDERS.includes(provider)) return back('provider');
  const auth = svc.auth(jar);
  if (!auth.available) return back('unavailable');

  // A signed-out saver signing in: remember them so the callback can move their saved items (decision 2).
  const current = await auth.user().catch(() => null);
  if (current?.isAnonymous) rememberAnonymous(jar, svc.secrets().searchLink, current.id);

  const callback = new URL('/auth/callback', url.origin);
  callback.searchParams.set('next', next);
  const target = await auth.signInUrl(provider, callback.toString()).catch(() => null);
  if (!target) return back('provider');
  return redirect(jar, target);
}

export async function handleCallback(req: Request, svc: Services): Promise<Response> {
  const url = new URL(req.url);
  const jar = CookieJar.from(req);
  const next = safeNext(url.searchParams.get('next'));
  const code = url.searchParams.get('code');
  const auth = svc.auth(jar);
  const user = code ? await auth.exchange(code).catch(() => null) : null;
  if (!user) {
    log.warn({ event: 'auth.callback_failed', provider: url.searchParams.get('error') ?? 'code' });
    return redirect(jar, `/sign-in?${new URLSearchParams({ next, error: 'callback' })}`);
  }
  const store = svc.accounts(auth);
  const anonId = takeAnonymous(jar, svc.secrets().searchLink);
  if (anonId && !user.isAnonymous && anonId !== user.id) {
    const moved = await store.moveItems(anonId, user).catch((e: Error) => {
      log.error({ event: 'auth.move_failed', error: e.message });
      return null;
    });
    if (moved) log.info({ event: 'auth.moved_saved_items', ...moved });
  }
  log.info({ event: 'auth.signed_in', provider: user.provider ?? 'unknown' });
  if (!user.isAnonymous && !(await store.profile(user).catch(() => null)))
    return redirect(jar, `/account/welcome?${new URLSearchParams({ next })}`);
  return redirect(jar, next);
}

/** Form POST from the account page; `scope=global` signs out on every device (FR-ACC-013). */
export async function handleSignOut(req: Request, svc: Services): Promise<Response> {
  const jar = CookieJar.from(req);
  if (!sameOrigin(req)) return new Response('Forbidden', { status: 403 });
  const form = await req.formData().catch(() => null);
  const scope = form?.get('scope') === 'global' ? 'global' : 'local';
  await svc
    .auth(jar)
    .signOut(scope)
    .catch(() => undefined);
  for (const { name } of jar.getAll()) if (name.startsWith('sb-')) jar.delete(name);
  return redirect(jar, '/');
}
