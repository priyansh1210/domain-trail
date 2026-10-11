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

const STATUS_TONE: Record<string, string> = {
  available: 'pill-ok',
  likely_available: 'pill-ok',
  appears_free: 'pill-ok',
  unknown: 'pill-warn',
  not_verifiable: 'pill-warn',
  available_premium: 'pill-warn',
};

function Badge({ tone = 'muted', children }: { tone?: 'muted' | 'warn'; children: React.ReactNode }) {
  return (
    <span
      className={
        tone === 'warn'
          ? 'pill pill-warn whitespace-normal'
          : 'pill border border-[var(--border)] font-medium whitespace-normal text-[var(--muted)]'
      }
    >
      {children}
    </span>
  );
}

const small = 'btn btn-ghost px-2.5 py-1 text-[0.8125rem]';

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
      className="rise flex flex-col gap-3 border-t border-[var(--border)] px-4 py-4 transition-colors first:border-t-0 hover:bg-[var(--surface-2)] sm:px-5"
      data-testid="result-card"
      data-status={item.status}
    >
      <div className="grid gap-x-6 gap-y-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="domain text-[1.2rem] break-all" data-testid="name">
              {item.label}
              <span className="text-[var(--accent)]">.{item.tld}</span>
            </span>
            <span
              className={`pill whitespace-normal ${STATUS_TONE[item.status] ?? 'border border-[var(--border)] text-[var(--muted)]'}`}
            >
              {t(`results.status.${item.status}`)}
            </span>
          </div>
          <p className="mt-1 text-[0.8125rem] text-[var(--muted)]">
            {t('results.checked', { ago: t(`results.ago.${when.key}`, { n: when.n }) })}
            {item.free && ` · ${t('results.provider', { name: item.free.providerName })}`}
          </p>
          {item.reasons.length > 0 && (
            <ul className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-sm text-[var(--muted)]">
              {item.reasons.slice(0, 3).map((r) => (
                <li key={r.id}>{reasonText(r)}</li>
              ))}
            </ul>
          )}
        </div>

        {p && (
          <div className="flex flex-col tabular-nums sm:items-end sm:text-right">
            <p className="flex items-baseline gap-1.5">
              <span className="wordmark text-[1.15rem]" data-testid="price">
                {money(p.minYears > 1 ? p.upfrontUsdCents : p.firstYearUsdCents)}
              </span>
              <span className="text-[0.8125rem] text-[var(--muted)]">
                {p.minYears > 1
                  ? t('results.minTermShort', { years: p.minYears })
                  : t('results.firstYearShort')}
              </span>
            </p>
            <p
              className={`text-[0.8125rem] ${p.renewWarning ? 'font-medium text-[var(--warn)]' : 'text-[var(--muted)]'}`}
            >
              {t('results.renews', { price: money(p.renewUsdCents) })}
            </p>
            <p className="text-xs text-[var(--muted)]">{t('results.priceFrom', { source: p.source })}</p>
          </div>
        )}

        <div className="flex items-center gap-2 sm:justify-end">
          {!isFree && <WatchStar item={item} onNote={setNote} />}
          {p?.buyUrl && (
            <a
              href={p.buyUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={t('results.buyAt', { name: item.fqdn, source: p.source })}
              className="btn btn-dark flex-1 sm:flex-none"
            >
              {t('results.buy')}
            </a>
          )}
          {item.free && (
            <a
              href={item.free.conditions.url}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-ghost flex-1 sm:flex-none"
            >
              {t('results.officialSite')}
            </a>
          )}
        </div>
      </div>

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

      {item.free && (
        <details className="text-sm">
          <summary className="cursor-pointer font-medium text-[var(--accent)] underline underline-offset-2">
            {t('results.steps')}
          </summary>
          <ol className="mt-1.5 list-decimal pl-5">
            {item.free.conditions.steps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
          <p className="mt-1">{t('results.waitTime', { time: item.free.conditions.waitTime })}</p>
          <p>{t('results.eligibility', { text: item.free.conditions.eligibility })}</p>
        </details>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={onCopy}
          aria-label={t('results.copyName', { name: item.fqdn })}
          className={small}
        >
          {t('results.copy')}
        </button>
        {!isFree && (
          <button
            type="button"
            onClick={onRecheck}
            disabled={busy}
            aria-label={t('results.recheckName', { name: item.fqdn })}
            className={small}
          >
            {busy ? t('results.rechecking') : t('results.recheck')}
          </button>
        )}
        <span className="ml-auto flex gap-1.5">
          <button
            type="button"
            aria-pressed={vote === 1}
            aria-label={t('results.thumbsUp', { name: item.fqdn })}
            onClick={() => onVote(1)}
            className={`${small} ${vote === 1 ? 'border-[var(--accent)] bg-[var(--accent-soft)]' : ''}`}
          >
            <span aria-hidden="true">👍</span>
          </button>
          <button
            type="button"
            aria-pressed={vote === -1}
            aria-label={t('results.thumbsDown', { name: item.fqdn })}
            onClick={() => onVote(-1)}
            className={`${small} ${vote === -1 ? 'border-[var(--accent)] bg-[var(--accent-soft)]' : ''}`}
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
