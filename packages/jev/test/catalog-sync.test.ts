// Spec 002 tech §5.9 / FR-JEV-002: the code catalog and questions/catalog.md must agree on ids, versions,
// types, instructions and options.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CATALOG, FLAG_STATEMENTS, questionById } from '../src/catalog';

const md = readFileSync(
  join(import.meta.dirname, '..', '..', '..', 'specs', '002-jev-integration', 'questions', 'catalog.md'),
  'utf8',
);
const squash = (s: string) => s.replace(/\s+/g, ' ').trim();

interface MdQuestion {
  id: string;
  version: number;
  type: string;
  instructions?: string;
  options?: Record<string, string>;
  levels?: string[];
}

function parse(): Map<string, MdQuestion> {
  const out = new Map<string, MdQuestion>();
  // Table rows: | `safety_phishing@1` | noul | instructions | use |
  for (const m of md.matchAll(/^\| `(\w+)@(\d+)` \| (noul|choice|score) \| (.+?) \| .+\|$/gm)) {
    out.set(m[1]!, { id: m[1]!, version: Number(m[2]), type: m[3]!, instructions: squash(m[4]!) });
  }
  // Sections: ### `id@1` — type
  const sections = md
    .split(/^### /m)
    .slice(1)
    .map((s) => s.split(/^## /m)[0]!); // a section ends at the next ### or ## heading
  for (const section of sections) {
    const head = /^`(\w+)@(\d+)` — (choice|score|noul)/.exec(section);
    if (!head) continue;
    const q: MdQuestion = { id: head[1]!, version: Number(head[2]), type: head[3]! };
    const instr = /Instructions: \*([\s\S]+?)\*(?:\n|$)/.exec(section);
    if (instr) q.instructions = squash(instr[1]!);
    const rows = [...section.matchAll(/^\| `(\w+)` \| (.+?) \|$/gm)];
    if (rows.length) q.options = Object.fromEntries(rows.map((r) => [r[1]!, r[2]!.trim()]));
    const levels = /Criteria(?: \(low → high\))?: `(\[.+?\])`/.exec(section);
    if (levels) q.levels = JSON.parse(levels[1]!) as string[];
    out.set(q.id, q);
  }
  // Feature flags: | `feat_x` | statement |
  const flagsSection = md.slice(md.indexOf('## S1 — Feature flags'), md.indexOf('## S2'));
  for (const m of flagsSection.matchAll(/^\| `(feat_\w+)` \| (.+?) \|$/gm)) {
    out.set(m[1]!, {
      id: m[1]!,
      version: 1,
      type: 'noul',
      instructions: `The website described ${m[2]!.trim()}`,
    });
  }
  return out;
}

const mdCatalog = parse();

describe('catalog.md ↔ code catalog', () => {
  it('lists the same questions with the same versions and types', () => {
    const fromMd = [...mdCatalog.values()].map((q) => `${q.id}@${q.version}:${q.type}`).sort();
    const fromCode = CATALOG.map((q) => `${q.id}@${q.version}:${q.type}`).sort();
    expect(fromCode).toEqual(fromMd);
  });

  it('uses identical instructions', () => {
    for (const q of mdCatalog.values()) {
      if (q.instructions) expect(squash(questionById(q.id).instructions), q.id).toBe(q.instructions);
    }
  });

  it('uses identical options for fixed choice questions', () => {
    for (const q of mdCatalog.values()) {
      if (!q.options) continue;
      const def = questionById(q.id);
      expect(def.type === 'choice' && def.criteria !== 'runtime' ? def.criteria : null, q.id).toEqual(
        q.options,
      );
    }
  });

  it('uses identical rubric levels for score questions', () => {
    for (const q of mdCatalog.values()) {
      if (!q.levels) continue;
      const def = questionById(q.id);
      expect(def.type === 'score' ? def.criteria : null, q.id).toEqual(q.levels);
    }
  });

  it('has the documented geo and language keys', () => {
    const geo = questionById('geo_scope');
    const geoText = squash(md.slice(md.indexOf('### `geo_scope@1`'), md.indexOf('### `language@1`')));
    const isoList = /`country_<iso2>` for: (.+?); and `other_country`/.exec(geoText)![1]!.split(', ');
    const expectedGeo = [
      'global',
      'region_europe',
      'region_asia',
      'region_latam',
      'region_africa',
      'region_middle_east',
      ...isoList.map((c) => `country_${c}`),
      'other_country',
    ];
    expect(geo.type === 'choice' && geo.criteria !== 'runtime' ? Object.keys(geo.criteria) : []).toEqual(
      expectedGeo,
    );

    const lang = questionById('language');
    const langKeys = /Keys: `([a-z, ]+)`/.exec(md.slice(md.indexOf('### `language@1`')))![1]!.split(', ');
    expect(lang.type === 'choice' && lang.criteria !== 'runtime' ? Object.keys(lang.criteria) : []).toEqual(
      langKeys,
    );
  });

  it('has 40 feature flags, as the catalog overview says', () => {
    expect(Object.keys(FLAG_STATEMENTS)).toHaveLength(40);
  });
});
