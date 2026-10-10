'use client';
// Footer line "Domain data updated 3 h ago" linking to the Status page (spec 009 US / FR-UX-011). Fetched after the
// page loads so every page stays static; the answer is cached for 5 minutes.
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { format } from '@/lib/format';

interface Props {
  text: {
    status: string;
    dataAge: string;
    dataAgeStale: string;
    hours: string;
    underHour: string;
    days: string;
  };
}

export function DataAge({ text }: Props) {
  const [age, setAge] = useState<{ hours: number; stale: boolean } | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    fetch('/api/status', { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((s: { dataAges?: Record<string, number | null>; stale?: string[] } | null) => {
        const ages = [s?.dataAges?.prices, s?.dataAges?.tlds].filter(
          (v): v is number => typeof v === 'number',
        );
        if (ages.length)
          setAge({
            hours: Math.max(...ages),
            stale: !!s?.stale?.some((d) => d === 'prices' || d === 'tlds'),
          });
      })
      .catch(() => undefined);
    return () => ctrl.abort();
  }, []);

  if (!age)
    return (
      <Link href="/status" className="underline">
        {text.status}
      </Link>
    );
  const when =
    age.hours < 1
      ? text.underHour
      : age.hours < 48
        ? format(text.hours, { n: Math.round(age.hours) })
        : format(text.days, { n: Math.round(age.hours / 24) });
  return (
    <Link href="/status" className={`underline ${age.stale ? 'text-[var(--warn)]' : ''}`}>
      {format(age.stale ? text.dataAgeStale : text.dataAge, { age: when })}
    </Link>
  );
}
