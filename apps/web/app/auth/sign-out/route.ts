import { handleSignOut } from '@/lib/server/auth-routes';
import { services } from '@/lib/server/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function POST(req: Request) {
  return handleSignOut(req, services());
}
