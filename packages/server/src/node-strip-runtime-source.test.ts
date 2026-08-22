import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

const repositoryRoot = fileURLToPath(new URL('../../..', import.meta.url));

function isAuthoredProductionTypeScript(relativePath: string): boolean {
  if (!relativePath.endsWith('.ts') || relativePath.endsWith('.d.ts')) return false;
  if (relativePath.startsWith('packages/test/')) return false;
  if (/^packages\/[^/]*fixtures?[^/]*\//u.test(relativePath)) return false;
  if (/(?:^|\/)(?:fixtures?|__fixtures__|generated)(?:\/|$)/u.test(relativePath)) return false;
  if (/\.(?:test|spec)\.ts$/u.test(relativePath)) return false;
  if (/(?:^|\/)[^/]*-test-(?:fakes|utils)\.ts$/u.test(relativePath)) return false;
  if (/(?:^|\/)generated-[^/]+\.ts$/u.test(relativePath)) return false;
  if (/\.generated\.ts$/u.test(relativePath)) return false;
  return true;
}

function trackedProductionTypeScript(): string[] {
  return execFileSync('git', ['ls-files', '-z', 'packages/*/src/*.ts', 'packages/*/src/**/*.ts'], {
    cwd: repositoryRoot,
  })
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
    .filter(isAuthoredProductionTypeScript);
}

// Example Vite configs load workspace package source through Node's strip-only TypeScript path.
// `check:vp` owns the executed config-graph proof; this bounded tracked-source census keeps the
// SPEC §6.6/§9.1 runtime-source representation erasable and reports every offending production
// file in one run instead of revealing parser failures serially.
describe('Node strip-only production runtime sources', () => {
  it('strips every tracked authored package source without transforming TypeScript', () => {
    const sources = trackedProductionTypeScript();
    const failures: string[] = [];

    expect(sources.length).toBeGreaterThan(800);
    expect(sources.length).toBeLessThan(2_000);

    for (const relativePath of sources) {
      const absolutePath = join(repositoryRoot, relativePath);
      try {
        stripTypeScriptTypes(readFileSync(absolutePath, 'utf8'), {
          mode: 'strip',
          sourceUrl: pathToFileURL(absolutePath).href,
        });
      } catch (error) {
        failures.push(
          `${relativePath}: ${error instanceof Error ? error.message.split('\n')[0] : 'unknown parser failure'}`,
        );
      }
    }

    expect(failures).toEqual([]);
  });
});
