// Search persistence (spec 012 tech §3: `searches`, `result_cache`; spec 002: `jev_usage`). Never stores the
// description (FR-DATA-002, FR-INT-012). Mock mode and missing configuration use the in-memory store.
import type { SiteProfile } from '@domains-all/core';
import type { UsageStore } from '@domains-all/jev';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export type SearchStatus = 'running' | 'done' | 'refused' | 'needs_detail' | 'error';

export interface SearchRecord {
  id: string;
  status: SearchStatus;
  features: SiteProfile | null;
  degraded: boolean;
  createdAt: string;
  expiresAt: string;
}

export interface SearchStore {
  readonly kind: 'supabase' | 'memory';
  createSearch(s: {
    id: string;
    cacheKey: string;
    prefs: unknown;
    pipelineVersion: string;
    expiresAt: string;
  }): Promise<void>;
  completeSearch(
    id: string,
    r: {
      status: SearchStatus;
      features?: SiteProfile | null;
      degraded: boolean;
      jevTokens: number;
      durationMs: number;
      stageMs: Record<string, number>;
    },
  ): Promise<void>;
  getSearch(id: string, now?: Date): Promise<SearchRecord | null>;
  cacheLookup(cacheKey: string, now?: Date): Promise<string | null>;
  cachePut(cacheKey: string, searchId: string, expiresAt: string): Promise<void>;
}

export class MemorySearchStore implements SearchStore {
  readonly kind = 'memory' as const;
  readonly searches = new Map<string, SearchRecord & { cacheKey: string; prefs: unknown }>();
  readonly cache = new Map<string, { searchId: string; expiresAt: string }>();

  async createSearch(s: {
    id: string;
    cacheKey: string;
    prefs: unknown;
    pipelineVersion: string;
    expiresAt: string;
  }) {
    if (this.searches.size > 5000) this.searches.clear(); // dev/preview only; bounded memory
    this.searches.set(s.id, {
      id: s.id,
      cacheKey: s.cacheKey,
      prefs: s.prefs,
      status: 'running',
      features: null,
      degraded: false,
      createdAt: new Date().toISOString(),
      expiresAt: s.expiresAt,
    });
  }

  async completeSearch(
    id: string,
    r: { status: SearchStatus; features?: SiteProfile | null; degraded: boolean },
  ) {
    const s = this.searches.get(id);
    if (s) Object.assign(s, { status: r.status, features: r.features ?? null, degraded: r.degraded });
  }

  async getSearch(id: string, now = new Date()) {
    const s = this.searches.get(id);
    if (!s || new Date(s.expiresAt) <= now) return null;
    const { cacheKey: _k, prefs: _p, ...record } = s;
    return record;
  }

  async cacheLookup(cacheKey: string, now = new Date()) {
    const c = this.cache.get(cacheKey);
    return c && new Date(c.expiresAt) > now ? c.searchId : null;
  }

  async cachePut(cacheKey: string, searchId: string, expiresAt: string) {
    this.cache.set(cacheKey, { searchId, expiresAt });
  }
}

export function supabaseAdmin(url: string, serviceRoleKey: string): SupabaseClient {
  return createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

function check<T>(r: { data: T; error: { message: string } | null }): T {
  if (r.error) throw new Error(`supabase: ${r.error.message}`);
  return r.data;
}

export class SupabaseSearchStore implements SearchStore {
  readonly kind = 'supabase' as const;
  constructor(private readonly sb: SupabaseClient) {}

  async createSearch(s: {
    id: string;
    cacheKey: string;
    prefs: unknown;
    pipelineVersion: string;
    expiresAt: string;
  }) {
    check(
      await this.sb.from('searches').insert({
        id: s.id,
        cache_key: s.cacheKey,
        status: 'running',
        prefs: s.prefs,
        pipeline_version: s.pipelineVersion,
        expires_at: s.expiresAt,
      }),
    );
  }

  async completeSearch(
    id: string,
    r: {
      status: SearchStatus;
      features?: SiteProfile | null;
      degraded: boolean;
      jevTokens: number;
      durationMs: number;
      stageMs: Record<string, number>;
    },
  ) {
    check(
      await this.sb
        .from('searches')
        .update({
          status: r.status,
          features: r.features ?? null,
          degraded: r.degraded,
          jev_tokens: r.jevTokens,
          duration_ms: r.durationMs,
          stage_ms: r.stageMs,
        })
        .eq('id', id),
    );
  }

  async getSearch(id: string, now = new Date()) {
    const row = check(
      await this.sb
        .from('searches')
        .select('id,status,features,degraded,created_at,expires_at')
        .eq('id', id)
        .gt('expires_at', now.toISOString())
        .maybeSingle(),
    ) as {
      id: string;
      status: SearchStatus;
      features: SiteProfile | null;
      degraded: boolean;
      created_at: string;
      expires_at: string;
    } | null;
    return row
      ? {
          id: row.id,
          status: row.status,
          features: row.features,
          degraded: row.degraded,
          createdAt: row.created_at,
          expiresAt: row.expires_at,
        }
      : null;
  }

  async cacheLookup(cacheKey: string, now = new Date()) {
    const row = check(
      await this.sb
        .from('result_cache')
        .select('search_id')
        .eq('cache_key', cacheKey)
        .gt('expires_at', now.toISOString())
        .maybeSingle(),
    ) as { search_id: string } | null;
    return row?.search_id ?? null;
  }

  async cachePut(cacheKey: string, searchId: string, expiresAt: string) {
    check(
      await this.sb
        .from('result_cache')
        .upsert({ cache_key: cacheKey, search_id: searchId, expires_at: expiresAt }),
    );
  }
}

/** Jev usage through the service-role RPCs of spec 012 (`jev_usage_add`, `month_jev_tokens`). */
export class SupabaseUsageStore implements UsageStore {
  constructor(private readonly sb: SupabaseClient) {}

  async totals(now: Date) {
    const day = now.toISOString().slice(0, 10);
    const month = check(await this.sb.rpc('month_jev_tokens', { p_month: day })) as number | string | null;
    const today = check(
      await this.sb.from('jev_usage').select('input_tokens').eq('day', day).maybeSingle(),
    ) as {
      input_tokens: number | string;
    } | null;
    return { month: Number(month ?? 0), day: Number(today?.input_tokens ?? 0) };
  }

  async addSearch(e: { day: string; tokens: number; requests: number; degraded: boolean }) {
    check(
      await this.sb.rpc('jev_usage_add', {
        p_day: e.day,
        p_tokens: e.tokens,
        p_requests: e.requests,
        p_degraded: e.degraded,
      }),
    );
  }
}
