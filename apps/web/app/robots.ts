import type { MetadataRoute } from 'next';
import { absoluteUrl } from '@domains-all/config';

// FR-UX-016: result, account and owner pages are never indexed.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', allow: '/', disallow: ['/s/', '/account/', '/ops/', '/api/'] },
    host: absoluteUrl('/'),
  };
}
