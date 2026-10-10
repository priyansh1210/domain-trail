// Daily extension registry (spec 010 tech §5.2; FR-REF-001, 009): the IANA list of extensions and the RDAP
// directory → `tlds`; extensions that left the IANA list are marked retired (never deleted). On Sundays (or with
// --force) a random-name DNS lookup finds priced extensions whose name servers answer for every name.
import { IANA_RDAP_URL, RdapDirectory, dohQuery, resolves, Semaphore } from '@domains-all/availability';
import { json } from '../_lib/db';
import { downloadJson, downloadText } from '../_lib/fetch';
import type { JobContext, JobDefinition } from '../_lib/run';

export const IANA_TLDS_URL = 'https://data.iana.org/TLD/tlds-alpha-by-domain.txt';

/** Parses IANA's `tlds-alpha-by-domain.txt` (a `#` header line, then one extension per line). */
export function parseTldList(text: string): string[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines[0]?.startsWith('#')) throw new Error('IANA extension list: header line missing');
  const tlds = lines.filter((l) => !l.startsWith('#')).map((l) => l.toLowerCase());
  if (tlds.length < 1000) throw new Error(`IANA extension list: only ${tlds.length} entries`);
  const bad = tlds.find((t) => !/^[a-z0-9-]{2,63}$/.test(t));
  if (bad !== undefined) throw new Error('IANA extension list: unexpected line format');
  return [...new Set(tlds)];
}

export const tldType = (tld: string): 'gTLD' | 'ccTLD' | 'sld' =>
  tld.includes('.') ? 'sld' : tld.length === 2 ? 'ccTLD' : 'gTLD';

function randomLabel(length = 20): string {
  const letters = 'abcdefghijklmnopqrstuvwxyz';
  return Array.from({ length }, () => letters[Math.floor(Math.random() * letters.length)]).join('');
}

async function wildcardScan(ctx: JobContext): Promise<{ checked: number; wildcards: number }> {
  const rows = await ctx.db.query<{ tld: string }>(
    `select tld from public.tlds where priced and not retired order by tld`,
  );
  const gate = new Semaphore(8);
  const results = await Promise.all(
    rows.map(({ tld }) =>
      gate.run(async () => {
        const answer = await dohQuery(`${randomLabel()}.${tld}`, 'A', {
          fetchFn: ctx.fetch,
          timeoutMs: 4000,
        });
        return answer ? { tld, wildcard: resolves(answer) } : undefined;
      }),
    ),
  );
  const known = results.filter((r): r is { tld: string; wildcard: boolean } => !!r);
  await ctx.db.query(
    `update public.tlds t set dns_wildcard = r.wildcard, updated_at = now()
     from jsonb_to_recordset($1::text::jsonb) as r(tld text, wildcard boolean)
     where t.tld = r.tld and t.dns_wildcard is distinct from r.wildcard`,
    [json(known)],
  );
  return { checked: known.length, wildcards: known.filter((r) => r.wildcard).length };
}

export const tldRegistry: JobDefinition = {
  name: 'tld-registry',
  async run(ctx) {
    // Download and validate everything before the first write (spec 010 §8: validation failures write nothing).
    const [listText, bootstrap] = await Promise.all([
      downloadText(ctx, IANA_TLDS_URL, { maxBytes: 1_000_000 }),
      downloadJson(ctx, IANA_RDAP_URL, { maxBytes: 5_000_000 }),
    ]);
    const tlds = parseTldList(listText);
    const directory = RdapDirectory.fromIana(bootstrap);
    const rows = tlds.map((tld) => ({ tld, type: tldType(tld), rdap: directory.baseFor(tld) ?? null }));

    const counts = await ctx.db.tx(async (t) => {
      await t.query(
        `insert into public.tlds (tld, type, rdap_base_url, has_rdap, retired, updated_at)
         select r.tld, r.type, r.rdap, r.rdap is not null, false, now()
         from jsonb_to_recordset($1::text::jsonb) as r(tld text, type text, rdap text)
         on conflict (tld) do update set
           rdap_base_url = excluded.rdap_base_url, has_rdap = excluded.has_rdap, retired = false,
           type = case when public.tlds.type = 'brand' then 'brand' else excluded.type end,
           updated_at = now()`,
        [json(rows)],
      );
      const retired = await t.query(
        `update public.tlds set retired = true, updated_at = now()
         where type <> 'sld' and not retired
           and tld not in (select jsonb_array_elements_text($1::text::jsonb))
         returning tld`,
        [json(tlds)],
      );
      // Second-level extensions (co.in, com.au) are answered by their parent's registry.
      const slds = await t.query(
        `update public.tlds s set rdap_base_url = p.rdap_base_url, has_rdap = p.has_rdap, updated_at = now()
         from public.tlds p
         where s.type = 'sld' and p.tld = substring(s.tld from '[^.]+$')
         returning s.tld`,
      );
      return { retiredNow: retired.length, slds: slds.length };
    });

    const sunday = ctx.now.getUTCDay() === 0;
    const scan = sunday || ctx.force ? await wildcardScan(ctx) : undefined;
    return {
      tlds: tlds.length,
      withRdap: rows.filter((r) => r.rdap).length,
      ...counts,
      rdapPublication: directory.publication,
      ...(scan ? { wildcardChecked: scan.checked, wildcards: scan.wildcards } : {}),
    };
  },
};
