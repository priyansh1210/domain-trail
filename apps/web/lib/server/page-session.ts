// Cookies of the current page request, for server-rendered pages (which can read cookies but not set them).
import { cookies } from 'next/headers';
import { CookieJar } from './cookies';

export async function pageJar(): Promise<CookieJar> {
  const store = await cookies();
  return new CookieJar(
    store
      .getAll()
      .map((c) => `${c.name}=${encodeURIComponent(c.value)}`)
      .join('; '),
  );
}
