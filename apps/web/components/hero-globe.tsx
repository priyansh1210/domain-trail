'use client';
// The calm globe beside the home form on wide screens. Phones skip it entirely (no download, no drawing).
import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';

const GlobeCanvas = dynamic(() => import('./globe/globe-canvas'), { ssr: false });

export function HeroGlobe({ caption }: { caption: string }) {
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 900px)');
    const update = () => setWide(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  return (
    <figure className="m-0 hidden flex-col items-center gap-3 min-[900px]:flex">
      <div className="aspect-square w-full max-w-[27.5rem]">
        {wide && <GlobeCanvas variant="hero" mode="calm" className="block h-full w-full" />}
      </div>
      <figcaption className="text-center text-sm text-[var(--muted)]">{caption}</figcaption>
    </figure>
  );
}
