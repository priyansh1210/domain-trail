// Owner-only pages (spec 011 §5.8, spec 015 §5.6): `/ops` and `/ops/saved`. Everyone else, signed-out saver or
// signed-in user, gets the ordinary "not found" page, so the pages do not even reveal that they exist.
import { notFound } from 'next/navigation';
import type { AccountStore } from './accounts';
import { pageJar } from './page-session';
import { services } from './services';

export async function requireAdmin(): Promise<AccountStore> {
  const svc = services();
  const auth = svc.auth(await pageJar());
  const user = await auth.user().catch(() => null);
  if (!user || user.isAnonymous || !svc.isAdmin(user.id)) notFound();
  return svc.accounts(auth);
}
