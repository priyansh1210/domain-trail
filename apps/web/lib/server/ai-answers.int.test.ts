// AI answers (spec 002 tech §5.10; FR-JEV-018, 019, 020, 021): only signed-in accounts that switch them on reach
// the decision model, the server decides from the session, results are cached per setting, and a search without AI
// answers is never "degraded".
import { parseServerEnv } from '@domains-all/config';
import { rulesOnly } from '@domains-all/jev';
import { describe, expect, it } from 'vitest';
import { handleMore } from './more';
import { handleRefine } from './refine';
import { handleSearch } from './search';
import { buildServices, type Services } from './services';
import { MOCK_USERS, type SessionUser } from './session';

const DESCRIPTION = 'Online bakery in Pune delivering sourdough bread and cakes to families';
const SIGNED_IN = MOCK_USERS.google;
const GUEST: SessionUser = { id: '0190f5a8-0000-7000-8000-00000000b001', isAnonymous: true };

/** Services whose decision model records every question stage it is asked (and can be made to fail). */
function setup(modelFails = false): { s: Services; asked: string[] } {
  const s = buildServices(parseServerEnv({ RATE_LIMIT_MODE: 'off', PUBLIC_DATA_MODE: 'fixture' }));
  const asked: string[] = [];
  const model = s.jev;
  s.jev = {
    ...model,
    async ask(params) {
      asked.push(params.stage ?? '?');
      if (!modelFails) return model.ask(params);
      return { ...(await rulesOnly().ask(params)), degraded: true, degradedReason: 'jev_unavailable' };
    },
  };
  return { s, asked };
}

const post = (url: string, body: unknown) =>
  new Request(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'user-agent': 'vitest',
      'x-forwarded-for': '203.0.113.20',
    },
    body: JSON.stringify(body),
  });

async function events(res: Response) {
  return (await res.text())
    .split('\n\n')
    .filter((b) => b.startsWith('event:'))
    .map((b) => {
      const [e, d] = b.split('\n');
      return { event: e!.slice(7), data: JSON.parse(d!.slice(6)) as Record<string, unknown> };
    });
}

async function search(s: Services, user: SessionUser | null, aiAnswers: boolean) {
  const ev = await events(
    await handleSearch(
      post('http://localhost/api/search', {
        description: DESCRIPTION,
        preferences: { aiAnswers },
        turnstileToken: 'token',
        clientRequestId: crypto.randomUUID(),
      }),
      s,
      user,
    ),
  );
  const created = ev[0]!.data as { searchId: string; ref: string; cached: boolean };
  return { ...created, kinds: ev.map((e) => e.event) };
}

describe('AI answers', () => {
  it('asks the model only for signed-in accounts that switched AI answers on', async () => {
    const cases: Array<[SessionUser | null, boolean]> = [
      [null, true], // signed out, asking anyway: the server says no
      [GUEST, true], // a guest session for saved items is not an account
      [SIGNED_IN, false], // signed in, switch off
    ];
    for (const [user, ai] of cases) {
      const { s, asked } = setup();
      const r = await search(s, user, ai);
      expect(r.kinds.at(-1)).toBe('done');
      expect(r.kinds).toContain('batch');
      expect(asked).toEqual([]);
      expect((await s.store.getSearch(r.searchId))?.prefs).toMatchObject({ aiAnswers: false });
    }

    const { s, asked } = setup();
    const r = await search(s, SIGNED_IN, true);
    expect(r.kinds.at(-1)).toBe('done');
    expect(asked).toContain('S1');
    expect((await s.store.getSearch(r.searchId))?.prefs).toMatchObject({ aiAnswers: true });
  });

  it('shows the reduced-quality notice only when AI answers were on', async () => {
    const off = setup(true);
    const a = await search(off.s, null, true);
    expect(a.kinds).not.toContain('degraded');
    expect((await off.s.store.getSearch(a.searchId))?.degraded).toBe(false);

    const on = setup(true);
    const b = await search(on.s, SIGNED_IN, true);
    expect(b.kinds).toContain('degraded');
    expect(b.kinds.at(-1)).toBe('done');
    expect((await on.s.store.getSearch(b.searchId))?.degraded).toBe(true);
  });

  it('keeps stored results apart for AI answers on and off', async () => {
    const { s, asked } = setup();
    expect((await search(s, null, false)).cached).toBe(false);
    expect((await search(s, null, true)).cached).toBe(true); // asking without an account is the same as off
    expect((await search(s, GUEST, true)).cached).toBe(true);
    expect(asked).toEqual([]);
    expect((await search(s, SIGNED_IN, true)).cached).toBe(false); // never the rules-only copy
    expect((await search(s, SIGNED_IN, true)).cached).toBe(true);
    expect((await search(s, SIGNED_IN, false)).cached).toBe(true); // the rules-only copy again
  });

  it('decides again for more names and edited features', async () => {
    const { s, asked } = setup();
    const first = await search(s, SIGNED_IN, true);
    const more = (user: SessionUser | null) =>
      handleMore(
        post(`http://localhost/api/search/${first.ref}/more`, {
          description: DESCRIPTION,
          preferences: { aiAnswers: true },
          turnstileToken: 'token',
          priceMinCents: 0,
          priceMaxCents: null,
          basis: 'upfront',
          exclude: [],
        }),
        first.ref,
        s,
        user,
      ).then(events);

    asked.length = 0;
    const signedOut = await more(null); // signed out since the search
    expect(signedOut.at(-1)!.event).toBe('done');
    expect(signedOut.map((e) => e.event)).not.toContain('degraded');
    expect(asked).toEqual([]);
    await more(SIGNED_IN);
    expect(asked.length).toBeGreaterThan(0);

    const refine = async (ref: string) =>
      events(
        await handleRefine(
          post(`http://localhost/api/search/${ref}/refine`, {
            description: DESCRIPTION,
            featureEdits: { geo: 'country_gb' },
            turnstileToken: 'token',
          }),
          ref,
          s,
          SIGNED_IN,
        ),
      );
    const rulesOnlySearch = await search(s, SIGNED_IN, false);
    asked.length = 0;
    expect((await refine(rulesOnlySearch.ref)).at(-1)!.event).toBe('done');
    expect(asked).toEqual([]); // the search was made without AI answers, so its refinement is too
    await refine(first.ref);
    expect(asked.length).toBeGreaterThan(0);
  });
});
