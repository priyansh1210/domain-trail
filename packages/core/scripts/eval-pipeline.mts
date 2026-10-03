// `pnpm eval:pipeline` (spec 016 tech §4–5.1, task M3-F1): ranks the golden set and writes a report to
// packages/jev/eval/reports/YYYY-MM-DD.md. Uses the real Jev when MOCK_EXTERNALS=0 and an API key are set;
// otherwise reports the degraded (rule-based) and mock modes.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseServerEnv } from '@domains-all/config';
import { createJev } from '@domains-all/jev';
import { evaluateGolden, type GoldenItem } from '../src/eval/evaluate';
import { rulesMockHint } from '../src/features/mock-hint';

const evalDir = join(import.meta.dirname, '..', '..', 'jev', 'eval');
const golden = readFileSync(join(evalDir, 'golden.jsonl'), 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((l) => JSON.parse(l) as GoldenItem);

const env = parseServerEnv(process.env);
const runs: Array<[string, ReturnType<typeof createJev>]> = [];
if (!env.MOCK_EXTERNALS && (env.AI_GATEWAY_API_KEY || env.TYPESAFE_API_KEY))
  runs.push([`Jev ${env.JEV_MODEL}`, createJev({ env })]);
runs.push(['degraded (Jev unavailable)', createJev({ env: parseServerEnv({ MOCK_EXTERNALS: '0' }) })]);
runs.push(['mock Jev (rules)', createJev({ env: parseServerEnv({}), mockHint: rulesMockHint })]);

const date = new Date().toISOString().slice(0, 10);
const lines = [
  `# Ranking evaluation — ${date}`,
  '',
  `Golden set: ${golden.length} items (${golden.filter((g) => g.category === 'benign').length} with names).`,
  '',
  '| Mode | Mean NDCG@10 | Target |',
  '|---|---|---|',
];
const details: string[] = [];
for (const [name, jev] of runs) {
  const r = await evaluateGolden(golden, jev);
  const target = name.startsWith('Jev') ? '≥ 0.60' : name.startsWith('degraded') ? '≥ 0.40' : '—';
  lines.push(`| ${name} | ${r.meanNdcg.toFixed(3)} | ${target} |`);
  details.push(`\n## ${name}\n`, '| Item | NDCG@10 | Order (+ good, − bad) |', '|---|---|---|');
  for (const x of r.results)
    details.push(
      `| ${x.id} | ${x.ndcg.toFixed(2)} | ${x.order.map((o) => `${o.good ? '+' : '−'}${o.label}`).join(' ')} |`,
    );
  console.log(`${name}: ${r.meanNdcg.toFixed(3)}`);
}
mkdirSync(join(evalDir, 'reports'), { recursive: true });
const file = join(evalDir, 'reports', `${date}.md`);
writeFileSync(file, [...lines, ...details, ''].join('\n'));
console.log(`report: ${file}`);
