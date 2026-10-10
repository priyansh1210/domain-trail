'use client';
// First sign-in (spec 011 FR-ACC-015, spec 013 FR-PRIV-008): accept the Terms and Privacy Policy and confirm 18+.
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { loadSession } from '@/lib/client/account';
import { t } from '@/lib/i18n';

export function WelcomeForm({ next }: { next: string }) {
  const router = useRouter();
  const [terms, setTerms] = useState(false);
  const [age, setAge] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!terms || !age) return setError(t('welcome.required'));
    setBusy(true);
    const res = await fetch('/api/me', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ acceptTerms: true, ageConfirmed: true }),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) return setError(t('welcome.error'));
    await loadSession(true);
    router.push(next);
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={terms}
          onChange={(e) => setTerms(e.target.checked)}
          className="mt-1"
        />
        <span>
          {t('welcome.acceptTerms')} (
          <Link href="/terms" className="underline" target="_blank">
            {t('signIn.terms')}
          </Link>
          ,{' '}
          <Link href="/privacy" className="underline" target="_blank">
            {t('signIn.privacy')}
          </Link>
          )
        </span>
      </label>
      <label className="flex items-start gap-2">
        <input type="checkbox" checked={age} onChange={(e) => setAge(e.target.checked)} className="mt-1" />
        <span>{t('welcome.age')}</span>
      </label>
      {error && (
        <p role="alert" className="text-sm text-[var(--danger)]">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={busy}
        className="self-start rounded-lg bg-[var(--accent)] px-4 py-2 font-semibold text-[var(--on-accent)] disabled:opacity-60"
      >
        {t('welcome.submit')}
      </button>
    </form>
  );
}
