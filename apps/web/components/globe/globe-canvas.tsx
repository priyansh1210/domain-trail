'use client';
// React wrapper for the search globe (engine.ts). Pages load it on demand, so it never weighs on the first view.
import { useEffect, useRef } from 'react';
import { createGlobe, type Globe, type GlobeMode } from './engine';

const PRESETS = {
  hero: { density: 7200, cities: true, satellites: 3, fit: 1.82, shadow: true, seed: 5 },
  scan: { density: 8200, cities: true, satellites: 3, fit: 1.82, shadow: true, seed: 9 },
  mini: { density: 2600, cities: false, satellites: 2, fit: 1.75, shadow: false, seed: 3 },
} as const;

export default function GlobeCanvas({
  variant,
  mode,
  paused = false,
  className,
}: {
  variant: keyof typeof PRESETS;
  mode: GlobeMode;
  paused?: boolean;
  className?: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const globe = useRef<Globe | null>(null);
  const initialMode = useRef(mode);

  useEffect(() => {
    const g = createGlobe(canvas.current!, { ...PRESETS[variant], mode: initialMode.current });
    globe.current = g;
    return () => {
      g.destroy();
      globe.current = null;
    };
  }, [variant]);

  useEffect(() => {
    globe.current?.setMode(mode);
  }, [mode]);

  useEffect(() => {
    const g = globe.current;
    if (!g) return;
    if (paused) g.stop();
    else g.start();
  }, [paused, variant]);

  return <canvas ref={canvas} aria-hidden="true" className={className} />;
}
