import { handleSearch } from '@/lib/server/search';
import { services } from '@/lib/server/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export function POST(req: Request) {
  return handleSearch(req, services());
}
