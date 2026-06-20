// B0 meta-test: guards the vite.config.ts `integration` task input glob so that
// a refactor of packages/test/src/* cannot silently cache-hit the integration
// gate green (plans/bugs-and-testing.md C-lane "B0"; testing-audit §5.7).
//
// The integration task must list `packages/test/src/**` as a cache-key input
// because it is the SOLE exerciser of the runtime DB verifier
// (packages/test/src/{verifier,verifier-*,sql-observer,pglite}.ts) and the
// harness. If that glob is removed, a verifier refactor that disables KV402/
// KV407/KV411 enforcement could cache-hit green without re-running any specs.

import { describe, expect, it } from 'vitest';

// Dynamically import vite.config.ts using Vite's ?raw loader workaround is
// brittle — instead read the resolved config object directly. vite.config.ts
// uses `defineConfig` from vite-plus which is a thin wrapper that returns the
// raw options; we read the source and extract the input array textually via
// import so TypeScript validates the shape.
//
// We rely on a simple textual search of the serialized config source rather
// than importing the live config object, because vite.config.ts has side
// effects (workspaceRootFromCwd, plugin construction) that require the full
// Vite plugin environment. A text search is a sound proxy: the assertion
// will break the moment the exact pattern string is removed or renamed.

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as url from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const CONFIG_PATH = path.join(REPO_ROOT, 'vite.config.ts');

describe('vite.config.ts integration task (B0 cache-key guard)', () => {
  it('includes packages/test/src/** in the integration task input', () => {
    const source = fs.readFileSync(CONFIG_PATH, 'utf8');

    // Verify the integration task block contains the test-package src glob.
    // This is the guard for plans/bugs-and-testing.md B0: if someone removes
    // this pattern, the integration cache won't re-run when the verifier changes.
    expect(source).toContain("{ pattern: 'packages/test/src/**', base: 'workspace' }");
  });

  it('places the packages/test/src/** glob inside the integration task block', () => {
    const source = fs.readFileSync(CONFIG_PATH, 'utf8');

    // Find the integration task block and verify the glob is inside it, not
    // just anywhere in the file (defensive: checks locality, not just presence).
    const integrationBlockStart = source.indexOf('integration: {');
    expect(
      integrationBlockStart,
      'integration task block must exist in vite.config.ts',
    ).toBeGreaterThan(0);

    // Find the next top-level task after integration to bound the search.
    // (Use a simple heuristic: the next task key at the same indent level.)
    const nextTaskStart = source.indexOf("\n      'conformance-drizzle':", integrationBlockStart);
    const integrationBlock =
      nextTaskStart > integrationBlockStart
        ? source.slice(integrationBlockStart, nextTaskStart)
        : source.slice(integrationBlockStart);

    expect(integrationBlock).toContain("{ pattern: 'packages/test/src/**', base: 'workspace' }");
  });
});
