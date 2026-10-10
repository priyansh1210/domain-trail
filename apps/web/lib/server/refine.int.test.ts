// POST /api/search/{ref}/refine (spec 003 FR-FEAT-011): signed-in users re-rank with edited features; no detection
// is repeated; anonymous and signed-out visitors get 401.
import { parseServerEnv } from '@domains-all/config';
import type { SiteProfile } from '@domains-all/core';
import { describe, expect, it } from 'vitest';
import { handleRefine } from './refine';
import { handleSearch } from './search';
import { buildServices } from './services';
import { MOCK_USERS } from './session';

const DESCRIPTION = 'Online bakery in Pune delivering sourdough bread and cakes';
const svc = () => buildServices(parseServerEnv({ RATE_LIMIT_MODE: 'off', PUBLIC_DATA_MODE: 'fixture' }));

async function events(res: Response) {
  return (await res.text())
    .split('\n\n')
    .filter(Boolean)
    .map((chunk) => {
      const event = /event: (\w+)/.exec(chunk)?.[1] ?? '';
      const data = /data: (.*)/.exec(chunk)?.[1];
      return { event, data: data ? (JSON.parse(data) as Record<string, unknown>) : {} };
    });
}

async function firstSearch(s: ReturnType<typeof svc>) {
  const ev = await events(
    await handleSearch(
      new Request('http://localhost/api/search', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          description: DESCRIPTION,
          turnstileToken: 'none',
          clientRequestId: crypto.randomUUID(),
        }),
      }),
      s,
    ),
  );
  return {
    ref: String(ev[0]!.data.ref),
    profile: ev.find((e) => e.event === 'features')!.data as unknown as SiteProfile,
  };
}

const refine = (ref: string, body: unknown) =>
  new Request(`http://localhost/api/search/${ref}/refine`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('refine', () => {
  it('needs a signed-in account', async () => {
    const s = svc();
    const { ref } = await firstSearch(s);
    const body = { description: DESCRIPTION, featureEdits: { geo: 'country_gb' }, turnstileToken: 'none' };
    expect((await handleRefine(refine(ref, body), ref, s, null)).status).toBe(401);
    expect((await handleRefine(refine(ref, body), ref, s, { id: 'x', isAnonymous: true })).status).toBe(401);
  });

  it('ranks again with the edited features and marks them as edited', async () => {
    const s = svc();
    const { ref, profile } = await firstSearch(s);
    expect(profile.geo.value).toBe('country_in');
    const res = await handleRefine(
      refine(ref, {
        description: DESCRIPTION,
        featureEdits: { geo: 'country_gb', flags: { feat_local: false } },
        turnstileToken: 'none',
      }),
      ref,
      s,
      MOCK_USERS.google,
    );
    expect(res.status).toBe(200);
    const ev = await events(res);
    expect(ev[0]).toMatchObject({ event: 'search_created', data: { refinedFrom: ref } });
    expect(ev[0]!.data.ref).not.toBe(ref);
    const features = ev.find((e) => e.event === 'features')!.data as unknown as SiteProfile;
    expect(features.geo).toMatchObject({ value: 'country_gb', edited: true, source: 'user' });
    expect(features.flags.feat_local).toMatchObject({ on: false, edited: true });
    expect(ev.at(-1)!.event).toBe('done');
  });

  it('rejects unknown values and edits that change nothing', async () => {
    const s = svc();
    const { ref, profile } = await firstSearch(s);
    const bad = await handleRefine(
      refine(ref, { description: DESCRIPTION, featureEdits: { geo: 'country_zz' }, turnstileToken: 'none' }),
      ref,
      s,
      MOCK_USERS.google,
    );
    expect(bad.status).toBe(400);
    const same = await handleRefine(
      refine(ref, {
        description: DESCRIPTION,
        featureEdits: { geo: profile.geo.value },
        turnstileToken: 'none',
      }),
      ref,
      s,
      MOCK_USERS.google,
    );
    expect(await same.json()).toMatchObject({ error: 'no_changes' });
  });
});
