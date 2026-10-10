import { handleNotificationsRead } from '@/lib/server/me';
import { services } from '@/lib/server/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function POST(req: Request) {
  return handleNotificationsRead(req, services());
}
