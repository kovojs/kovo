import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const compilerSrcDir = dirname(fileURLToPath(import.meta.url));
const repoPackagesDir = dirname(dirname(compilerSrcDir));

function productionTypescriptFiles(root: string): string[] {
  const entries = readdirSync(root, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...productionTypescriptFiles(path));
      continue;
    }

    if (
      entry.isFile() &&
      entry.name.endsWith('.ts') &&
      !entry.name.endsWith('.test.ts') &&
      entry.name !== 'test-support.ts'
    ) {
      files.push(path);
    }
  }

  return files.sort();
}

describe('render-equivalence production boundary', () => {
  it('uses SPEC §5.2 semantic render equivalence, not source-normalization evidence', () => {
    const roots = [compilerSrcDir, join(repoPackagesDir, 'cli/src')];
    const files = roots.flatMap(productionTypescriptFiles);
    const forbidden = [
      /\brenderEquivalenceSourceCheck\b/,
      /\brenderEquivalenceCheck\s*\(/,
      /\bnormalizeRenderEquivalenceSource\b/,
      /\bexpectedIgnoredSpans\b/,
      /\bremoveIgnoredSpans\b/,
    ];
    const violations = files.flatMap((file) => {
      const source = readFileSync(file, 'utf8');
      return forbidden
        .filter((pattern) => pattern.test(source))
        .map((pattern) => `${relative(repoPackagesDir, file)}: ${pattern}`);
    });

    expect(violations).toEqual([]);

    const compileSource = readFileSync(join(compilerSrcDir, 'compile.ts'), 'utf8');
    expect(compileSource).toContain(
      'semanticRenderEquivalenceCheck(fileNames.server, originalModel, serverModule.executableSource)',
    );
  });
});
