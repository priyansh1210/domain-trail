'use client';
// "Preferred extensions" (spec 001 FR-INT-005): type an extension, press Enter or a comma, and it becomes a tag.
// Suggestions come from /api/tlds, downloaded the first time the box is used. Without that list (offline) any
// well-formed extension is accepted and the server has the final say.
import { useId, useMemo, useRef, useState } from 'react';

const MAX = 20;
const POPULAR = [
  'com',
  'in',
  'co.in',
  'net',
  'org',
  'co',
  'io',
  'ai',
  'app',
  'dev',
  'shop',
  'store',
  'online',
  'site',
  'xyz',
  'tech',
  'me',
  'info',
  'studio',
  'design',
  'blog',
  'co.uk',
  'uk',
  'us',
  'ca',
  'de',
];
const rank = (t: string) => {
  const i = POPULAR.indexOf(t);
  return i < 0 ? 999 : i;
};
const WELL_FORMED = /^[a-z0-9-]+(\.[a-z0-9-]+)?$/;
const clean = (v: string) => v.trim().toLowerCase().replace(/^\.+/, '').replace(/\.+$/, '');

let listPromise: Promise<string[]> | null = null;
function loadList(): Promise<string[]> {
  listPromise ??= fetch('/api/tlds')
    .then((r) => (r.ok ? (r.json() as Promise<string[]>) : []))
    .catch(() => []);
  return listPromise;
}

type Text = (key: string, vars?: Record<string, string | number>) => string;

export function TldInput({
  value,
  onChange,
  text,
}: {
  value: string[];
  onChange: (tlds: string[]) => void;
  text: Text;
}) {
  const ids = { label: useId(), input: useId(), list: useId(), hint: useId(), error: useId() };
  const input = useRef<HTMLInputElement>(null);
  const [list, setList] = useState<string[] | null>(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [error, setError] = useState('');
  const known = useMemo(() => (list && list.length ? new Set(list) : null), [list]);

  const q = clean(query);
  const options = useMemo(() => {
    if (!q || !list) return [];
    return list
      .filter((t) => t.startsWith(q) && !value.includes(t))
      .sort(
        (a, b) =>
          Number(b === q) - Number(a === q) || rank(a) - rank(b) || a.length - b.length || a.localeCompare(b),
      )
      .slice(0, 8);
  }, [q, list, value]);
  const showList = open && q.length > 0 && list !== null;

  function warm() {
    if (!list) void loadList().then(setList);
  }

  /** Adds what was typed; returns the parts that could not be added. */
  function commit(raw: string): string[] {
    const next = [...value];
    const left: string[] = [];
    let message = '';
    for (const part of raw
      .split(/[\s,]+/)
      .map(clean)
      .filter(Boolean)) {
      if (!WELL_FORMED.test(part) || (known && !known.has(part))) {
        message = text('form.tldsUnknown', { tld: `.${part}` });
        left.push(part);
      } else if (next.includes(part)) {
        continue;
      } else if (next.length >= MAX) {
        message = text('form.tldsMax', { max: MAX });
        left.push(part);
      } else next.push(part);
    }
    if (next.length !== value.length) onChange(next);
    setError(message);
    return left;
  }

  function pick(t: string) {
    commit(t);
    setQuery('');
    setOpen(false);
    input.current?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && options.length) {
      e.preventDefault();
      setOpen(true);
      setActive((a) => (a + (e.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length);
    } else if (e.key === 'Enter' && query.trim()) {
      e.preventDefault(); // add the extension, don't submit the form
      const chosen = showList && options[active] ? options[active]! : query;
      setQuery(commit(chosen).join(', '));
      setOpen(false);
    } else if (e.key === 'Backspace' && !query && value.length) {
      onChange(value.slice(0, -1));
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  function onType(v: string) {
    if (/[\s,]/.test(v.trimStart())) {
      setQuery(commit(v).join(', '));
      setOpen(false);
      return;
    }
    setQuery(v);
    setActive(0);
    setOpen(true);
    if (error) setError('');
  }

  const describedBy = error ? `${ids.hint} ${ids.error}` : ids.hint;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={ids.input} id={ids.label} className="font-semibold">
          {text('form.preferredTlds')}
        </label>
        <span className="text-[0.8125rem] text-[var(--muted)] tabular-nums">
          {value.length ? text('form.tldsCount', { n: value.length, max: MAX }) : text('form.tldsOptional')}
        </span>
      </div>
      <div className="relative">
        <div className="tokens" onClick={() => input.current?.focus()}>
          {value.length > 0 && (
            <ul className="token-list" aria-label={text('form.tldsChosen')}>
              {value.map((t) => (
                <li key={t} className="token">
                  <span>.{t}</span>
                  <button
                    type="button"
                    aria-label={text('form.tldsRemove', { tld: `.${t}` })}
                    onClick={(e) => {
                      e.stopPropagation();
                      onChange(value.filter((x) => x !== t));
                      input.current?.focus();
                    }}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
          <input
            ref={input}
            id={ids.input}
            type="text"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={showList && options.length > 0}
            aria-controls={ids.list}
            aria-activedescendant={showList && options[active] ? `${ids.list}-${active}` : undefined}
            aria-describedby={describedBy}
            aria-invalid={error ? true : undefined}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            value={query}
            placeholder={value.length ? text('form.tldsAddAnother') : text('form.tldsPlaceholder')}
            onFocus={warm}
            onChange={(e) => onType(e.target.value)}
            onKeyDown={onKeyDown}
            onBlur={() => {
              setOpen(false);
              if (query.trim()) setQuery(commit(query).join(', '));
            }}
          />
        </div>
        {showList && (
          <ul id={ids.list} role="listbox" aria-labelledby={ids.label} className="suggest">
            {options.length ? (
              options.map((t, i) => (
                <li
                  key={t}
                  id={`${ids.list}-${i}`}
                  role="option"
                  aria-selected={i === active}
                  onMouseDown={(e) => {
                    e.preventDefault(); // keep focus in the box
                    pick(t);
                  }}
                  onMouseEnter={() => setActive(i)}
                >
                  <span className="domain">
                    .<mark>{t.slice(0, q.length)}</mark>
                    {t.slice(q.length)}
                  </span>
                  {rank(t) < 999 && <span className="meta">{text('form.tldsPopular')}</span>}
                </li>
              ))
            ) : (
              <li className="none" role="option" aria-selected={false} aria-disabled="true">
                {text('form.tldsNone', { q: `.${q}` })}
              </li>
            )}
          </ul>
        )}
      </div>
      <p id={ids.hint} className="text-[0.8125rem] text-[var(--muted)]">
        {value.length ? text('form.tldsHintSome') : text('form.tldsHint')}
      </p>
      {error && (
        <p id={ids.error} role="alert" className="text-sm font-medium text-[var(--danger)]">
          {error}
        </p>
      )}
    </div>
  );
}
