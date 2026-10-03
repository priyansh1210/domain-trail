import { observability, serverEnv } from '@domains-all/config';
import { cachedHealth, computeHealth } from '@/lib/health';

export const dynamic = 'force-dynamic';

const getHealth = cachedHealth(() => computeHealth(serverEnv()));

export async function GET() {
  const health = await getHealth();
  return Response.json(health, {
    status: health.ok ? 200 : 503,
    headers: { 'Cache-Control': `public, max-age=0, s-maxage=${observability.healthCacheSeconds}` },
  });
}
