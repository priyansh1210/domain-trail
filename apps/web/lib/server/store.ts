// Search persistence (spec 012 tech §3: `searches`, `result_cache`; spec 002: `jev_usage`). Never stores the
// description (FR-DATA-002, FR-INT-012). Mock mode and missing configuration use the in-memory store.
import type { AvailabilityCache, CheckResult } from '@domains-all/availability';
import type { ResultItem, Section, SiteProfile, WordCache } from '@domains-all/core';
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
  /** Results with their final order per section (`search_results`, spec 012). */
  saveResults(id: string, r: StoredResults): Promise<void>;
  getResults(id: string): Promise<StoredResults>;
}

export interface StoredResults {
  results: ResultItem[];
  sections: Partial<Record<Section, string[]>>;
}

export class MemorySearchStore implements SearchStore {
  readonly kind = 'memory' as const;
  readonly searches = new Map<string, SearchRecord & { cacheKey: string; prefs: unknown }>();
  readonly cache = new Map<string, { searchId: string; expiresAt: string }>();
  readonly results = new Map<string, StoredResults>();

  async saveResults(id: string, r: StoredResults) {
    this.results.set(id, { results: [...r.results], sections: { ...r.sections } });
  }

  async getResults(id: string): Promise<StoredResults> {
    return this.results.get(id) ?? { results: [], sections: {} };
  }

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

  saveResults(id: string, r: StoredResults) {
    return saveResultRows(this.sb, id, r);
  }

  getResults(id: string) {
    return getResultRows(this.sb, id);
  }
}

/** One `search_results` row per result: rank = position in its section's final order (9999 = beyond the lists). */
export async function saveResultRows(sb: SupabaseClient, id: string, r: StoredResults) {
  if (r.results.length === 0) return;
  const rankOf = new Map<string, number>();
  for (const list of Object.values(r.sections)) list?.forEach((fqdn, i) => rankOf.set(fqdn, i));
  check(
    await sb.from('search_results').upsert(
      r.results.map((item) => ({
        search_id: id,
        fqdn: item.fqdn,
        section: item.section,
        rank: rankOf.get(item.fqdn) ?? 9999,
        score: item.score,
        status: item.status,
        upfront_cents: item.price?.upfrontUsdCents ?? null,
        renew_cents: item.price?.renewUsdCents ?? null,
        price_source: item.price?.source ?? null,
        signals: item,
        reasons: item.reasons,
        strategy: item.strategy,
      })),
    ),
  );
}

export async function getResultRows(sb: SupabaseClient, id: string): Promise<StoredResults> {
  const rows = check(
    await sb.from('search_results').select('fqdn,section,rank,signals').eq('search_id', id).order('rank'),
  ) as Array<{ fqdn: string; section: Section; rank: number; signals: ResultItem }> | null;
  const results = (rows ?? []).map((row) => row.signals);
  const sections: Partial<Record<Section, string[]>> = {};
  for (const row of rows ?? []) if (row.rank < 9999) (sections[row.section] ??= []).push(row.fqdn);
  return { results, sections };
}

/** Shared availability answers in `domain_checks` (spec 005 tech §3, FR-AVL-009). Extensions are added to `tlds`
 *  on first use until the daily registry job (M5) fills that table. */
export class SupabaseAvailabilityCache implements AvailabilityCache {
  private readonly knownTlds = new Set<string>();
  constructor(private readonly sb: SupabaseClient) {}

  async getMany(fqdns: readonly string[], now: number) {
    const out = new Map<string, CheckResult>();
    if (fqdns.length === 0) return out;
    const rows = check(
      await this.sb
        .from('domain_checks')
        .select(
          'fqdn,tld,status,method,premium_price_cents,premium_currency,premium_source,checked_at,expires_at',
        )
        .in('fqdn', [...fqdns])
        .gt('expires_at', new Date(now).toISOString()),
    ) as Array<{
      fqdn: string;
      tld: string;
      status: CheckResult['status'];
      method: Exclude<CheckResult['method'], 'cache'>;
      premium_price_cents: number | null;
      premium_currency: string | null;
      premium_source: string | null;
      checked_at: string;
      expires_at: string;
    }> | null;
    for (const r of rows ?? [])
      out.set(r.fqdn, {
        fqdn: r.fqdn,
        tld: r.tld,
        status: r.status,
        method: r.method,
        checkedAt: r.checked_at,
        expiresAt: r.expires_at,
        ...(r.premium_price_cents !== null
          ? {
              premium: {
                priceCents: r.premium_price_cents,
                currency: r.premium_currency ?? 'USD',
                source: r.premium_source ?? '',
              },
            }
          : {}),
      });
    return out;
  }

  async putMany(results: readonly CheckResult[]) {
    if (results.length === 0) return;
    const fresh = [...new Set(results.map((r) => r.tld))].filter((t) => !this.knownTlds.has(t));
    if (fresh.length) {
      check(
        await this.sb.from('tlds').upsert(
          fresh.map((tld) => ({
            tld,
            type: tld.includes('.') ? 'sld' : tld.length === 2 ? 'ccTLD' : 'gTLD',
          })),
          { onConflict: 'tld', ignoreDuplicates: true },
        ),
      );
      for (const t of fresh) this.knownTlds.add(t);
    }
    check(
      await this.sb.from('domain_checks').upsert(
        results.map((r) => ({
          fqdn: r.fqdn,
          tld: r.tld,
          status: r.status,
          method: r.method === 'cache' ? 'rdap' : r.method,
          premium_price_cents: r.premium?.priceCents ?? null,
          premium_currency: r.premium?.currency ?? null,
          premium_source: r.premium?.source ?? null,
          drop_window_start: r.dropWindow?.start ?? null,
          drop_window_end: r.dropWindow?.end ?? null,
          checked_at: r.checkedAt,
          expires_at: r.expiresAt,
        })),
      ),
    );
  }
}

/** Thumbs up/down per search, name and pseudonymous visitor (spec 008 §5.8, `feedback`). */
export interface FeedbackStore {
  vote(f: {
    searchId: string;
    fqdn: string;
    visitorHash: string;
    vote: 1 | -1;
    reason?: 'offensive' | 'brand' | 'other';
  }): Promise<void>;
}

export class MemoryFeedbackStore implements FeedbackStore {
  readonly votes = new Map<string, number>();
  async vote(f: Parameters<FeedbackStore['vote']>[0]) {
    if (this.votes.size > 50_000) this.votes.clear();
    this.votes.set(`${f.searchId}|${f.fqdn}|${f.visitorHash}`, f.vote);
  }
}

export class SupabaseFeedbackStore implements FeedbackStore {
  constructor(private readonly sb: SupabaseClient) {}
  async vote(f: Parameters<FeedbackStore['vote']>[0]) {
    check(
      await this.sb.from('feedback').upsert({
        search_id: f.searchId,
        fqdn: f.fqdn,
        visitor_hash: f.visitorHash,
        vote: f.vote,
        reason: f.reason ?? null,
      }),
    );
  }
}

/** Datamuse answers cached 30 days in `word_cache` (spec 004 tech §3, spec 012). */
export class SupabaseWordCache implements WordCache {
  constructor(
    private readonly sb: SupabaseClient,
    private readonly ttlDays = 30,
  ) {}

  async get(term: string, relation: string) {
    const since = new Date(Date.now() - this.ttlDays * 86_400_000).toISOString();
    const r = await this.sb
      .from('word_cache')
      .select('words')
      .eq('term', term)
      .eq('relation', relation)
      .gt('fetched_at', since)
      .maybeSingle();
    return r.error ? null : ((r.data as { words: string[] } | null)?.words ?? null);
  }

  async set(term: string, relation: string, words: string[]) {
    await this.sb.from('word_cache').upsert({ term, relation, words, fetched_at: new Date().toISOString() });
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
