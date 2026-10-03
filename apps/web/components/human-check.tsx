'use client';
// Invisible Cloudflare Turnstile check (spec 001 US-6, FR-INT-006). The script is fetched only when a site key is
// configured and the visitor starts typing (spec 001 tech §10: lazy), keeping the home page light. Without a site
// key (mock mode, local development) nothing loads and the server skips the check.
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

export interface HumanCheckHandle {
  /** Starts loading the widget script; call on first interaction. */
  warmUp(): void;
  token(): Promise<string>;
  reset(): void;
}

interface TurnstileApi {
  render(el: HTMLElement, opts: Record<string, unknown>): string;
  execute(idOrEl: string | HTMLElement): void;
  reset(id: string): void;
}
declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
const SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
let loading: Promise<TurnstileApi> | null = null;

function loadTurnstile(): Promise<TurnstileApi> {
  loading ??= new Promise((resolve, reject) => {
    if (window.turnstile) return resolve(window.turnstile);
    const s = document.createElement('script');
    s.src = SCRIPT;
    s.async = true;
    s.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('turnstile missing')));
    s.onerror = () => reject(new Error('turnstile failed to load'));
    document.head.appendChild(s);
  });
  return loading;
}

export const HumanCheck = forwardRef<HumanCheckHandle>(function HumanCheck(_props, ref) {
  const box = useRef<HTMLDivElement>(null);
  const widget = useRef<string | null>(null);
  const pending = useRef<{ resolve: (t: string) => void } | null>(null);

  useEffect(() => () => void (pending.current = null), []);

  async function ensureWidget(): Promise<TurnstileApi | null> {
    if (!SITE_KEY || !box.current) return null;
    const api = await loadTurnstile();
    widget.current ??= api.render(box.current, {
      sitekey: SITE_KEY,
      execution: 'execute',
      appearance: 'interaction-only',
      callback: (token: string) => pending.current?.resolve(token),
      'error-callback': () => pending.current?.resolve('unavailable'),
    });
    return api;
  }

  useImperativeHandle(ref, () => ({
    warmUp() {
      if (SITE_KEY) void loadTurnstile().catch(() => undefined);
    },
    async token() {
      if (!SITE_KEY) return 'none';
      try {
        const api = await ensureWidget();
        if (!api || !widget.current) return 'unavailable';
        const result = new Promise<string>((resolve) => {
          pending.current = { resolve };
          setTimeout(() => resolve('unavailable'), 10_000);
        });
        api.execute(widget.current);
        return await result;
      } catch {
        return 'unavailable'; // server then applies stricter limits (spec 001 edge case)
      }
    },
    reset() {
      if (widget.current) window.turnstile?.reset(widget.current);
    },
  }));

  return SITE_KEY ? <div ref={box} /> : null;
});
