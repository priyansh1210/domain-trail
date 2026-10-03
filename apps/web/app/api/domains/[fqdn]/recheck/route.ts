import { handleRecheck } from '@/lib/server/domains';
import { services } from '@/lib/server/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: Promise<{ fqdn: string }> }) {
  const { fqdn } = await params;
  return handleRecheck(req, fqdn, services());
}
