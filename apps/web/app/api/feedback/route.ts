import { handleFeedback } from '@/lib/server/domains';
import { services } from '@/lib/server/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function POST(req: Request) {
  return handleFeedback(req, services());
}
