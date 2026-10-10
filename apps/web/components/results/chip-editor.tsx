'use client';
// Chip editing (spec 003 US-2, FR-FEAT-011): signed-in users change or remove detected features; the results are
// ranked again with the edited profile, without repeating detection. Native selects keep it keyboard- and
// screen-reader-friendly.
import { EDIT_OPTIONS, FLAG_KEYS, type SiteProfile } from '@domains-all/core/client';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { useHumanToken } from '@/lib/client/account';
import { refineSearch } from '@/lib/client/search';
import { messages, t } from '@/lib/i18n';
import { EDITABLE_FIELDS, flagLabel, optionLabel } from '@/lib/labels';

type Edits = {
  siteType?: string;
  industry?: string;
  audience?: string;
  geo?: string;
  language?: string;
  nameStyle?: string;
  tone?: number;
  flags?: Record<string, boolean>;
};

const selectClass = 'rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-sm';

export function ChipEditor({
  profile,
  searchRef,
  onCancel,
  onLeave,
}: {
  profile: SiteProfile;
  searchRef: string;
  onCancel: () => void;
  /** The new results open on another page; the current one must stop updating the address. */
  onLeave: () => void;
}) {
  const router = useRouter();
  const token = useHumanToken();
  const [edits, setEdits] = useState<Edits>({});
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  const flagsOn = useMemo(() => {
    const on = new Set(
      Object.entries(profile.flags)
        .filter(([, f]) => f.on)
        .map(([k]) => k),
    );
    for (const [k, v] of Object.entries(edits.flags ?? {})) {
      if (v) on.add(k);
      else on.delete(k);
    }
    return [...on];
  }, [profile.flags, edits.flags]);

  const setFlag = (key: string, on: boolean) =>
    setEdits((e) => ({ ...e, flags: { ...(e.flags ?? {}), [key]: on } }));

  async function apply() {
    setBusy(true);
    setNote('');
    const r = await refineSearch(searchRef, edits, await token());
    setBusy(false);
    if ('ref' in r) {
      onLeave();
      return router.push(`/s/${r.ref}`);
    }
    setNote(
      r.error.kind === 'no_description'
        ? t('results.editNeedsDescription')
        : r.error.kind === 'no_changes'
          ? t('results.editNoChanges')
          : r.error.kind === 'limited'
            ? t('results.findMoreLimited')
            : t('results.editFailed'),
    );
  }

  const toneLevels = messages.chips.toneLevels as string[];
  return (
    <div
      className="flex flex-col gap-4 rounded-lg border border-[var(--border)] p-3"
      data-testid="chip-editor"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {EDITABLE_FIELDS.map((field) => (
          <label key={field} className="flex flex-col gap-1 text-sm">
            {t(`chips.${field}`)}
            <select
              className={selectClass}
              value={edits[field] ?? profile[field].value}
              onChange={(e) => setEdits((x) => ({ ...x, [field]: e.target.value }))}
            >
              {EDIT_OPTIONS[field].map((key) => (
                <option key={key} value={key}>
                  {optionLabel(field, key)}
                </option>
              ))}
            </select>
          </label>
        ))}
        <label className="flex flex-col gap-1 text-sm">
          {t('chips.tone')}
          <select
            className={selectClass}
            value={edits.tone ?? profile.tone.level}
            onChange={(e) => setEdits((x) => ({ ...x, tone: Number(e.target.value) }))}
          >
            {toneLevels.map((label, i) => (
              <option key={label} value={i}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <ul className="flex flex-wrap gap-2">
        {flagsOn.map((k) => (
          <li
            key={k}
            className="flex items-center gap-1 rounded-full border border-[var(--border)] px-3 py-1 text-sm"
          >
            {flagLabel(k)}
            <button
              type="button"
              aria-label={t('results.removeFeature', { name: flagLabel(k) })}
              onClick={() => setFlag(k, false)}
              className="ml-1 rounded px-1"
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      <label className="flex flex-col gap-1 text-sm sm:max-w-xs">
        {t('results.addFeature')}
        <select
          className={selectClass}
          value=""
          onChange={(e) => e.target.value && setFlag(e.target.value, true)}
        >
          <option value="">—</option>
          {FLAG_KEYS.filter((k) => !flagsOn.includes(k)).map((k) => (
            <option key={k} value={k}>
              {flagLabel(k)}
            </option>
          ))}
        </select>
      </label>

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={apply}
          disabled={busy}
          className="rounded-lg bg-[var(--accent)] px-4 py-2 font-semibold text-[var(--on-accent)] disabled:opacity-60"
        >
          {t('results.applyEdits')}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-[var(--border)] px-4 py-2"
        >
          {t('results.cancelEdits')}
        </button>
      </div>
      <p role="status" className="text-sm empty:hidden">
        {note}
      </p>
    </div>
  );
}
