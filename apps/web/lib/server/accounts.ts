// Saved searches, watchlist, notifications and settings (spec 011 tech §3–5; spec 012 §4). The Supabase store acts
// as the signed-in user, so row-level security applies to every read and write; only account deletion, moving
// signed-out saves and the owner views use the service role. Mock mode keeps everything in memory.
import { accounts as limits } from '@domains-all/config/defaults';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { SessionUser } from './session';

export type AlertsFrequency = 'daily' | 'weekly' | 'off';

export interface Profile {
  userId: string;
  displayName: string | null;
  alertsFrequency: AlertsFrequency;
  currency: string;
  termsVersion: string;
  termsAcceptedAt: string;
  createdAt: string;
}

export interface SavedSearch {
  id: string;
  title: string;
  description: string | null;
  preferences: unknown;
  searchId: string | null;
  alertsEnabled: boolean;
  lastCheckedAt: string | null;
  createdAt: string;
}

export interface WatchItem {
  fqdn: string;
  notifyOn: string[];
  lastStatus: string | null;
  lastUpfrontCents: number | null;
  lastCheckedAt: string | null;
  addedAt: string;
}

export interface Notification {
  id: number;
  kind: 'registered' | 'available' | 'dropping_soon' | 'price_change';
  fqdn: string;
  payload: Record<string, unknown> | null;
  createdAt: string;
  readAt: string | null;
}

export interface AdminOverview {
  accounts: Array<{
    id: string;
    label: string;
    anonymous: boolean;
    provider: string | null;
    createdAt: string;
    savedSearches: number;
    watched: number;
  }>;
  savedSearches: Array<{ owner: string; title: string; description: string | null; createdAt: string }>;
  watched: Array<{ owner: string; fqdn: string; lastStatus: string | null; addedAt: string }>;
  perDay: Array<{ day: string; saves: number; watches: number }>;
}

export interface ContactMessage {
  id: string;
  email: string;
  message: string;
  createdAt: string;
}

export interface OpsOverview {
  /** Messages from the contact page, newest first (answer within 30 days, FR-PRIV-007). */
  messages: ContactMessage[];
  jobs: Array<{
    job: string;
    status: string;
    startedAt: string;
    finishedAt: string | null;
    stats: unknown;
    error: string | null;
  }>;
  reports: Array<{ kind: string; period: string; createdAt: string }>;
  jevTokensThisMonth: number;
  dbMb: number | null;
}

export class LimitError extends Error {
  constructor(readonly what: 'saved_searches' | 'watchlist') {
    super(`limit reached: ${what}`);
  }
}

/** Anonymous sessions may never store description text (constitution P5, FR-ACC-017). */
export class DescriptionNotAllowed extends Error {}

export interface MoveResult {
  movedSearches: number;
  movedNames: number;
  skipped: number;
}

export interface AccountStore {
  readonly kind: 'supabase' | 'memory';
  profile(u: SessionUser): Promise<Profile | null>;
  createProfile(u: SessionUser, termsVersion: string): Promise<Profile>;
  updateProfile(
    u: SessionUser,
    patch: Partial<Pick<Profile, 'displayName' | 'alertsFrequency' | 'currency'>>,
  ): Promise<Profile | null>;
  savedSearches(u: SessionUser): Promise<SavedSearch[]>;
  addSavedSearch(
    u: SessionUser,
    s: {
      title: string;
      description: string | null;
      preferences: unknown;
      searchId: string;
      alertsEnabled: boolean;
    },
  ): Promise<SavedSearch>;
  removeSavedSearch(u: SessionUser, id: string): Promise<void>;
  watchlist(u: SessionUser): Promise<WatchItem[]>;
  watch(
    u: SessionUser,
    w: { fqdn: string; notifyOn: string[]; lastStatus: string | null; lastUpfrontCents: number | null },
  ): Promise<WatchItem>;
  unwatch(u: SessionUser, fqdn: string): Promise<void>;
  notifications(u: SessionUser, days: number): Promise<Notification[]>;
  markRead(u: SessionUser): Promise<void>;
  /** Signed-out saver seen (spec 011 §5.6: `anon_visitors.last_seen_at`, at most once a day). */
  touchAnonymous(u: SessionUser): Promise<void>;
  deleteUser(userId: string): Promise<void>;
  /** One-click unsubscribe (FR-ACC-009): alerts off at once, no sign-in needed. */
  unsubscribe(userId: string): Promise<boolean>;
  /** Moves a signed-out saver's items into an account, then deletes the anonymous user (FR-ACC-018). */
  moveItems(fromAnonymousId: string, to: SessionUser): Promise<MoveResult>;
  adminOverview(): Promise<AdminOverview>;
  opsOverview(): Promise<OpsOverview>;
  /** Contact page message (no session needed; kept 1 year, spec 012). */
  addContactMessage(m: { email: string; message: string }): Promise<string>;
}

const nowIso = () => new Date().toISOString();
const ownerLabel = (id: string, anonymous: boolean, email?: string | null) =>
  anonymous ? `anon-${id.slice(0, 8)}` : (email ?? id);

// ===== memory (mock mode, tests) =====

interface MemoryUser {
  user: SessionUser;
  createdAt: string;
  profile: Profile | null;
  saved: SavedSearch[];
  watch: WatchItem[];
  notes: Notification[];
  lastSeen?: string;
}

export class MemoryAccountStore implements AccountStore {
  readonly kind = 'memory' as const;
  readonly users = new Map<string, MemoryUser>();
  private noteId = 1;

  private of(u: SessionUser): MemoryUser {
    let m = this.users.get(u.id);
    if (!m) {
      m = { user: u, createdAt: nowIso(), profile: null, saved: [], watch: [], notes: [] };
      this.users.set(u.id, m);
    }
    return m;
  }

  async profile(u: SessionUser) {
    return this.users.get(u.id)?.profile ?? null;
  }

  async createProfile(u: SessionUser, termsVersion: string) {
    const m = this.of(u);
    m.profile ??= {
      userId: u.id,
      displayName: null,
      alertsFrequency: 'daily',
      currency: 'USD',
      termsVersion,
      termsAcceptedAt: nowIso(),
      createdAt: nowIso(),
    };
    return m.profile;
  }

  async updateProfile(
    u: SessionUser,
    patch: Partial<Pick<Profile, 'displayName' | 'alertsFrequency' | 'currency'>>,
  ) {
    const m = this.users.get(u.id);
    if (!m?.profile) return null;
    Object.assign(m.profile, patch);
    return m.profile;
  }

  async savedSearches(u: SessionUser) {
    return [...(this.users.get(u.id)?.saved ?? [])].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  async addSavedSearch(
    u: SessionUser,
    s: {
      title: string;
      description: string | null;
      preferences: unknown;
      searchId: string;
      alertsEnabled: boolean;
    },
  ) {
    if (u.isAnonymous && s.description) throw new DescriptionNotAllowed();
    const m = this.of(u);
    if (m.saved.length >= limits.savedSearchesMax) throw new LimitError('saved_searches');
    const row: SavedSearch = {
      id: crypto.randomUUID(),
      title: s.title,
      description: s.description,
      preferences: s.preferences,
      searchId: s.searchId,
      alertsEnabled: s.alertsEnabled,
      lastCheckedAt: null,
      createdAt: nowIso(),
    };
    m.saved.push(row);
    return row;
  }

  async removeSavedSearch(u: SessionUser, id: string) {
    const m = this.users.get(u.id);
    if (m) m.saved = m.saved.filter((s) => s.id !== id);
  }

  async watchlist(u: SessionUser) {
    return [...(this.users.get(u.id)?.watch ?? [])].sort((a, b) => (a.addedAt < b.addedAt ? 1 : -1));
  }

  async watch(
    u: SessionUser,
    w: { fqdn: string; notifyOn: string[]; lastStatus: string | null; lastUpfrontCents: number | null },
  ) {
    const m = this.of(u);
    const existing = m.watch.find((x) => x.fqdn === w.fqdn);
    if (existing) return Object.assign(existing, { notifyOn: w.notifyOn });
    if (m.watch.length >= limits.watchlistMax) throw new LimitError('watchlist');
    const row: WatchItem = { ...w, lastCheckedAt: null, addedAt: nowIso() };
    m.watch.push(row);
    return row;
  }

  async unwatch(u: SessionUser, fqdn: string) {
    const m = this.users.get(u.id);
    if (m) m.watch = m.watch.filter((w) => w.fqdn !== fqdn);
  }

  async notifications(u: SessionUser, days: number) {
    const since = Date.now() - days * 86_400_000;
    return (this.users.get(u.id)?.notes ?? []).filter((n) => Date.parse(n.createdAt) > since).reverse();
  }

  /** For tests and the mock watchlist: add an in-app notification. */
  notify(userId: string, n: Pick<Notification, 'kind' | 'fqdn' | 'payload'>) {
    const m = this.users.get(userId);
    m?.notes.push({ ...n, id: this.noteId++, createdAt: nowIso(), readAt: null });
  }

  async markRead(u: SessionUser) {
    for (const n of this.users.get(u.id)?.notes ?? []) n.readAt ??= nowIso();
  }

  async touchAnonymous(u: SessionUser) {
    if (u.isAnonymous) this.of(u).lastSeen = nowIso();
  }

  async deleteUser(userId: string) {
    this.users.delete(userId);
  }

  async unsubscribe(userId: string) {
    const p = this.users.get(userId)?.profile;
    if (p) p.alertsFrequency = 'off';
    return !!p;
  }

  async moveItems(fromAnonymousId: string, to: SessionUser): Promise<MoveResult> {
    const from = this.users.get(fromAnonymousId);
    const result: MoveResult = { movedSearches: 0, movedNames: 0, skipped: 0 };
    if (!from || !from.user.isAnonymous || fromAnonymousId === to.id) return result;
    const target = this.of(to);
    for (const s of from.saved) {
      if (
        target.saved.some((x) => x.searchId === s.searchId) ||
        target.saved.length >= limits.savedSearchesMax
      )
        result.skipped++;
      else {
        target.saved.push(s);
        result.movedSearches++;
      }
    }
    for (const w of from.watch) {
      if (target.watch.some((x) => x.fqdn === w.fqdn) || target.watch.length >= limits.watchlistMax)
        result.skipped++;
      else {
        target.watch.push(w);
        result.movedNames++;
      }
    }
    this.users.delete(fromAnonymousId);
    return result;
  }

  async adminOverview(): Promise<AdminOverview> {
    const users = [...this.users.values()];
    const label = (m: MemoryUser) => ownerLabel(m.user.id, m.user.isAnonymous, m.user.email);
    const perDay = new Map<string, { saves: number; watches: number }>();
    for (const m of users) {
      for (const s of m.saved) {
        const d = perDay.get(s.createdAt.slice(0, 10)) ?? { saves: 0, watches: 0 };
        d.saves++;
        perDay.set(s.createdAt.slice(0, 10), d);
      }
      for (const w of m.watch) {
        const d = perDay.get(w.addedAt.slice(0, 10)) ?? { saves: 0, watches: 0 };
        d.watches++;
        perDay.set(w.addedAt.slice(0, 10), d);
      }
    }
    return {
      accounts: users.map((m) => ({
        id: m.user.id,
        label: label(m),
        anonymous: m.user.isAnonymous,
        provider: m.user.provider ?? null,
        createdAt: m.createdAt,
        savedSearches: m.saved.length,
        watched: m.watch.length,
      })),
      savedSearches: users.flatMap((m) =>
        m.saved.map((s) => ({
          owner: label(m),
          title: s.title,
          description: m.user.isAnonymous ? null : s.description,
          createdAt: s.createdAt,
        })),
      ),
      watched: users.flatMap((m) =>
        m.watch.map((w) => ({ owner: label(m), fqdn: w.fqdn, lastStatus: w.lastStatus, addedAt: w.addedAt })),
      ),
      perDay: [...perDay].sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([day, v]) => ({ day, ...v })),
    };
  }

  readonly contact: ContactMessage[] = [];

  async opsOverview(): Promise<OpsOverview> {
    return {
      messages: [...this.contact].reverse(),
      jobs: [],
      reports: [],
      jevTokensThisMonth: 0,
      dbMb: null,
    };
  }

  async addContactMessage(m: { email: string; message: string }) {
    if (this.contact.length > 1000) this.contact.shift();
    const row = { id: String(this.contact.length + 1), ...m, createdAt: nowIso() };
    this.contact.push(row);
    return row.id;
  }
}

// ===== Supabase =====

function check<T>(r: { data: T; error: { message: string; code?: string } | null }): T {
  if (r.error) {
    if (r.error.code === 'P0001' || /limit_reached/.test(r.error.message)) {
      throw new LimitError(/watchlist/.test(r.error.message) ? 'watchlist' : 'saved_searches');
    }
    throw new Error(`supabase: ${r.error.message}`);
  }
  return r.data;
}

type ProfileRow = {
  user_id: string;
  display_name: string | null;
  alerts_frequency: AlertsFrequency;
  currency: string;
  terms_version: string;
  terms_accepted_at: string;
  created_at: string;
};
const toProfile = (r: ProfileRow): Profile => ({
  userId: r.user_id,
  displayName: r.display_name,
  alertsFrequency: r.alerts_frequency,
  currency: r.currency.trim(),
  termsVersion: r.terms_version,
  termsAcceptedAt: r.terms_accepted_at,
  createdAt: r.created_at,
});

type SavedRow = {
  id: string;
  title: string;
  description: string | null;
  preferences: unknown;
  search_id: string | null;
  alerts_enabled: boolean;
  last_checked_at: string | null;
  created_at: string;
};
const SAVED_COLS = 'id,title,description,preferences,search_id,alerts_enabled,last_checked_at,created_at';
const toSaved = (r: SavedRow): SavedSearch => ({
  id: r.id,
  title: r.title,
  description: r.description,
  preferences: r.preferences,
  searchId: r.search_id,
  alertsEnabled: r.alerts_enabled,
  lastCheckedAt: r.last_checked_at,
  createdAt: r.created_at,
});

type WatchRow = {
  fqdn: string;
  notify_on: string[];
  last_status: string | null;
  last_upfront_cents: number | null;
  last_checked_at: string | null;
  added_at: string;
};
const WATCH_COLS = 'fqdn,notify_on,last_status,last_upfront_cents,last_checked_at,added_at';
const toWatch = (r: WatchRow): WatchItem => ({
  fqdn: r.fqdn,
  notifyOn: r.notify_on,
  lastStatus: r.last_status,
  lastUpfrontCents: r.last_upfront_cents,
  lastCheckedAt: r.last_checked_at,
  addedAt: r.added_at,
});

export class SupabaseAccountStore implements AccountStore {
  readonly kind = 'supabase' as const;
  constructor(
    /** Acting as the signed-in user (RLS). */
    private readonly db: SupabaseClient,
    /** Service role: deletion, moving signed-out saves, owner views. */
    private readonly admin: SupabaseClient,
  ) {}

  async profile(u: SessionUser) {
    const r = check(
      await this.db.from('profiles').select('*').eq('user_id', u.id).maybeSingle(),
    ) as ProfileRow | null;
    return r ? toProfile(r) : null;
  }

  async createProfile(u: SessionUser, termsVersion: string) {
    const existing = await this.profile(u);
    if (existing) return existing;
    const r = check(
      await this.db
        .from('profiles')
        .insert({
          user_id: u.id,
          terms_version: termsVersion,
          terms_accepted_at: nowIso(),
          age_confirmed: true,
        })
        .select('*')
        .single(),
    ) as ProfileRow;
    return toProfile(r);
  }

  async updateProfile(
    u: SessionUser,
    patch: Partial<Pick<Profile, 'displayName' | 'alertsFrequency' | 'currency'>>,
  ) {
    const row: Record<string, unknown> = {};
    if (patch.displayName !== undefined) row.display_name = patch.displayName;
    if (patch.alertsFrequency !== undefined) row.alerts_frequency = patch.alertsFrequency;
    if (patch.currency !== undefined) row.currency = patch.currency;
    const r = check(
      await this.db.from('profiles').update(row).eq('user_id', u.id).select('*').maybeSingle(),
    ) as ProfileRow | null;
    return r ? toProfile(r) : null;
  }

  async savedSearches(u: SessionUser) {
    const rows = check(
      await this.db
        .from('saved_searches')
        .select(SAVED_COLS)
        .eq('user_id', u.id)
        .order('created_at', { ascending: false }),
    ) as SavedRow[];
    return rows.map(toSaved);
  }

  async addSavedSearch(
    u: SessionUser,
    s: {
      title: string;
      description: string | null;
      preferences: unknown;
      searchId: string;
      alertsEnabled: boolean;
    },
  ) {
    if (u.isAnonymous && s.description) throw new DescriptionNotAllowed();
    const r = check(
      await this.db
        .from('saved_searches')
        .insert({
          user_id: u.id,
          title: s.title,
          description: s.description,
          preferences: s.preferences,
          search_id: s.searchId,
          alerts_enabled: s.alertsEnabled,
        })
        .select(SAVED_COLS)
        .single(),
    ) as SavedRow;
    return toSaved(r);
  }

  async removeSavedSearch(u: SessionUser, id: string) {
    check(await this.db.from('saved_searches').delete().eq('user_id', u.id).eq('id', id));
  }

  async watchlist(u: SessionUser) {
    const rows = check(
      await this.db
        .from('watchlist')
        .select(WATCH_COLS)
        .eq('user_id', u.id)
        .order('added_at', { ascending: false }),
    ) as WatchRow[];
    return rows.map(toWatch);
  }

  async watch(
    u: SessionUser,
    w: { fqdn: string; notifyOn: string[]; lastStatus: string | null; lastUpfrontCents: number | null },
  ) {
    const existing = check(
      await this.db.from('watchlist').select(WATCH_COLS).eq('user_id', u.id).eq('fqdn', w.fqdn).maybeSingle(),
    ) as WatchRow | null;
    if (existing) {
      const r = check(
        await this.db
          .from('watchlist')
          .update({ notify_on: w.notifyOn })
          .eq('user_id', u.id)
          .eq('fqdn', w.fqdn)
          .select(WATCH_COLS)
          .single(),
      ) as WatchRow;
      return toWatch(r);
    }
    const r = check(
      await this.db
        .from('watchlist')
        .insert({
          user_id: u.id,
          fqdn: w.fqdn,
          notify_on: w.notifyOn,
          last_status: w.lastStatus,
          last_upfront_cents: w.lastUpfrontCents,
        })
        .select(WATCH_COLS)
        .single(),
    ) as WatchRow;
    return toWatch(r);
  }

  async unwatch(u: SessionUser, fqdn: string) {
    check(await this.db.from('watchlist').delete().eq('user_id', u.id).eq('fqdn', fqdn));
  }

  async notifications(u: SessionUser, days: number) {
    const since = new Date(Date.now() - days * 86_400_000).toISOString();
    const rows = check(
      await this.db
        .from('notifications')
        .select('id,kind,fqdn,payload,created_at,read_at')
        .eq('user_id', u.id)
        .gt('created_at', since)
        .order('created_at', { ascending: false })
        .limit(200),
    ) as Array<{
      id: number;
      kind: Notification['kind'];
      fqdn: string;
      payload: Record<string, unknown> | null;
      created_at: string;
      read_at: string | null;
    }>;
    return rows.map((r) => ({
      id: Number(r.id),
      kind: r.kind,
      fqdn: r.fqdn,
      payload: r.payload,
      createdAt: r.created_at,
      readAt: r.read_at,
    }));
  }

  async markRead(u: SessionUser) {
    check(
      await this.db
        .from('notifications')
        .update({ read_at: nowIso() })
        .eq('user_id', u.id)
        .is('read_at', null),
    );
  }

  async touchAnonymous(u: SessionUser) {
    if (!u.isAnonymous) return;
    const r = check(
      await this.admin.from('anon_visitors').select('last_seen_at').eq('user_id', u.id).maybeSingle(),
    ) as { last_seen_at: string } | null;
    if (r && Date.now() - Date.parse(r.last_seen_at) < 20 * 3600_000) return;
    check(await this.admin.from('anon_visitors').upsert({ user_id: u.id, last_seen_at: nowIso() }));
  }

  async deleteUser(userId: string) {
    const { error } = await this.admin.auth.admin.deleteUser(userId);
    if (error) throw new Error(`supabase: ${error.message}`);
  }

  async unsubscribe(userId: string) {
    const rows = check(
      await this.admin
        .from('profiles')
        .update({ alerts_frequency: 'off', email_status: 'unsubscribed' })
        .eq('user_id', userId)
        .select('user_id'),
    ) as unknown[];
    return rows.length > 0;
  }

  async moveItems(fromAnonymousId: string, to: SessionUser): Promise<MoveResult> {
    const result: MoveResult = { movedSearches: 0, movedNames: 0, skipped: 0 };
    if (fromAnonymousId === to.id) return result;
    const { data: anon } = await this.admin.auth.admin.getUserById(fromAnonymousId);
    if (!anon.user?.is_anonymous) return result; // only anonymous savers can be merged
    const searches = check(
      await this.admin.from('saved_searches').select(SAVED_COLS).eq('user_id', fromAnonymousId),
    ) as SavedRow[];
    const names = check(
      await this.admin.from('watchlist').select(WATCH_COLS).eq('user_id', fromAnonymousId),
    ) as WatchRow[];
    const mine = await this.savedSearches(to);
    const myNames = new Set((await this.watchlist(to)).map((w) => w.fqdn));
    for (const s of searches) {
      if (mine.some((m) => m.searchId === s.search_id)) {
        result.skipped++;
        continue;
      }
      try {
        await this.addSavedSearch(to, {
          title: s.title,
          description: null,
          preferences: s.preferences,
          searchId: s.search_id ?? '',
          alertsEnabled: s.alerts_enabled,
        });
        result.movedSearches++;
      } catch (e) {
        if (!(e instanceof LimitError)) throw e;
        result.skipped++;
      }
    }
    for (const w of names) {
      if (myNames.has(w.fqdn)) {
        result.skipped++;
        continue;
      }
      try {
        await this.watch(to, {
          fqdn: w.fqdn,
          notifyOn: w.notify_on,
          lastStatus: w.last_status,
          lastUpfrontCents: w.last_upfront_cents,
        });
        result.movedNames++;
      } catch (e) {
        if (!(e instanceof LimitError)) throw e;
        result.skipped++;
      }
    }
    await this.deleteUser(fromAnonymousId);
    return result;
  }

  async adminOverview(): Promise<AdminOverview> {
    const { data } = await this.admin.auth.admin.listUsers({ page: 1, perPage: 500 });
    const users = data?.users ?? [];
    const byId = new Map(users.map((u) => [u.id, u]));
    const label = (id: string) => {
      const u = byId.get(id);
      return ownerLabel(id, u?.is_anonymous === true, u?.email);
    };
    const saved = check(
      await this.admin
        .from('saved_searches')
        .select('user_id,title,description,created_at')
        .order('created_at', { ascending: false })
        .limit(500),
    ) as Array<{ user_id: string; title: string; description: string | null; created_at: string }>;
    const watched = check(
      await this.admin
        .from('watchlist')
        .select('user_id,fqdn,last_status,added_at')
        .order('added_at', { ascending: false })
        .limit(1000),
    ) as Array<{ user_id: string; fqdn: string; last_status: string | null; added_at: string }>;
    const count = (list: Array<{ user_id: string }>, id: string) =>
      list.filter((x) => x.user_id === id).length;
    const perDay = new Map<string, { saves: number; watches: number }>();
    for (const s of saved) {
      const d = perDay.get(s.created_at.slice(0, 10)) ?? { saves: 0, watches: 0 };
      d.saves++;
      perDay.set(s.created_at.slice(0, 10), d);
    }
    for (const w of watched) {
      const d = perDay.get(w.added_at.slice(0, 10)) ?? { saves: 0, watches: 0 };
      d.watches++;
      perDay.set(w.added_at.slice(0, 10), d);
    }
    return {
      accounts: users.map((u) => ({
        id: u.id,
        label: label(u.id),
        anonymous: u.is_anonymous === true,
        provider: (u.app_metadata?.provider as string | undefined) ?? null,
        createdAt: u.created_at,
        savedSearches: count(saved, u.id),
        watched: count(watched, u.id),
      })),
      savedSearches: saved.map((s) => ({
        owner: label(s.user_id),
        title: s.title,
        description: byId.get(s.user_id)?.is_anonymous ? null : s.description,
        createdAt: s.created_at,
      })),
      watched: watched.map((w) => ({
        owner: label(w.user_id),
        fqdn: w.fqdn,
        lastStatus: w.last_status,
        addedAt: w.added_at,
      })),
      perDay: [...perDay].sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([day, v]) => ({ day, ...v })),
    };
  }

  async opsOverview(): Promise<OpsOverview> {
    const jobs = check(
      await this.admin
        .from('job_runs')
        .select('job,status,started_at,finished_at,stats,error')
        .order('started_at', { ascending: false })
        .limit(60),
    ) as Array<{
      job: string;
      status: string;
      started_at: string;
      finished_at: string | null;
      stats: unknown;
      error: string | null;
    }>;
    const reports = check(
      await this.admin
        .from('quality_reports')
        .select('kind,period,created_at')
        .order('created_at', { ascending: false })
        .limit(20),
    ) as Array<{ kind: string; period: string; created_at: string }>;
    const month = new Date().toISOString().slice(0, 8) + '01';
    const tokens = check(await this.admin.rpc('month_jev_tokens', { p_month: month })) as
      number | string | null;
    const messages = check(
      await this.admin
        .from('contact_messages')
        .select('id,email,message,created_at')
        .order('created_at', { ascending: false })
        .limit(50),
    ) as Array<{ id: number; email: string; message: string; created_at: string }>;
    const cleanup = jobs.find((j) => j.job === 'cleanup' && j.status === 'success');
    const dbMb = (cleanup?.stats as { dbMb?: number } | null)?.dbMb ?? null;
    return {
      messages: messages.map((m) => ({
        id: String(m.id),
        email: m.email,
        message: m.message,
        createdAt: m.created_at,
      })),
      jobs: jobs.map((j) => ({
        job: j.job,
        status: j.status,
        startedAt: j.started_at,
        finishedAt: j.finished_at,
        stats: j.stats,
        error: j.error,
      })),
      reports: reports.map((r) => ({ kind: r.kind, period: r.period, createdAt: r.created_at })),
      jevTokensThisMonth: Number(tokens ?? 0),
      dbMb,
    };
  }

  async addContactMessage(m: { email: string; message: string }) {
    const r = check(
      await this.admin
        .from('contact_messages')
        .insert({ email: m.email, message: m.message })
        .select('id')
        .single(),
    ) as { id: number };
    return String(r.id);
  }
}
