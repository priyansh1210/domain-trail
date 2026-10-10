import { handleMeCreate, handleMeDelete, handleMeGet, handleMePatch } from '@/lib/server/me';
import { services } from '@/lib/server/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(req: Request) {
  return handleMeGet(req, services());
}

export function POST(req: Request) {
  return handleMeCreate(req, services());
}

export function PATCH(req: Request) {
  return handleMePatch(req, services());
}

export function DELETE(req: Request) {
  return handleMeDelete(req, services());
}
