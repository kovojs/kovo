// B0 meta-test: guards the vite.config.ts `integration` task input globs so that
// a refactor of the verifier, harness, or app-facing packages cannot silently
// cache-hit the integration gate green (plans/bugs-and-testing.md C-lane "B0";
// testing-audit §5.7).
//
// The integration task must list `packages/test/src/**` plus the app-facing
// packages as cache-key inputs because integration is the SOLE exerciser of the
// runtime DB verifier (packages/test/src/{verifier,verifier-*,sql-observer,
// pglite}.ts), the harness, and the cross-package package stack. If these globs
// are removed, verifier or package refactors could cache-hit green without
// re-running any specs.

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
const REQUIRED_INTEGRATION_INPUTS = [
  'packages/test/src/**',
  'packages/core/src/**',
  'packages/server/src/**',
  'packages/compiler/src/**',
  'packages/browser/src/**',
  'packages/drizzle/src/**',
  'packages/style/src/**',
  'packages/ui/src/**',
  'packages/headless-ui/src/**',
  'packages/better-auth/src/**',
  'packages/cli/src/**',
] as const;

describe('vite.config.ts integration task (B0 cache-key guard)', () => {
  it('includes verifier and app package src globs in the integration task input', () => {
    const source = fs.readFileSync(CONFIG_PATH, 'utf8');

    for (const pattern of REQUIRED_INTEGRATION_INPUTS) {
      expect(source).toContain(`{ pattern: '${pattern}', base: 'workspace' }`);
    }
  });

  it('places the verifier and app package src globs inside the integration task block', () => {
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

    for (const pattern of REQUIRED_INTEGRATION_INPUTS) {
      expect(integrationBlock).toContain(`{ pattern: '${pattern}', base: 'workspace' }`);
    }
  });
});
