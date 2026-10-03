// Availability accuracy (spec 005 tech §5.6; FR-AVL-012, NFR-AVL-001/002; tasks/M4-verify.md H1). Generates names
// for the golden examples, checks them with our checker (live DNS + RDAP), samples up to 100 "available" and 100
// "taken" spread over extensions, and compares each with a registrar's own answer (Porkbun bulk checkDomain, 25 names
// per call, 200 names per minute). Needs PORKBUN_API_KEY and PORKBUN_SECRET_KEY. Fails below the targets.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type CheckResult, createChecker, createDirectorySource } from '@domains-all/availability';
import { parseServerEnv } from '@domains-all/config';
import { createJev } from '@domains-all/jev';
import type { GoldenItem } from '../src/eval/evaluate';
import { PreferencesSchema } from '../src/intake/schema';
import { runNames } from '../src/pipeline/names';
import { runS1 } from '../src/pipeline/s1';

const TARGET = { available: 0.97, taken: 0.995 };
const PER_STATUS = 100;
const onGitHub = process.env.GITHUB_ACTIONS === 'true';
/** `--dry-run`: our side only, on 3 examples, to see the sample sizes without a registrar key. */
const dryRun = process.argv.includes('--dry-run');
const apikey = process.env.PORKBUN_API_KEY;
const secretapikey = process.env.PORKBUN_SECRET_KEY;
if (!dryRun && (!apikey || !secretapikey)) {
  console.error('Set PORKBUN_API_KEY and PORKBUN_SECRET_KEY (free Porkbun account, API access on).');
  process.exit(1);
}

const evalDir = join(import.meta.dirname, '..', '..', 'jev', 'eval');
const golden = readFileSync(join(evalDir, 'golden.jsonl'), 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((l) => JSON.parse(l) as GoldenItem)
  .filter((g) => g.category === 'benign')
  .slice(0, dryRun ? 3 : undefined);

// 1. Names from the real pipeline (deterministic ranking), checked live.
const jev = createJev({ env: parseServerEnv({}) }); // mock decisions: names only, no paid calls
const preferences = PreferencesSchema.parse({ forceSearch: true, maxLength: 20, allowHyphens: true });
const checker = createChecker({
  directory: createDirectorySource({ live: true }),
  userAgent: 'DomainTrail-accuracy/0.1 (+https://github.com/priyansh1210/domain-trail)',
});
const checked: CheckResult[] = [];
for (const g of golden) {
  const s1 = await runS1({ description: g.description, preferences, searchId: `acc-${g.id}`, jev });
  if (s1.kind !== 'features') continue;
  const names = await runNames({
    description: g.description,
    preferences,
    profile: s1.profile,
    strictBrand: false,
    searchId: `acc-${g.id}`,
    seed: g.id,
    jev,
    live: false,
  });
  // Add a few short dictionary-style names so "taken" has enough examples (most generated names are free).
  const fqdns = [
    ...names.pairs.slice(0, 40).map((p) => p.fqdn),
    ...names.pairs.slice(0, 10).map((p) => `${p.label.slice(0, 5)}.com`),
  ];
  const { results } = await checker.checkMany(fqdns, { deadline: Date.now() + 30_000 });
  checked.push(...results);
}

// 2. Stratified sample: round-robin over extensions so no single registry dominates.
function sample(status: 'available' | 'taken'): CheckResult[] {
  const byTld = new Map<string, CheckResult[]>();
  for (const r of checked.filter((x) => x.status === status))
    byTld.set(r.tld, [...(byTld.get(r.tld) ?? []), r]);
  const out: CheckResult[] = [];
  while (out.length < PER_STATUS && [...byTld.values()].some((l) => l.length)) {
    for (const list of byTld.values()) {
      const next = list.shift();
      if (next) out.push(next);
      if (out.length >= PER_STATUS) break;
    }
  }
  return out;
}
const picked = [...sample('available'), ...sample('taken')];
if (dryRun) {
  const count = (s: string) => checked.filter((r) => r.status === s).length;
  console.log(
    `checked ${checked.length}: available ${count('available')}, taken ${count('taken')}, likely ${count('likely_available')}, unknown ${count('unknown')}; sample ${picked.length} over ${new Set(picked.map((r) => r.tld)).size} extensions`,
  );
  process.exit(0);
}

// 3. Registrar answers, 25 per call, spaced to stay under 200 names per minute.
const registrar = new Map<string, boolean>();
for (let i = 0; i < picked.length; i += 25) {
  const batch = picked.slice(i, i + 25).map((r) => r.fqdn);
  const res = await fetch('https://api.porkbun.com/api/json/v3/domain/checkDomain', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ apikey, secretapikey, domains: batch }),
    signal: AbortSignal.timeout(30_000),
  });
  const json = (await res.json()) as {
    status?: string;
    message?: string;
    domains?: Record<string, { avail?: string }>;
  };
  if (json.status !== 'SUCCESS') {
    console.error(`Porkbun refused the check: ${json.message ?? res.status}`);
    process.exit(1);
  }
  for (const [fqdn, r] of Object.entries(json.domains ?? {}))
    if (r.avail === 'yes' || r.avail === 'no') registrar.set(fqdn, r.avail === 'yes');
  if (i + 25 < picked.length) await new Promise((r) => setTimeout(r, 8000));
}

// 4. Agreement per status (names Porkbun could not answer or does not sell are left out).
const stats = (status: 'available' | 'taken') => {
  const rows = picked.filter((r) => r.status === status && registrar.has(r.fqdn));
  const agree = rows.filter((r) => registrar.get(r.fqdn) === (status === 'available'));
  const wrong = rows.filter((r) => registrar.get(r.fqdn) !== (status === 'available'));
  return {
    n: rows.length,
    accuracy: rows.length ? agree.length / rows.length : 0,
    wrong: wrong.map((r) => r.fqdn),
  };
};
const avail = stats('available');
const taken = stats('taken');
const date = new Date().toISOString().slice(0, 10);
const line = (name: string, s: ReturnType<typeof stats>, target: number) =>
  `| ${name} | ${s.n} | ${(s.accuracy * 100).toFixed(1)} % | ≥ ${(target * 100).toFixed(1)} % | ${s.wrong.slice(0, 10).join(', ') || '—'} |`;
const report = [
  `# Availability accuracy — ${date}`,
  '',
  `Checked ${checked.length} names from ${golden.length} golden examples; compared a stratified sample with Porkbun.`,
  '',
  '| Our answer | Sampled | Agrees with registrar | Target | Disagreements (first 10) |',
  '|---|---|---|---|---|',
  line('available', avail, TARGET.available),
  line('taken', taken, TARGET.taken),
  '',
].join('\n');
mkdirSync(join(evalDir, 'reports'), { recursive: true });
writeFileSync(join(evalDir, 'reports', `availability-${date}.md`), report);
if (onGitHub && process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, report);
for (const [name, s, target] of [
  ['available', avail, TARGET.available],
  ['taken', taken, TARGET.taken],
] as const) {
  const msg = `${(s.accuracy * 100).toFixed(1)} % of ${s.n} agree with the registrar (target ${(target * 100).toFixed(1)} %)`;
  console.log(onGitHub ? `::notice title=Accuracy of "${name}"::${msg}` : `${name}: ${msg}`);
}
const failed =
  avail.n === 0 || avail.accuracy < TARGET.available || (taken.n > 0 && taken.accuracy < TARGET.taken);
if (failed)
  console.log(
    onGitHub ? '::error title=Availability accuracy::below target — see the report' : 'below target',
  );
process.exit(failed ? 1 : 0);
