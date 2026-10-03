import { siteIdentity } from '@domains-all/config';

// Placeholder home page for milestone M1; the description form arrives in M2 (spec 001, 009).
export default function HomePage() {
  const { name } = siteIdentity();
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-4 px-4 py-16">
      <h1 className="text-3xl font-semibold">{name}</h1>
      <p className="text-lg text-[var(--muted)]">
        Describe your website and get available domain names — free and paid, grouped by price, explained, and
        checked daily.
      </p>
      <p className="text-sm text-[var(--muted)]">Under construction. Search is coming soon.</p>
    </main>
  );
}
