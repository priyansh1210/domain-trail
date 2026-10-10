import { handleWatchDelete } from '@/lib/server/me';
import { services } from '@/lib/server/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function DELETE(req: Request, { params }: { params: Promise<{ fqdn: string }> }) {
  const { fqdn } = await params;
  return handleWatchDelete(req, services(), fqdn);
}
