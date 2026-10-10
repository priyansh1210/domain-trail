import { handleContact } from '@/lib/server/contact';
import { services } from '@/lib/server/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function POST(req: Request) {
  return handleContact(req, services());
}
