// Weekly popular-site list for the brand check (spec 010 tech §5.4, spec 014 §5.2; FR-REF-007; research R-12).
// Majestic Million (CC BY 3.0) top 100,000 sites → site name without its public suffix → `brand_labels`. Ordinary
// words and names made only of ordinary words ("bookstore", "petshop") are left out, so suggestions built from
// everyday words are not blocked; the curated seed in packages/core keeps famous compound brands (facebook, paypal).
import { jobs as cfg } from '@domains-all/config/defaults';
import { isWord, segment } from '@domains-all/core';
import { getDomainWithoutSuffix } from 'tldts';
import { chunks, json } from '../_lib/db';
import { downloadLines } from '../_lib/fetch';
import type { JobDefinition } from '../_lib/run';

export const SOURCE = 'majestic';

/** The word and its singular forms ("supplies" → "supply"): the dictionary lists base forms only. */
const stems = (w: string) =>
  [
    w,
    w.endsWith('s') ? w.slice(0, -1) : '',
    w.endsWith('es') ? w.slice(0, -2) : '',
    w.endsWith('ies') ? `${w.slice(0, -3)}y` : '',
  ].filter((s) => s.length >= 2);

/** A dictionary word, a plural of one, or a run of such words ("petsupplies"). */
export const ordinaryWords = (letters: string): boolean =>
  stems(letters).some((s) => isWord(s) || segment(s) !== null);

/** Site name worth protecting, or undefined for ordinary words, numbers and malformed rows. */
export function brandLabel(domain: string): string | undefined {
  const label = getDomainWithoutSuffix(domain.trim().toLowerCase());
  if (!label || label.includes('.') || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)) return undefined;
  if (label.length < cfg.brandList.minLength || /^[0-9-]+$/.test(label)) return undefined;
  // Made only of dictionary words (each part between digits and hyphens), e.g. "bookstore", "gals4free".
  const parts = label.split(/[^a-z]+/).filter(Boolean);
  if (parts.length > 0 && parts.every(ordinaryWords)) return undefined;
  return label;
}

/** Parses the CSV lines (header first); keeps the best rank per label. */
export function brandLabels(lines: readonly string[]): Map<string, number> {
  const header = (lines[0] ?? '').split(',');
  const rankCol = header.indexOf('GlobalRank');
  const domainCol = header.indexOf('Domain');
  if (rankCol < 0 || domainCol < 0) throw new Error('popular-site list: unexpected header');
  const out = new Map<string, number>();
  for (const line of lines.slice(1)) {
    const cols = line.split(',');
    const rank = Number(cols[rankCol]);
    const label = brandLabel(cols[domainCol] ?? '');
    if (!label || !Number.isInteger(rank) || rank < 1) continue;
    if (!out.has(label) || rank < out.get(label)!) out.set(label, rank);
  }
  return out;
}

export const brandList: JobDefinition = {
  name: 'brand-list',
  async run(ctx) {
    const lines = await downloadLines(ctx, cfg.brandList.url, cfg.brandList.topSites + 1);
    const labels = brandLabels(lines);
    if (labels.size < cfg.brandList.minLabels)
      throw new Error(
        `popular-site list: only ${labels.size} site names (expected ${cfg.brandList.minLabels}+)`,
      );
    const rows = [...labels].map(([label, rank]) => ({ label, rank }));
    // Replace in one transaction: readers see the old list until the new one is complete (spec 012 §5.5).
    await ctx.db.tx(async (t) => {
      await t.query(`delete from public.brand_labels where source = $1`, [SOURCE]);
      for (const part of chunks(rows, 10_000))
        await t.query(
          `insert into public.brand_labels (label, best_rank, source)
           select r.label, r.rank, $2 from jsonb_to_recordset($1::text::jsonb) as r(label text, rank int)
           on conflict (label) do update set best_rank = least(public.brand_labels.best_rank, excluded.best_rank)`,
          [json(part), SOURCE],
        );
    });
    return { sitesRead: lines.length - 1, labels: rows.length };
  },
};
