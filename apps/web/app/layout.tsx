import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { siteIdentity } from '@domains-all/config';
import './globals.css';

const site = siteIdentity();

export const metadata: Metadata = {
  metadataBase: site.url,
  title: { default: site.name, template: `%s · ${site.name}` },
  description: 'Describe your website and get available domain names, grouped by price and checked daily.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
