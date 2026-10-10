'use client';
// One result (spec 009 FR-UX-004, US-2, US-3; spec 006 FR-PRC-001, 012, 014, 015; spec 007 FR-FREE-004): name with
// the extension set apart, status and check time, prices with source, badges, reasons and actions.
import type { ResultItem } from '@domains-all/core/client';
import { type FxTable, formatMoney } from '@domains-all/pricing/client';
import { useState } from 'react';
import { ago } from '@/lib/client/results';
import { recheck, sendFeedback } from '@/lib/client/search';
import { WatchStar } from './save-controls';
import { t } from '@/lib/i18n';
import { reasonText } from '@/lib/reasons';

function Badge({ tone = 'muted', children }: { tone?: 'muted' | 'warn'; children: React.ReactNode }) {
  return (
    <span
      className={`rounded border px-1.5 py-0.5 text-xs ${tone === 'warn' ? 'border-[var(--warn)] text-[var(--warn)]' : 'border-[var(--border)] text-[var(--muted)]'}`}
    >
      {children}
    </span>
  );
}

export function ResultCard({
  item,
  searchRef,
  currency,
  fx,
}: {
  item: ResultItem;
  searchRef: string;
  currency: string;
  fx: FxTable;
}) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [vote, setVote] = useState<1 | -1 | 0>(0);
  const money = (cents: number) => formatMoney(cents, currency, fx);
  const when = ago(item.checkedAt);
  const isFree = item.section === 'free';
  const p = item.price;

  async function onRecheck() {
    setBusy(true);
    setNote(t('results.rechecking'));
    const r = await recheck(searchRef, item.fqdn);
    setBusy(false);
    setNote(r === 'limited' ? t('results.recheckLimited') : r === 'error' ? t('form.errorGeneric') : '');
  }

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(item.fqdn);
      setNote(t('results.copied', { name: item.fqdn }));
    } catch {
      setNote('');
    }
  }

  function onVote(v: 1 | -1) {
    setVote(v);
    void sendFeedback(searchRef, item.fqdn, v);
  }

  return (
    <li
      className="flex flex-col gap-1.5 rounded-lg border border-[var(--border)] p-3"
      data-testid="result-card"
      data-status={item.status}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="text-lg font-semibold break-all">
          {item.label}
          <span className="text-[var(--accent)]">.{item.tld}</span>
        </span>
        {p && (
          <span className="font-semibold" data-testid="price">
            {money(p.minYears > 1 ? p.upfrontUsdCents : p.firstYearUsdCents)}
          </span>
        )}
      </div>

      <p className="text-sm">
        <span className={item.status === 'unknown' ? 'text-[var(--warn)]' : 'text-[var(--muted)]'}>
          {t(`results.status.${item.status}`)}
        </span>
        <span className="text-[var(--muted)]">
          {' · '}
          {t('results.checked', { ago: t(`results.ago.${when.key}`, { n: when.n }) })}
          {item.free && ` · ${t('results.provider', { name: item.free.providerName })}`}
        </span>
      </p>

      {p && (
        <p className="text-sm text-[var(--muted)]">
          {p.minYears > 1
            ? t('results.minTerm', { price: money(p.upfrontUsdCents), years: p.minYears })
            : t('results.firstYear', { price: money(p.firstYearUsdCents) })}
          {' · '}
          {t('results.renews', { price: money(p.renewUsdCents) })}
          {' · '}
          {t('results.priceFrom', { source: p.source })}
        </p>
      )}

      {(p?.premium || p?.premiumPossible || p?.renewWarning || item.requiresHttps || item.restriction) && (
        <div className="flex flex-wrap gap-1.5">
          {p?.premium && <Badge tone="warn">{t('results.badgePremium')}</Badge>}
          {p?.premiumPossible && <Badge tone="warn">{t('results.badgePremiumPossible')}</Badge>}
          {p?.renewWarning && (
            <Badge tone="warn">{t('results.badgeRenewal', { price: money(p.renewUsdCents) })}</Badge>
          )}
          {item.restriction && <Badge tone="warn">{item.restriction.note}</Badge>}
          {item.requiresHttps && <Badge>{t('results.badgeHttps')}</Badge>}
        </div>
      )}

      {item.reasons.length > 0 && (
        <ul className="flex flex-wrap gap-x-4 text-sm text-[var(--muted)]">
          {item.reasons.slice(0, 3).map((r) => (
            <li key={r.id}>{reasonText(r)}</li>
          ))}
        </ul>
      )}

      {item.free && (
        <details className="text-sm">
          <summary className="cursor-pointer underline">{t('results.steps')}</summary>
          <ol className="mt-1 list-decimal pl-5">
            {item.free.conditions.steps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
          <p className="mt-1">{t('results.waitTime', { time: item.free.conditions.waitTime })}</p>
          <p>{t('results.eligibility', { text: item.free.conditions.eligibility })}</p>
        </details>
      )}

      <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
        {p?.buyUrl && (
          <a
            href={p.buyUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={t('results.buyAt', { name: item.fqdn, source: p.source })}
            className="rounded-lg bg-[var(--accent)] px-3 py-1.5 font-semibold text-[var(--on-accent)]"
          >
            {t('results.buy')}
          </a>
        )}
        {item.free && (
          <a
            href={item.free.conditions.url}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg border border-[var(--border)] px-3 py-1.5"
          >
            {t('results.officialSite')}
          </a>
        )}
        <button
          type="button"
          onClick={onCopy}
          aria-label={t('results.copyName', { name: item.fqdn })}
          className="rounded-lg border border-[var(--border)] px-3 py-1.5"
        >
          {t('results.copy')}
        </button>
        {!isFree && (
          <button
            type="button"
            onClick={onRecheck}
            disabled={busy}
            aria-label={t('results.recheckName', { name: item.fqdn })}
            className="rounded-lg border border-[var(--border)] px-3 py-1.5 disabled:opacity-60"
          >
            {busy ? t('results.rechecking') : t('results.recheck')}
          </button>
        )}
        <span className="ml-auto flex gap-1">
          {!isFree && <WatchStar item={item} onNote={setNote} />}
          <button
            type="button"
            aria-pressed={vote === 1}
            aria-label={t('results.thumbsUp', { name: item.fqdn })}
            onClick={() => onVote(1)}
            className={`rounded-lg border px-2 py-1 ${vote === 1 ? 'border-[var(--accent)]' : 'border-[var(--border)]'}`}
          >
            <span aria-hidden="true">👍</span>
          </button>
          <button
            type="button"
            aria-pressed={vote === -1}
            aria-label={t('results.thumbsDown', { name: item.fqdn })}
            onClick={() => onVote(-1)}
            className={`rounded-lg border px-2 py-1 ${vote === -1 ? 'border-[var(--accent)]' : 'border-[var(--border)]'}`}
          >
            <span aria-hidden="true">👎</span>
          </button>
        </span>
      </div>
      <p role="status" className="text-xs text-[var(--muted)] empty:hidden">
        {note}
      </p>
    </li>
  );
}
