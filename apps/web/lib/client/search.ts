'use client';
// Client side of the search stream (spec 001 tech §1 step 8, spec 009 tech §4–5). The description stays in this
// browser tab's sessionStorage only (FR-INT-012); the server never stores it.
import type { Preferences, SiteProfile } from '@domains-all/core/client';
import { fetchEventSource } from '@microsoft/fetch-event-source';
import { create } from 'zustand';

export type Phase =
  'starting' | 'features' | 'done' | 'needs_detail' | 'refused' | 'error' | 'expired' | 'not_found';

export interface SearchInput {
  description: string;
  preferences: Preferences;
}

export interface SearchView {
  phase: Phase;
  profile?: SiteProfile;
  degraded?: 'jev_unavailable' | 'budget';
  hints?: string[];
  notSaved?: boolean;
  cached?: boolean;
}

export type StartError =
  | { kind: 'validation'; fields: Record<string, string> }
  | { kind: 'human' }
  | { kind: 'limited'; retryAfterSec: number }
  | { kind: 'unavailable' }
  | { kind: 'generic' };

interface Store {
  byRef: Record<string, SearchView>;
  set(ref: string, patch: Partial<SearchView>): void;
}

export const useSearchStore = create<Store>((set) => ({
  byRef: {},
  set: (ref, patch) =>
    set((s) => ({ byRef: { ...s.byRef, [ref]: { ...(s.byRef[ref] ?? { phase: 'starting' }), ...patch } } })),
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

/**
 * Starts a search. Resolves with the search reference once the server has created it (the caller then navigates
 * to the results page); later events keep updating the store.
 */
export function startSearch(
  input: SearchInput,
  turnstileToken: string,
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

    fetchEventSource('/api/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...input, turnstileToken, clientRequestId: crypto.randomUUID() }),
      openWhenHidden: true,
      async onopen(res) {
        if (res.ok && res.headers.get('content-type')?.includes('text/event-stream')) return;
        const body = (await res.json().catch(() => ({}))) as {
          fields?: Record<string, string>;
          retryAfterSec?: number;
          ref?: string;
        };
        if (res.status === 409 && body.ref) settle({ ref: body.ref });
        else if (res.status === 400) settle({ error: { kind: 'validation', fields: body.fields ?? {} } });
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
          set(ref, { phase: 'starting', cached: Boolean(data.cached) });
          settle({ ref });
          return;
        }
        if (!ref) return;
        switch (ev.event) {
          case 'features':
            set(ref, { phase: 'features', profile: data as unknown as SiteProfile });
            break;
          case 'degraded':
            set(ref, { degraded: data.reason as SearchView['degraded'] });
            break;
          case 'notice':
            if (data.code === 'not_saved') set(ref, { notSaved: true });
            break;
          case 'needs_detail':
            set(ref, { phase: 'needs_detail', hints: data.hints as string[] });
            break;
          case 'refused':
            set(ref, { phase: 'refused' });
            break;
          case 'done':
            set(ref, { phase: 'done' });
            break;
          case 'error':
            set(ref, { phase: 'error' });
            break;
        }
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
  const snap = (await res.json()) as { status: string; profile: SiteProfile | null; degraded: boolean };
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
    profile: snap.profile ?? undefined,
    ...(snap.degraded ? { degraded: 'jev_unavailable' } : {}),
  });
}
