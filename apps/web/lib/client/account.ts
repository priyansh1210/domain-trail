'use client';
// Browser side of accounts and saving (spec 011 §5.1, §5.6). No sign-in library here: the server owns the session
// cookies; this module only calls our /api/me routes and remembers what is saved for the current page.
import type { ResultItem } from '@domains-all/core/client';
import { createContext, useContext } from 'react';
import { create } from 'zustand';

export interface SessionInfo {
  available: boolean;
  user: { isAnonymous: boolean; email: string | null; provider: string | null } | null;
  needsTerms: boolean;
  isAdmin: boolean;
}

interface AccountState {
  session?: SessionInfo;
  watched: Record<string, true>;
  saved: Record<string, string>; // searchRef → saved search id
  set(patch: Partial<Omit<AccountState, 'set'>>): void;
}

export const useAccount = create<AccountState>((set) => ({
  watched: {},
  saved: {},
  set: (patch) => set(patch),
}));

let loading: Promise<SessionInfo> | null = null;

/** Session summary, fetched once per page load (and again after sign-in changes). */
export function loadSession(force = false): Promise<SessionInfo> {
  if (!force && loading) return loading;
  loading = fetch('/api/me/session', { cache: 'no-store' })
    .then((r) => r.json() as Promise<SessionInfo>)
    .catch(() => ({ available: false, user: null, needsTerms: false, isAdmin: false }))
    .then((s) => {
      useAccount.getState().set({ session: s });
      return s;
    });
  return loading;
}

/** Saved names and searches of this browser's session, so stars and Save buttons show their state. */
export async function loadSaved(): Promise<void> {
  const s = await loadSession();
  if (!s.user) return;
  const [w, ss] = await Promise.all([
    fetch('/api/me/watchlist', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : [])),
    fetch('/api/me/saved-searches', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : [])),
  ]).catch(() => [[], []]);
  useAccount.getState().set({
    watched: Object.fromEntries((w as Array<{ fqdn: string }>).map((x) => [x.fqdn, true as const])),
    saved: Object.fromEntries(
      (ss as Array<{ id: string; searchRef: string | null }>)
        .filter((x) => x.searchRef)
        .map((x) => [x.searchRef!, x.id]),
    ),
  });
}

/** A Turnstile token for creating a signed-out saver session (provided by the results page). */
export const HumanTokenContext = createContext<() => Promise<string>>(async () => 'none');
export const useHumanToken = () => useContext(HumanTokenContext);

export type SaveOutcome = 'ok' | 'limit' | 'unavailable' | 'human' | 'error';

/** Signed-out visitors get an anonymous session on their first save (FR-ACC-017). */
async function ensureSaver(token: () => Promise<string>): Promise<SaveOutcome> {
  const s = await loadSession();
  if (!s.available) return 'unavailable';
  if (s.user) return 'ok';
  const res = await fetch('/api/me/anonymous', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ turnstileToken: await token() }),
  }).catch(() => null);
  if (!res) return 'error';
  if (res.status === 403) return 'human';
  if (res.status === 503) return 'unavailable';
  if (!res.ok) return 'error';
  await loadSession(true);
  return 'ok';
}

async function outcome(res: Response | null): Promise<{ outcome: SaveOutcome; message?: string }> {
  if (!res) return { outcome: 'error' };
  if (res.ok) return { outcome: 'ok' };
  const body = (await res.json().catch(() => ({}))) as { message?: string };
  return {
    outcome: res.status === 409 ? 'limit' : 'error',
    ...(body.message ? { message: body.message } : {}),
  };
}

export async function saveSearch(
  ref: string,
  title: string,
  description: string | undefined,
  token: () => Promise<string>,
): Promise<{ outcome: SaveOutcome; message?: string }> {
  const ready = await ensureSaver(token);
  if (ready !== 'ok') return { outcome: ready };
  const anonymous = useAccount.getState().session?.user?.isAnonymous ?? true;
  const res = await fetch('/api/me/saved-searches', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      searchRef: ref,
      title: title.slice(0, 80),
      // The description is kept only for signed-in users, so they can run the search again (FR-ACC-004, P5).
      ...(description && !anonymous ? { description } : {}),
    }),
  }).catch(() => null);
  const r = await outcome(res);
  if (r.outcome === 'ok') {
    const body = (await res!.json().catch(() => ({}))) as { id?: string };
    const { saved, set } = useAccount.getState();
    set({ saved: { ...saved, [ref]: body.id ?? 'saved' } });
  }
  return r;
}

export async function watchName(
  item: Pick<ResultItem, 'fqdn' | 'status' | 'price'>,
  token: () => Promise<string>,
): Promise<{ outcome: SaveOutcome; message?: string }> {
  const ready = await ensureSaver(token);
  if (ready !== 'ok') return { outcome: ready };
  const status = ['appears_free', 'not_verifiable'].includes(item.status) ? undefined : item.status;
  const res = await fetch('/api/me/watchlist', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      fqdn: item.fqdn,
      notifyOn: ['status_change', 'price_change'],
      ...(status ? { lastStatus: status } : {}),
      ...(item.price ? { lastUpfrontUsdCents: item.price.upfrontUsdCents } : {}),
    }),
  }).catch(() => null);
  const r = await outcome(res);
  if (r.outcome === 'ok') {
    const { watched, set } = useAccount.getState();
    set({ watched: { ...watched, [item.fqdn]: true } });
  }
  return r;
}

export async function unwatchName(fqdn: string): Promise<boolean> {
  const res = await fetch(`/api/me/watchlist/${encodeURIComponent(fqdn)}`, { method: 'DELETE' }).catch(
    () => null,
  );
  if (!res?.ok) return false;
  const { watched, set } = useAccount.getState();
  const next = { ...watched };
  delete next[fqdn];
  set({ watched: next });
  return true;
}

/** Sign-in link that returns to the current page (FR-ACC-003). */
export function signInHref(next: string): string {
  return `/sign-in?${new URLSearchParams({ next })}`;
}
