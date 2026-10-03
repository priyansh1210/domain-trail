// Site identity (spec 000 FR-SYS-011): the product name and address exist only in env, so moving from the free
// hosting address to an owned domain is a configuration change.
import { readPublicEnv, type PublicEnv } from './env';

export interface SiteIdentity {
  name: string;
  url: URL;
  origin: string;
}

export function siteIdentity(env: PublicEnv = readPublicEnv()): SiteIdentity {
  const url = new URL(env.NEXT_PUBLIC_SITE_URL);
  return { name: env.NEXT_PUBLIC_SITE_NAME, url, origin: url.origin };
}

export function absoluteUrl(path: string, env?: PublicEnv): string {
  return new URL(path, siteIdentity(env).origin).toString();
}
