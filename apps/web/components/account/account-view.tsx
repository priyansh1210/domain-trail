'use client';
// Account page (spec 011 US-2…US-7, FR-ACC-004…013, 019): saved searches, watched names, in-app alerts, settings,
// export and deletion, and sign-out. Signed-out savers see their saved items and can delete them.
import type { Preferences } from '@domains-all/core/client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { HumanCheck, type HumanCheckHandle } from '@/components/human-check';
import { loadSession, signInHref, type SessionInfo } from '@/lib/client/account';
import { ago } from '@/lib/client/results';
import { startSearch } from '@/lib/client/search';
import { t, type messages } from '@/lib/i18n';

interface Saved {
  id: string;
  title: string;
  description: string | null;
  preferences: Preferences;
  searchRef: string | null;
  createdAt: string;
}
interface Watched {
  fqdn: string;
  lastStatus: string | null;
  lastCheckedAt: string | null;
}
interface Note {
  id: number;
  kind: keyof typeof messages.account.notification;
  fqdn: string;
  createdAt: string;
  readAt: string | null;
}
interface Profile {
  alertFrequency: 'daily' | 'weekly' | 'off';
  currency: string;
}

const CURRENCIES = [
  'USD',
  'EUR',
  'GBP',
  'INR',
  'JPY',
  'AUD',
  'CAD',
  'CHF',
  'CNY',
  'SGD',
  'BRL',
  'ZAR',
  'SEK',
  'NZD',
];

const when = (iso: string) => {
  const a = ago(iso);
  return t(`results.ago.${a.key}`, { n: a.n });
};

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <h2 id={id} className="text-lg font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}

export function AccountView() {
  const router = useRouter();
  const human = useRef<HumanCheckHandle>(null);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [saved, setSaved] = useState<Saved[]>([]);
  const [watched, setWatched] = useState<Watched[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const load = useCallback(async () => {
    const s = await loadSession(true);
    setSession(s);
    if (!s.user) return;
    if (s.needsTerms) return router.replace('/account/welcome?next=/account');
    try {
      const get = (u: string) => fetch(u, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null));
      const [ss, ww] = await Promise.all([get('/api/me/saved-searches'), get('/api/me/watchlist')]);
      setSaved(ss ?? []);
      setWatched(ww ?? []);
      if (!s.user.isAnonymous) {
        const [nn, pp] = await Promise.all([get('/api/me/notifications'), get('/api/me')]);
        setNotes(nn ?? []);
        setProfile(pp);
      }
    } catch {
      setError(true);
    }
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  async function removeSaved(id: string) {
    const res = await fetch(`/api/me/saved-searches/${id}`, { method: 'DELETE' }).catch(() => null);
    if (res?.ok) setSaved((l) => l.filter((s) => s.id !== id));
  }

  async function removeWatched(fqdn: string) {
    const res = await fetch(`/api/me/watchlist/${encodeURIComponent(fqdn)}`, { method: 'DELETE' }).catch(
      () => null,
    );
    if (res?.ok) setWatched((l) => l.filter((w) => w.fqdn !== fqdn));
  }

  async function runAgain(s: Saved) {
    if (!s.description) return;
    const token = (await human.current?.token()) ?? 'none';
    const r = await startSearch({ description: s.description, preferences: s.preferences }, token);
    if ('ref' in r) router.push(`/s/${r.ref}`);
    else setStatus(t('form.errorGeneric'));
  }

  async function markRead() {
    const res = await fetch('/api/me/notifications/read', { method: 'POST' }).catch(() => null);
    if (res?.ok) setNotes((l) => l.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })));
  }

  async function saveSettings(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const res = await fetch('/api/me', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ alertFrequency: form.get('frequency'), currency: form.get('currency') }),
    }).catch(() => null);
    if (res?.ok) {
      setProfile((await res.json()) as Profile);
      setStatus(t('account.saved'));
      try {
        localStorage.setItem('display-currency', String(form.get('currency')));
      } catch {
        // the results page falls back to the browser's region
      }
    } else setStatus(t('account.error'));
  }

  async function deleteEverything() {
    const res = await fetch('/api/me', { method: 'DELETE' }).catch(() => null);
    if (!res?.ok) return setStatus(t('account.error'));
    await loadSession(true);
    setStatus(t('account.deleted'));
    router.push('/');
  }

  if (!session) return <p>{t('account.loading')}</p>;
  if (!session.user)
    return (
      <div className="flex flex-col gap-3">
        <p>{t('account.notSignedIn')}</p>
        {session.available && (
          <Link href={signInHref('/account')} className="underline">
            {t('header.signIn')}
          </Link>
        )}
      </div>
    );

  const anonymous = session.user.isAnonymous;
  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">
          {t(anonymous ? 'account.titleAnonymous' : 'account.title')}
        </h1>
        {anonymous ? (
          <>
            <p>{t('account.anonymousIntro')}</p>
            <Link href={signInHref('/account')} className="underline">
              {t('account.signInToKeep')}
            </Link>
          </>
        ) : (
          <p className="text-sm text-[var(--muted)]">
            {session.user.email ? t('account.signedInAs', { email: session.user.email }) : null}
            {session.user.provider
              ? ` · ${t('account.signedInWith', { provider: session.user.provider })}`
              : null}
          </p>
        )}
        {session.isAdmin && (
          <Link href="/ops" className="text-sm underline">
            {t('account.admin')}
          </Link>
        )}
      </header>
      {error && <p role="alert">{t('account.error')}</p>}
      <p role="status" className="text-sm empty:hidden">
        {status}
      </p>

      <Section id="saved-heading" title={t('account.savedSearches')}>
        {saved.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">{t('account.noSavedSearches')}</p>
        ) : (
          <ul className="flex flex-col gap-2" data-testid="saved-searches">
            {saved.map((s) => (
              <li
                key={s.id}
                className="flex flex-wrap items-center gap-3 rounded-lg border border-[var(--border)] p-3"
              >
                <span className="font-medium">{s.title}</span>
                <span className="text-sm text-[var(--muted)]">{when(s.createdAt)}</span>
                <span className="ml-auto flex gap-2 text-sm">
                  {s.searchRef && (
                    <Link href={`/s/${s.searchRef}`} className="underline">
                      {t('account.open')}
                    </Link>
                  )}
                  {s.description && (
                    <button type="button" className="underline" onClick={() => runAgain(s)}>
                      {t('account.runAgain')}
                    </button>
                  )}
                  <button
                    type="button"
                    className="underline"
                    aria-label={t('account.removeName', { name: s.title })}
                    onClick={() => removeSaved(s.id)}
                  >
                    {t('account.remove')}
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section id="watch-heading" title={t('account.watchlist')}>
        {watched.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">{t('account.noWatchlist')}</p>
        ) : (
          <ul className="flex flex-col gap-2" data-testid="watchlist">
            {watched.map((w) => (
              <li
                key={w.fqdn}
                className="flex flex-wrap items-center gap-3 rounded-lg border border-[var(--border)] p-3"
              >
                <span className="font-medium break-all">{w.fqdn}</span>
                <span className="text-sm text-[var(--muted)]">
                  {w.lastStatus
                    ? t('account.lastStatus', {
                        status: t(`results.status.${w.lastStatus}`),
                        when: w.lastCheckedAt ? when(w.lastCheckedAt) : t('account.notChecked'),
                      })
                    : t('account.notChecked')}
                </span>
                <button
                  type="button"
                  className="ml-auto text-sm underline"
                  aria-label={t('account.removeName', { name: w.fqdn })}
                  onClick={() => removeWatched(w.fqdn)}
                >
                  {t('account.remove')}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {!anonymous && (
        <Section id="alerts-heading" title={t('account.notifications')}>
          {notes.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">{t('account.noNotifications')}</p>
          ) : (
            <>
              <ul className="flex flex-col gap-1 text-sm" data-testid="notifications">
                {notes.map((n) => (
                  <li key={n.id} className={n.readAt ? 'text-[var(--muted)]' : 'font-medium'}>
                    {t(`account.notification.${n.kind}`, { name: n.fqdn })} · {when(n.createdAt)}
                  </li>
                ))}
              </ul>
              {notes.some((n) => !n.readAt) && (
                <button type="button" onClick={markRead} className="self-start text-sm underline">
                  {t('account.markRead')}
                </button>
              )}
            </>
          )}
        </Section>
      )}

      {!anonymous && profile && (
        <Section id="settings-heading" title={t('account.settings')}>
          <form onSubmit={saveSettings} className="flex flex-wrap items-end gap-4">
            <label className="flex flex-col gap-1 text-sm">
              {t('account.alertFrequency')}
              <select
                name="frequency"
                defaultValue={profile.alertFrequency}
                className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2 py-1"
              >
                {(['daily', 'weekly', 'off'] as const).map((f) => (
                  <option key={f} value={f}>
                    {t(`account.frequency.${f}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              {t('account.currency')}
              <select
                name="currency"
                defaultValue={profile.currency}
                className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2 py-1"
              >
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm">
              {t('account.save')}
            </button>
          </form>
          <p className="text-sm text-[var(--muted)]">{t('account.emailOff')}</p>
        </Section>
      )}

      <Section id="data-heading" title={t('account.data')}>
        <div className="flex flex-wrap gap-3 text-sm">
          <a href="/api/me/export" download className="rounded-lg border border-[var(--border)] px-3 py-1.5">
            {t('account.export')}
          </a>
          {!confirming ? (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="rounded-lg border border-[var(--danger)] px-3 py-1.5 text-[var(--danger)]"
            >
              {t(anonymous ? 'account.deleteAnonymous' : 'account.delete')}
            </button>
          ) : (
            <span
              className="flex flex-wrap items-center gap-2"
              role="group"
              aria-label={t('account.deleteConfirm')}
            >
              <span>{t('account.deleteConfirm')}</span>
              <button
                type="button"
                onClick={deleteEverything}
                className="rounded-lg bg-[var(--danger)] px-3 py-1.5 font-semibold text-[var(--on-accent)]"
              >
                {t('account.deleteYes')}
              </button>
              <button type="button" onClick={() => setConfirming(false)} className="underline">
                {t('account.deleteNo')}
              </button>
            </span>
          )}
        </div>
      </Section>

      {!anonymous && (
        <div className="flex flex-wrap gap-3 text-sm">
          <form method="post" action="/auth/sign-out">
            <input type="hidden" name="scope" value="local" />
            <button type="submit" className="underline">
              {t('account.signOut')}
            </button>
          </form>
          <form method="post" action="/auth/sign-out">
            <input type="hidden" name="scope" value="global" />
            <button type="submit" className="underline">
              {t('account.signOutEverywhere')}
            </button>
          </form>
        </div>
      )}
      <HumanCheck ref={human} />
    </div>
  );
}
