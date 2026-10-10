import { handleCallback } from '@/lib/server/auth-routes';
import { services } from '@/lib/server/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(req: Request) {
  return handleCallback(req, services());
}
