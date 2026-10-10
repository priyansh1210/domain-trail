import { services } from '@/lib/server/services';
import { handleUnsubscribe } from '@/lib/server/unsubscribe';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(req: Request) {
  return handleUnsubscribe(req, services());
}

export function POST(req: Request) {
  return handleUnsubscribe(req, services());
}
