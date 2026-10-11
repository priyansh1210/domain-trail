// The picture shown when a link to the site is shared (logos/final/og-image.png is the design). Drawn at build
// time from configuration, so the name and address stay settings (FR-SYS-011).
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ImageResponse } from 'next/og';
import { siteIdentity } from '@domains-all/config';
import { brandMarkSvg } from '@/components/brand-mark';
import { BRAND_LIGHT, wordmarkParts } from '@/lib/brand';
import { t } from '@/lib/i18n';

export const alt = t('home.tagline');
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function OpenGraphImage() {
  const site = siteIdentity();
  const [head, tail] = wordmarkParts(site.name);
  const font = await readFile(join(process.cwd(), 'assets/fonts/Manrope-ExtraBold.woff'));
  const mark = `data:image/svg+xml;base64,${Buffer.from(brandMarkSvg(BRAND_LIGHT)).toString('base64')}`;
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        padding: '0 92px',
        background: 'linear-gradient(135deg, #f4f7fa 55%, #d9edf4 100%)',
        color: BRAND_LIGHT.d,
        fontFamily: 'Manrope',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 28 }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- ImageResponse draws plain <img> only */}
        <img src={mark} width={118} height={118} alt="" />
        <div style={{ display: 'flex', fontSize: 66, letterSpacing: '-0.012em' }}>
          <span style={{ marginRight: tail ? 18 : 0 }}>{head.trim()}</span>
          {tail ? <span style={{ color: BRAND_LIGHT.t }}>{tail}</span> : null}
        </div>
      </div>
      <div
        style={{
          display: 'flex',
          marginTop: 48,
          fontSize: 46,
          lineHeight: 1.18,
          letterSpacing: '-0.015em',
          maxWidth: 1000,
        }}
      >
        {t('home.tagline')}
      </div>
      <div style={{ display: 'flex', marginTop: 44, fontSize: 26, color: BRAND_LIGHT.t }}>
        {site.url.host}
      </div>
    </div>,
    { ...size, fonts: [{ name: 'Manrope', data: font, weight: 800, style: 'normal' }] },
  );
}
