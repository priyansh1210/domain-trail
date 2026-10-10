'use client';
// Client side of the search stream (spec 001 tech §1 step 8, spec 009 tech §4–5). The description stays in this
// browser tab's sessionStorage only (FR-INT-012); the server never stores it.
import type { Preferences, ResultItem, Section, SiteProfile } from '@domains-all/core/client';
import type { FxTable } from '@domains-all/pricing/client';
import { fetchEventSource } from '@microsoft/fetch-event-source';
import { create } from 'zustand';

export type Phase =
  'starting' | 'features' | 'done' | 'needs_detail' | 'refused' | 'error' | 'expired' | 'not_found';

export type Stage = 'features' | 'names' | 'availability' | 'done';

export interface SearchInput {
  description: string;
  preferences: Preferences;
}

export interface PricingInfo {
  fx: FxTable;
  pricesAt: string;
  source: string;
  stale?: boolean;
}

export type NoticeCode = 'avl_paused' | 'stale_prices' | 'low_supply' | 'partial';

export interface SearchView {
  phase: Phase;
  stage?: Stage;
  profile?: SiteProfile;
  degraded?: 'jev_unavailable' | 'budget';
  hints?: string[];
  notSaved?: boolean;
  cached?: boolean;
  results?: Record<string, ResultItem>;
  /** Final order per section, known when the stream is done. */
  sections?: Partial<Record<Section, string[]>>;
  pricing?: PricingInfo;
  notices?: NoticeCode[];
  /** "Find more" is running for these bands. */
  findingMore?: boolean;
}

export type StartError =
  | { kind: 'validation'; fields: Record<string, string> }
  | { kind: 'human' }
  | { kind: 'auth' }
  | { kind: 'no_changes' }
  | { kind: 'no_description' }
  | { kind: 'limited'; retryAfterSec: number }
  | { kind: 'unavailable' }
  | { kind: 'generic' };

interface Store {
  byRef: Record<string, SearchView>;
  set(ref: string, patch: Partial<SearchView>): void;
  update(ref: string, fn: (v: SearchView) => Partial<SearchView>): void;
}

export const useSearchStore = create<Store>((set) => ({
  byRef: {},
  set: (ref, patch) =>
    set((s) => ({ byRef: { ...s.byRef, [ref]: { ...(s.byRef[ref] ?? { phase: 'starting' }), ...patch } } })),
  update: (ref, fn) =>
    set((s) => {
      const cur = s.byRef[ref] ?? { phase: 'starting' as const };
      return { byRef: { ...s.byRef, [ref]: { ...cur, ...fn(cur) } } };
    }),
}));

const SESSION_PREFIX = 'search:';

export function rememberInput(ref: string, input: SearchInput): void {
  try {
    sessionStorage.setItem(SESSION_PREFIX + ref, JSON.stringify(input));
  } catch {
    // private mode: reloads fall back to the shared-link snapshot
  }
}

export function recallInput(ref: string): SearchInput | null {
  try {
    const raw = sessionStorage.getItem(SESSION_PREFIX + ref);
    return raw ? (JSON.parse(raw) as SearchInput) : null;
  } catch {
    return null;
  }
}

class StopError extends Error {}

function addNotice(v: SearchView, code: NoticeCode): Partial<SearchView> {
  return { notices: [...new Set([...(v.notices ?? []), code])] };
}

/** Applies one stream event to the view (shared by the first search and "find more"). */
function applyEvent(
  ref: string,
  event: string,
  data: Record<string, unknown>,
  opts: { more?: boolean } = {},
) {
  const { set, update } = useSearchStore.getState();
  switch (event) {
    case 'features':
      set(ref, { phase: 'features', stage: 'names', profile: data as unknown as SiteProfile });
      break;
    case 'progress':
      if (data.stage === 'availability') set(ref, { stage: 'availability' });
      break;
    case 'pricing':
      set(ref, { pricing: data as unknown as PricingInfo });
      break;
    case 'batch':
      update(ref, (v) => {
        const results = { ...(v.results ?? {}) };
        for (const r of data.results as ResultItem[]) results[r.fqdn] = r;
        return { results };
      });
      break;
    case 'update':
      update(ref, (v) => {
        const results = { ...(v.results ?? {}) };
        const fqdn = String(data.fqdn);
        if (data.status === 'taken' || data.status === 'dropping_soon') delete results[fqdn];
        else if (results[fqdn])
          results[fqdn] = {
            ...results[fqdn],
            status: data.status as ResultItem['status'],
            checkedAt: String(data.checkedAt),
          };
        return { results };
      });
      break;
    case 'degraded':
      set(ref, { degraded: data.reason as SearchView['degraded'] });
      break;
    case 'notice':
      if (data.code === 'not_saved') set(ref, { notSaved: true });
      else update(ref, (v) => addNotice(v, data.code as NoticeCode));
      break;
    case 'needs_detail':
      set(ref, { phase: 'needs_detail', hints: data.hints as string[] });
      break;
    case 'refused':
      set(ref, { phase: 'refused' });
      break;
    case 'done': {
      const sections = (data.sections ?? {}) as Partial<Record<Section, string[]>>;
      update(ref, (v) => {
        if (!opts.more) return { phase: 'done', stage: 'done', sections };
        // "Find more": new names go after the ones already shown, in their own best-first order.
        const merged: Partial<Record<Section, string[]>> = { ...(v.sections ?? {}) };
        for (const [s, list] of Object.entries(sections) as Array<[Section, string[]]>)
          merged[s] = [...(merged[s] ?? []), ...list.filter((f) => !(merged[s] ?? []).includes(f))];
        return { sections: merged, findingMore: false };
      });
      break;
    }
    case 'error':
      if (opts.more) set(ref, { findingMore: false });
      else set(ref, { phase: 'error' });
      break;
  }
}

/**
 * Opens a results stream (a new search, or a refine with edited features). Resolves with the new search reference
 * once the server has created it (the caller then navigates to the results page); later events keep updating the
 * store.
 */
function openStream(
  url: string,
  payload: Record<string, unknown>,
  input: SearchInput,
): Promise<{ ref: string } | { error: StartError }> {
  const { set } = useSearchStore.getState();
  let ref: string | undefined;

  return new Promise((resolve) => {
    let settled = false;
    const settle = (v: { ref: string } | { error: StartError }) => {
      if (!settled) {
        settled = true;
        resolve(v);
      }
    };

    fetchEventSource(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      openWhenHidden: true,
      async onopen(res) {
        if (res.ok && res.headers.get('content-type')?.includes('text/event-stream')) return;
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
          fields?: Record<string, string>;
          retryAfterSec?: number;
          ref?: string;
        };
        if (res.status === 409 && body.ref) settle({ ref: body.ref });
        else if (res.status === 400 && body.error === 'no_changes') settle({ error: { kind: 'no_changes' } });
        else if (res.status === 400) settle({ error: { kind: 'validation', fields: body.fields ?? {} } });
        else if (res.status === 401) settle({ error: { kind: 'auth' } });
        else if (res.status === 403) settle({ error: { kind: 'human' } });
        else if (res.status === 429)
          settle({ error: { kind: 'limited', retryAfterSec: body.retryAfterSec ?? 600 } });
        else if (res.status === 503) settle({ error: { kind: 'unavailable' } });
        else settle({ error: { kind: 'generic' } });
        throw new StopError();
      },
      onmessage(ev) {
        const data = ev.data ? (JSON.parse(ev.data) as Record<string, unknown>) : {};
        if (ev.event === 'search_created') {
          ref = String(data.ref);
          rememberInput(ref, input);
          set(ref, { phase: 'starting', stage: 'features', cached: Boolean(data.cached), results: {} });
          settle({ ref });
          return;
        }
        if (ref) applyEvent(ref, ev.event, data);
      },
      onclose() {
        if (!ref) settle({ error: { kind: 'generic' } });
      },
      onerror(err) {
        if (!(err instanceof StopError)) {
          if (ref) set(ref, { phase: 'error' });
          settle({ error: { kind: 'generic' } });
        }
        throw err; // never auto-retry a search
      },
    }).catch(() => undefined);
  });
}

/** Starts a search (spec 001 tech §1 step 8). */
export function startSearch(
  input: SearchInput,
  turnstileToken: string,
): Promise<{ ref: string } | { error: StartError }> {
  return openStream('/api/search', { ...input, turnstileToken, clientRequestId: crypto.randomUUID() }, input);
}

/** Results again with edited feature chips (spec 003 FR-FEAT-011); signed-in users only. */
export async function refineSearch(
  ref: string,
  featureEdits: Record<string, unknown>,
  turnstileToken: string,
): Promise<{ ref: string } | { error: StartError }> {
  const input = recallInput(ref);
  if (!input) return { error: { kind: 'no_description' } };
  return openStream(
    `/api/search/${encodeURIComponent(ref)}/refine`,
    { description: input.description, featureEdits, turnstileToken },
    input,
  );
}

/** "Find more in this range" (FR-PRC-009): new names in the band, excluding everything already shown. */
export async function findMore(
  ref: string,
  band: { minCents: number; maxCents: number | null; basis: 'upfront' | 'renewal' },
  turnstileToken = 'none',
): Promise<'ok' | 'no_description' | 'limited' | 'error'> {
  const input = recallInput(ref);
  if (!input) return 'no_description';
  const { set, byRef } = useSearchStore.getState();
  const exclude = Object.keys(byRef[ref]?.results ?? {}).slice(0, 500);
  set(ref, { findingMore: true });
  let outcome: 'ok' | 'limited' | 'error' = 'ok';
  await fetchEventSource(`/api/search/${encodeURIComponent(ref)}/more`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      ...input,
      turnstileToken,
      priceMinCents: band.minCents,
      priceMaxCents: band.maxCents,
      basis: band.basis,
      exclude,
    }),
    openWhenHidden: true,
    async onopen(res) {
      if (res.ok && res.headers.get('content-type')?.includes('text/event-stream')) return;
      outcome = res.status === 429 ? 'limited' : 'error';
      throw new StopError();
    },
    onmessage(ev) {
      applyEvent(ref, ev.event, ev.data ? (JSON.parse(ev.data) as Record<string, unknown>) : {}, {
        more: true,
      });
    },
    onerror(err) {
      if (!(err instanceof StopError)) outcome = 'error';
      throw err;
    },
  }).catch(() => undefined);
  if (outcome !== 'ok') set(ref, { findingMore: false });
  return outcome;
}

/** Fresh check of one name (FR-AVL-014). Taken names leave the list; others get the new status and time. */
export async function recheck(ref: string, fqdn: string): Promise<'ok' | 'limited' | 'error'> {
  const res = await fetch(`/api/domains/${encodeURIComponent(fqdn)}/recheck`, { method: 'POST' }).catch(
    () => null,
  );
  if (!res) return 'error';
  if (res.status === 429) return 'limited';
  if (!res.ok) return 'error';
  const body = (await res.json()) as {
    status: ResultItem['status'];
    checkedAt: string;
    price?: ResultItem['price'];
  };
  useSearchStore.getState().update(ref, (v) => {
    const results = { ...(v.results ?? {}) };
    const cur = results[fqdn];
    if (!cur) return {};
    if (body.status === 'taken' || body.status === 'dropping_soon') delete results[fqdn];
    else
      results[fqdn] = {
        ...cur,
        status: body.status,
        checkedAt: body.checkedAt,
        ...(body.price ? { price: body.price } : {}),
      };
    return { results };
  });
  return 'ok';
}

/** Thumbs up/down (FR-RANK-012); failures are silent — feedback is optional. */
export async function sendFeedback(ref: string, fqdn: string, vote: 1 | -1): Promise<void> {
  await fetch('/api/feedback', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ searchRef: ref, fqdn, vote }),
  }).catch(() => undefined);
}

/** Shared links and reloads without the description: load the stored snapshot. */
export async function loadSnapshot(ref: string): Promise<void> {
  const { set } = useSearchStore.getState();
  const res = await fetch(`/api/search/${encodeURIComponent(ref)}`, { cache: 'no-store' }).catch(() => null);
  if (!res) return set(ref, { phase: 'error' });
  if (res.status === 404) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    return set(ref, { phase: body.error === 'expired' ? 'expired' : 'not_found' });
  }
  if (!res.ok) return set(ref, { phase: 'error' });
  const snap = (await res.json()) as {
    status: string;
    profile: SiteProfile | null;
    degraded: boolean;
    results?: ResultItem[];
    sections?: Partial<Record<Section, string[]>>;
    pricing?: PricingInfo;
  };
  const phase: Phase =
    snap.status === 'done'
      ? 'done'
      : snap.status === 'refused'
        ? 'refused'
        : snap.status === 'needs_detail'
          ? 'needs_detail'
          : snap.status === 'error'
            ? 'error'
            : 'starting';
  set(ref, {
    phase,
    stage: phase === 'done' ? 'done' : undefined,
    profile: snap.profile ?? undefined,
    results: Object.fromEntries((snap.results ?? []).map((r) => [r.fqdn, r])),
    sections: snap.sections ?? {},
    ...(snap.pricing ? { pricing: snap.pricing } : {}),
    ...(snap.degraded ? { degraded: 'jev_unavailable' } : {}),
  });
}
