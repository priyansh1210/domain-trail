// GET /api/status (spec 009 OpenAPI `Status`, FR-UX-011): dataset ages and service state; no secrets.
import { services } from '@/lib/server/services';
import { statusSource } from '@/lib/server/status';

export const dynamic = 'force-dynamic';

let getStatus: ReturnType<typeof statusSource> | undefined;

export async function GET() {
  getStatus ??= statusSource(services());
  const status = await getStatus();
  return Response.json(status, {
    headers: { 'Cache-Control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=600' },
  });
}
