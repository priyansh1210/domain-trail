import { handleSnapshot } from '@/lib/server/search';
import { services } from '@/lib/server/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  return handleSnapshot(ref, services());
}
