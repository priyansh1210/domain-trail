'use client';
// "Save search" and the watch star (spec 011 US-2, US-3, FR-ACC-004, 005, 017). Signed-out visitors can save too:
// the first save creates an anonymous session on the server (no description is ever stored for them).
import type { ResultItem } from '@domains-all/core/client';
import Link from 'next/link';
import { useState } from 'react';
import {
  type SaveOutcome,
  saveSearch,
  unwatchName,
  useAccount,
  useHumanToken,
  watchName,
} from '@/lib/client/account';
import { recallInput } from '@/lib/client/search';
import { t } from '@/lib/i18n';

function outcomeText(outcome: SaveOutcome, message: string | undefined): string {
  if (outcome === 'unavailable') return t('results.saveUnavailable');
  if (outcome === 'human') return t('results.saveHuman');
  if (outcome === 'limit') return message ?? t('form.errorGeneric');
  return t('form.errorGeneric');
}

export function SaveSearchButton({
  searchRef,
  suggestedTitle,
}: {
  searchRef: string;
  suggestedTitle: string;
}) {
  const token = useHumanToken();
  const saved = useAccount((s) => s.saved[searchRef]);
  const anonymous = useAccount((s) => s.session?.user?.isAnonymous ?? true);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(suggestedTitle);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const r = await saveSearch(
      searchRef,
      title.trim() || suggestedTitle,
      recallInput(searchRef)?.description,
      token,
    );
    setBusy(false);
    if (r.outcome === 'ok') {
      setOpen(false);
      const nowAnonymous = useAccount.getState().session?.user?.isAnonymous ?? anonymous;
      setNote(t(nowAnonymous ? 'results.saveOkAnonymous' : 'results.saveOk'));
    } else setNote(outcomeText(r.outcome, r.message));
  }

  return (
    <div className="flex flex-col items-end gap-1 text-sm">
      {saved ? (
        <Link
          href="/account"
          className="rounded-lg border border-[var(--accent)] px-3 py-1.5"
          data-testid="saved-search"
        >
          ★ {t('results.savedSearch')}
        </Link>
      ) : open ? (
        <form onSubmit={save} className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="save-title">
            {t('results.saveSearchTitle')}
          </label>
          <input
            id="save-title"
            value={title}
            maxLength={80}
            onChange={(e) => setTitle(e.target.value)}
            className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2 py-1"
          />
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-[var(--accent)] px-3 py-1.5 font-semibold text-[var(--on-accent)] disabled:opacity-60"
          >
            {t('results.saveConfirm')}
          </button>
          <button type="button" onClick={() => setOpen(false)} className="underline">
            {t('results.saveCancel')}
          </button>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-lg border border-[var(--border)] px-3 py-1.5"
        >
          ☆ {t('results.saveSearch')}
        </button>
      )}
      <p role="status" className="text-xs text-[var(--muted)] empty:hidden">
        {note}
      </p>
    </div>
  );
}

export function WatchStar({
  item,
  onNote,
}: {
  item: Pick<ResultItem, 'fqdn' | 'status' | 'price'>;
  onNote: (text: string) => void;
}) {
  const token = useHumanToken();
  const watching = useAccount((s) => Boolean(s.watched[item.fqdn]));
  const [busy, setBusy] = useState(false);

  async function toggle() {
    setBusy(true);
    if (watching) {
      if (await unwatchName(item.fqdn)) onNote(t('results.unwatchOk', { name: item.fqdn }));
    } else {
      const r = await watchName(item, token);
      onNote(
        r.outcome === 'ok' ? t('results.watchOk', { name: item.fqdn }) : outcomeText(r.outcome, r.message),
      );
    }
    setBusy(false);
  }

  return (
    <button
      type="button"
      aria-pressed={watching}
      aria-label={t(watching ? 'results.unwatch' : 'results.watch', { name: item.fqdn })}
      onClick={toggle}
      disabled={busy}
      className={`rounded-lg border px-2 py-1 ${watching ? 'border-[var(--accent)] text-[var(--accent)]' : 'border-[var(--border)]'}`}
      data-testid="watch-star"
    >
      <span aria-hidden="true">{watching ? '★' : '☆'}</span>
    </button>
  );
}
