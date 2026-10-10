import { CookieJar } from '@/lib/server/cookies';
import { handleSearch } from '@/lib/server/search';
import { services } from '@/lib/server/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: Request) {
  const svc = services();
  const jar = CookieJar.from(req);
  const user = await svc
    .auth(jar)
    .user()
    .catch(() => null);
  return jar.apply(await handleSearch(req, svc, user));
}
