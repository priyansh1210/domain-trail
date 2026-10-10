import { handleSavedAdd, handleSavedList } from '@/lib/server/me';
import { services } from '@/lib/server/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(req: Request) {
  return handleSavedList(req, services());
}

export function POST(req: Request) {
  return handleSavedAdd(req, services());
}
