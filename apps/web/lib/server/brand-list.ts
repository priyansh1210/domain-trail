// Popular-site names for the brand check (spec 014 §5.2, tasks/M5-freshness.md E2): loaded from `brand_labels`
// (weekly job) through a service-role function, at most every 12 hours per server instance. Until it loads, or
// without a database, the curated seed in packages/core applies (spec 014 §8 "brand list missing").
import { within } from '@domains-all/config/net';
import { setPopularBrands } from '@domains-all/core';
import type { SupabaseClient } from '@supabase/supabase-js';

const REFRESH_MS = 12 * 3600_000;
const RETRY_MS = 10 * 60_000;
const MIN_LABELS = 1000;

export function createBrandListSource(sb: SupabaseClient | null, now: () => number = Date.now) {
  let due = 0;
  let count = 0;
  let inFlight: Promise<void> | undefined;

  async function load(): Promise<void> {
    if (!sb) return;
    const r = await sb.rpc('brand_label_list');
    if (r.error) throw new Error(r.error.message);
    const labels = String(r.data ?? '')
      .split(',')
      .filter(Boolean);
    if (labels.length < MIN_LABELS) throw new Error(`only ${labels.length} popular-site names`);
    setPopularBrands(labels);
    count = labels.length;
  }

  return {
    /** Loads the list when due, waiting at most `maxWaitMs` (work left running after a response is frozen). */
    async ensureFresh(maxWaitMs: number): Promise<void> {
      if (!sb || inFlight || now() < due) {
        if (inFlight) await within(inFlight, maxWaitMs, undefined);
        return;
      }
      due = now() + RETRY_MS;
      inFlight = load()
        .then(() => {
          due = now() + REFRESH_MS;
        })
        .catch(() => undefined)
        .finally(() => {
          inFlight = undefined;
        });
      await within(inFlight, maxWaitMs, undefined);
    },
    /** Names loaded into the brand check (0 = curated seed only). */
    count: () => count,
  };
}
