import { observability } from '@domains-all/config';
import { cachedHealth, computeHealth } from '@/lib/health';
import { services } from '@/lib/server/services';

export const dynamic = 'force-dynamic';

const getHealth = cachedHealth(async () => {
  const svc = services();
  await svc.refreshPublicData(3000); // a health check also refreshes due public data (uptime pings keep it fresh)
  const p = svc.prices.status();
  const note = [p.lastRefresh?.pricesError, p.lastRefresh?.fxError].filter(Boolean).join('; ');
  return computeHealth(svc.env, fetch, svc.jev.breakerState(), {
    pricesAt: p.pricesAt,
    fxAsOf: p.fxAsOf,
    publicData: svc.env.PUBLIC_DATA_MODE,
    priceRefresh: !p.lastRefresh ? 'not_yet' : p.lastRefresh.ok ? 'ok' : 'failed',
    ...(note ? { priceRefreshNote: note.slice(0, 200) } : {}),
    rdapDirectory: svc.rdapPublication(),
  });
});

export async function GET() {
  const health = await getHealth();
  return Response.json(health, {
    status: health.ok ? 200 : 503,
    headers: { 'Cache-Control': `public, max-age=0, s-maxage=${observability.healthCacheSeconds}` },
  });
}
