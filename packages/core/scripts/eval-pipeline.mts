// `pnpm eval:pipeline` (spec 016 tech §4–5.1, task M3-F1): ranks the golden set and writes a report to
// packages/jev/eval/reports/YYYY-MM-DD.md. Uses the real Jev when MOCK_EXTERNALS=0 and an API key are set;
// otherwise reports the degraded (rule-based) and mock modes. `--require-jev` (the GitHub workflow) fails the run
// when the real Jev is not configured or never answered, so a broken connection cannot pass for a real score.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseServerEnv } from '@domains-all/config';
import { createJev, type DecisionService } from '@domains-all/jev';
import { evaluateGolden, type GoldenItem } from '../src/eval/evaluate';
import { rulesMockHint } from '../src/features/mock-hint';

const evalDir = join(import.meta.dirname, '..', '..', 'jev', 'eval');
const golden = readFileSync(join(evalDir, 'golden.jsonl'), 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((l) => JSON.parse(l) as GoldenItem);
const requireJev = process.argv.includes('--require-jev');
const onGitHub = process.env.GITHUB_ACTIONS === 'true';

/** Counts what the decision service really did: answered vs degraded asks, requests and tokens. */
function counted(jev: DecisionService) {
  const stats = { asks: 0, degraded: 0, requests: 0, tokens: 0, reasons: new Set<string>() };
  const service: DecisionService = {
    ask: async (params) => {
      const r = await jev.ask(params);
      stats.asks += 1;
      stats.requests += r.usage.requests;
      stats.tokens += r.usage.inputTokens;
      if (r.degraded) {
        stats.degraded += 1;
        if (r.degradedReason) stats.reasons.add(r.degradedReason);
      }
      return r;
    },
    recordSearch: (u) => jev.recordSearch(u),
    breakerState: () => jev.breakerState(),
  };
  return { service, stats };
}

const env = parseServerEnv(process.env);
const hasKey = !env.MOCK_EXTERNALS && Boolean(env.AI_GATEWAY_API_KEY || env.TYPESAFE_API_KEY);
if (requireJev && !hasKey) {
  console.error('The real Jev is not configured: set MOCK_EXTERNALS=0 and AI_GATEWAY_API_KEY.');
  process.exit(1);
}
const runs: Array<[string, DecisionService]> = [];
if (hasKey) runs.push([`Jev ${env.JEV_MODEL}`, createJev({ env })]);
runs.push(['degraded (Jev unavailable)', createJev({ env: parseServerEnv({ MOCK_EXTERNALS: '0' }) })]);
runs.push(['mock Jev (rules)', createJev({ env: parseServerEnv({}), mockHint: rulesMockHint })]);

const date = new Date().toISOString().slice(0, 10);
const benign = golden.filter((g) => g.category === 'benign').length;
const lines = [
  `# Ranking evaluation — ${date}`,
  '',
  `Golden set: ${golden.length} items (${benign} with names).`,
  '',
  '| Mode | Mean NDCG@10 | Target | Jev answered | Tokens |',
  '|---|---|---|---|---|',
];
const details: string[] = [];
let failed = false;
for (const [name, jev] of runs) {
  const { service, stats } = counted(jev);
  const r = await evaluateGolden(golden, service);
  const live = name.startsWith('Jev');
  const target = live ? '≥ 0.60' : name.startsWith('degraded') ? '≥ 0.40' : '—';
  const answered = stats.asks - stats.degraded;
  const why = stats.reasons.size ? ` (${[...stats.reasons].join(', ')})` : '';
  lines.push(
    `| ${name} | ${r.meanNdcg.toFixed(3)} | ${target} | ${answered} of ${stats.asks}${why} | ${stats.tokens.toLocaleString('en-US')} |`,
  );
  details.push(`\n## ${name}\n`, '| Item | NDCG@10 | Order (+ good, − bad) |', '|---|---|---|');
  for (const x of r.results)
    details.push(
      `| ${x.id} | ${x.ndcg.toFixed(2)} | ${x.order.map((o) => `${o.good ? '+' : '−'}${o.label}`).join(' ')} |`,
    );
  const summary = `NDCG@10 ${r.meanNdcg.toFixed(3)} (target ${target}); Jev answered ${answered} of ${stats.asks}${why}; ${stats.tokens} tokens`;
  // GitHub shows "::notice" lines as annotations, which anyone can read on a public repository.
  console.log(onGitHub ? `::notice title=${name}::${summary}` : `${name}: ${summary}`);
  if (live && requireJev && answered === 0) {
    console.log(
      `::error title=${name}::Jev never answered${why}; check the API key and the AI Gateway credit.`,
    );
    failed = true;
  }
}
mkdirSync(join(evalDir, 'reports'), { recursive: true });
const file = join(evalDir, 'reports', `${date}.md`);
const report = [...lines, ...details, ''].join('\n');
writeFileSync(file, report);
if (onGitHub && process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, report);
console.log(`report: ${file}`);
if (failed) process.exit(1);
