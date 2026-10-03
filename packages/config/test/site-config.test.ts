// FR-SYS-011: the site's own name and address must not be hard-coded anywhere in source, so moving from the
// free hosting address to an owned domain stays a configuration change.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = join(import.meta.dirname, '..', '..', '..');
const SOURCE_DIRS = ['apps', 'packages', 'scripts'];
const SKIP = new Set(['node_modules', '.next', '.turbo', 'dist', 'coverage', 'test', 'e2e']);

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx|mjs|js)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const files = SOURCE_DIRS.flatMap((d) => {
  try {
    return sourceFiles(join(repoRoot, d));
  } catch {
    return [];
  }
});

describe('site identity is configuration only', () => {
  it('finds source files to check', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('has no hard-coded *.vercel.app address', () => {
    const offenders = files.filter((f) => /[a-z0-9-]+\.vercel\.app/i.test(readFileSync(f, 'utf8')));
    expect(offenders.map((f) => relative(repoRoot, f))).toEqual([]);
  });

  it('has no hard-coded product name in user-facing app code', () => {
    const appFiles = files.filter((f) => f.includes(join('apps', 'web')) && /\.tsx?$/.test(f));
    const offenders = appFiles.filter((f) =>
      // Package imports (@domains-all/...) are fine; a visible "domains-all" string is not.
      /(?<!@)domains-all(?!\/)/.test(readFileSync(f, 'utf8')),
    );
    expect(offenders.map((f) => relative(repoRoot, f))).toEqual([]);
  });
});
