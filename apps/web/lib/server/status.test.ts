// Status report logic (FR-REF-015, FR-UX-011): ages, the 30-hour highlight, jobs that never ran.
import { describe, expect, it } from 'vitest';
import { buildStatus } from './status';

const now = Date.parse('2026-10-10T12:00:00Z');
const base = {
  now,
  pricesAt: '2026-10-10T01:00:00Z',
  fxAsOf: '2026-10-09',
  jobs: [],
  decisionModel: 'ok' as const,
};

describe('buildStatus', () => {
  it('reports hours since each refresh', () => {
    const s = buildStatus({
      ...base,
      jobs: [
        { job: 'nrd-ingest', lastSuccessAt: '2026-10-10T02:05:00Z', lastStatus: 'success', failuresInRow: 0 },
      ],
    });
    expect(s.dataAges).toMatchObject({ prices: 11, fx: 20, nrd: 9.9, freeProviders: null, brandList: null });
    expect(s.stale).toEqual([]);
    expect(s.services.search).toBe('ok');
  });

  it('highlights data older than 30 hours; weekly data gets a week', () => {
    const s = buildStatus({
      ...base,
      pricesAt: '2026-10-08T12:00:00Z',
      jobs: [
        { job: 'brand-list', lastSuccessAt: '2026-10-04T03:00:00Z', lastStatus: 'success', failuresInRow: 0 },
      ],
    });
    expect(s.stale).toEqual(['prices']);
    expect(s.services.search).toBe('degraded');
  });

  it('treats ECB weekend gaps as normal', () => {
    // Monday morning: Friday's rates are 3.7 days old.
    const monday = Date.parse('2026-10-12T08:00:00Z');
    const s = buildStatus({ ...base, now: monday, pricesAt: '2026-10-12T01:00:00Z', fxAsOf: '2026-10-09' });
    expect(s.stale).toEqual([]);
  });

  it('uses the newer of the registry job and this server’s own directory download', () => {
    const s = buildStatus({
      ...base,
      rdapRefreshedAt: '2026-10-10T11:00:00Z',
      jobs: [
        {
          job: 'tld-registry',
          lastSuccessAt: '2026-10-10T00:31:00Z',
          lastStatus: 'success',
          failuresInRow: 0,
        },
      ],
    });
    expect(s.dataAges.tlds).toBe(1);
  });

  it('says when the AI ranking is not connected', () => {
    expect(buildStatus({ ...base, decisionModel: 'degraded' }).services).toEqual({
      search: 'degraded',
      decisionModel: 'degraded',
      availability: 'ok',
    });
  });
});
