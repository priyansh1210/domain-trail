'use client';
// Contact and grievance form (spec 013 FR-PRIV-007).
import { useRef, useState } from 'react';
import { HumanCheck, type HumanCheckHandle } from '@/components/human-check';
import { t } from '@/lib/i18n';

export function ContactForm() {
  const human = useRef<HumanCheckHandle>(null);
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setState('sending');
    const res = await fetch('/api/contact', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: String(form.get('email') ?? ''),
        message: String(form.get('message') ?? ''),
        turnstileToken: (await human.current?.token()) ?? 'none',
      }),
    }).catch(() => null);
    if (res?.ok) return setState('sent');
    const body = (await res?.json().catch(() => ({}))) as { message?: string } | undefined;
    setError(body?.message ?? t('form.errorGeneric'));
    setState('error');
  }

  if (state === 'sent')
    return (
      <p role="status" className="rounded-lg border border-[var(--accent)] p-3">
        {t('contact.sent')}
      </p>
    );
  return (
    <form onSubmit={submit} onFocus={() => human.current?.warmUp()} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1">
        {t('contact.email')}
        <input
          name="email"
          type="email"
          required
          maxLength={254}
          autoComplete="email"
          className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2"
        />
      </label>
      <label className="flex flex-col gap-1">
        {t('contact.message')}
        <textarea
          name="message"
          required
          minLength={10}
          maxLength={4000}
          rows={6}
          className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2"
        />
      </label>
      {state === 'error' && (
        <p role="alert" className="text-sm text-[var(--danger)]">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={state === 'sending'}
        className="self-start rounded-lg bg-[var(--accent)] px-4 py-2 font-semibold text-[var(--on-accent)] disabled:opacity-60"
      >
        {t('contact.send')}
      </button>
      <HumanCheck ref={human} />
    </form>
  );
}
