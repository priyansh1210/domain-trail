import { handleMore } from '@/lib/server/more';
import { services } from '@/lib/server/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: Request, { params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  return handleMore(req, ref, services());
}
