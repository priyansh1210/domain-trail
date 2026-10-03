#!/usr/bin/env node
// Traceability check (spec 016 tech §5.2, FR-QA-001): every FR-/NFR- ID in a spec.md must appear exactly once in
// the traceability matrix of its tech.md. Referenced test files are listed as "not yet written" until their
// milestone; pass --strict to fail on those too.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const strict = process.argv.includes('--strict');
const ID = /^\| ((?:N?FR)-[A-Z]+-\d{3}) \|/gm;

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.next', '.turbo', '.git', 'dist', 'coverage'].includes(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(entry.name);
  }
  return out;
}

const existingFiles = new Set(walk(root));
const problems = [];
const missingTests = new Set();
let idCount = 0;

for (const dir of readdirSync(join(root, 'specs')).sort()) {
  const specPath = join(root, 'specs', dir, 'spec.md');
  const techPath = join(root, 'specs', dir, 'tech.md');
  if (!existsSync(specPath) || !existsSync(techPath)) {
    problems.push(`${dir}: spec.md and tech.md must both exist`);
    continue;
  }
  const ids = [...new Set([...readFileSync(specPath, 'utf8').matchAll(ID)].map((m) => m[1]))];
  const tech = readFileSync(techPath, 'utf8');
  const matrix = tech.slice(tech.indexOf('## 13. Traceability'));
  const rows = [...matrix.matchAll(ID)].map((m) => m[1]);
  idCount += ids.length;

  for (const id of ids) {
    const n = rows.filter((r) => r === id).length;
    if (n !== 1) problems.push(`${dir}: ${id} appears ${n} times in the tech.md matrix (expected 1)`);
  }
  for (const r of rows)
    if (!ids.includes(r)) problems.push(`${dir}: matrix row ${r} has no requirement in spec.md`);

  for (const line of matrix.split('\n').filter((l) => /^\| N?FR-/.test(l))) {
    const testCell = line.split('|').at(-2) ?? '';
    for (const [, file] of testCell.matchAll(/`([\w.-]+\.(?:test|spec)\.tsx?)`/g)) {
      if (!existingFiles.has(file)) missingTests.add(file);
    }
  }
}

console.log(`trace:check — ${idCount} requirements across ${readdirSync(join(root, 'specs')).length} specs`);
if (missingTests.size) {
  console.log(
    `  ${missingTests.size} referenced test files not written yet (expected before their milestone).`,
  );
}
if (problems.length || (strict && missingTests.size)) {
  for (const p of problems) console.error(`  ✗ ${p}`);
  if (strict) for (const f of missingTests) console.error(`  ✗ missing test file ${f}`);
  process.exit(1);
}
console.log('  ✓ every requirement has exactly one traceability row');
