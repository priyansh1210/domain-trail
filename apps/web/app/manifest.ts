// Home-screen details for phones (logos/final): the name comes from configuration (FR-SYS-011).
import type { MetadataRoute } from 'next';
import { siteIdentity } from '@domains-all/config';
import { t } from '@/lib/i18n';

export default function manifest(): MetadataRoute.Manifest {
  const { name } = siteIdentity();
  return {
    name,
    short_name: name,
    description: t('home.tagline'),
    start_url: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#0f1e33',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      // The mark sits well inside the safe circle, so the same tile works when phones crop it.
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
