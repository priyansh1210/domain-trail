import { observability } from '@domains-all/config';
import { cachedHealth, computeHealth } from '@/lib/health';
import { services } from '@/lib/server/services';

export const dynamic = 'force-dynamic';

const getHealth = cachedHealth(() => {
  const svc = services();
  return computeHealth(svc.env, fetch, svc.jev.breakerState());
});

export async function GET() {
  const health = await getHealth();
  return Response.json(health, {
    status: health.ok ? 200 : 503,
    headers: { 'Cache-Control': `public, max-age=0, s-maxage=${observability.healthCacheSeconds}` },
  });
}
