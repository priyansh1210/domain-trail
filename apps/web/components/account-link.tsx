'use client';
// Header link (spec 011 US-1): "Sign in", or "Account" / "Saved items" once there is a session. Loaded after the
// page so every page stays static.
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { loadSession, signInHref, useAccount } from '@/lib/client/account';
import { t } from '@/lib/i18n';

export function AccountLink() {
  const session = useAccount((s) => s.session);
  const path = usePathname();
  useEffect(() => {
    void loadSession();
  }, []);
  if (!session?.available) return null;
  if (!session.user) {
    if (path === '/sign-in') return null;
    return (
      <Link href={signInHref(path || '/')} className="underline" data-testid="sign-in-link">
        {t('header.signIn')}
      </Link>
    );
  }
  return (
    <Link href="/account" className="underline" data-testid="account-link">
      {t(session.user.isAnonymous ? 'header.savedItems' : 'header.account')}
    </Link>
  );
}
