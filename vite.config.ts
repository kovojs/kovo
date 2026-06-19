import { defineConfig } from 'vite-plus';

import { commerceRegistryFacts, exampleKovoCompilerPlugin } from './examples/vite-kovo-compiler.js';

const repoRoot = workspaceRootFromCwd();
const exampleGeneratedGraphsGlobalSetup = repoRoot
  ? `${repoRoot}/tests/example-generated-graphs.global-setup.ts`
  : 'tests/example-generated-graphs.global-setup.ts';

function workspaceRootFromCwd(): string {
  if (typeof process === 'undefined') return '';
  const cwd = process.cwd().replaceAll('\\', '/');
  for (const marker of ['/packages/', '/examples/', '/conformance/']) {
    const index = cwd.indexOf(marker);
    if (index > 0) return cwd.slice(0, index);
  }
  if (cwd.endsWith('/site')) return cwd.slice(0, -'/site'.length);
  return cwd;
}

export default defineConfig({
  plugins: [
    exampleKovoCompilerPlugin({ include: ['site/tutorial/steps'] }),
    exampleKovoCompilerPlugin({
      include: ['examples/commerce/src/components'],
      registryFacts: commerceRegistryFacts,
    }),
  ],
  lint: {
    // Starter templates are copied verbatim; lint governs authored workspace code.
    ignorePatterns: ['packages/create-kovo/templates/**'],
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  fmt: {
    ignorePatterns: ['dist/**', 'coverage/**', 'node_modules/**'],
    semi: true,
    singleQuote: true,
    sortPackageJson: true,
  },
  run: {
    cache: {
      scripts: true,
      tasks: true,
    },
    tasks: {
      build: {
        command: 'vp pack && node scripts/prod-emit-check.mjs',
        output: ['dist/**'],
        input: [
          { auto: true },
          { pattern: 'package.json', base: 'workspace' },
          { pattern: 'packages/*/package.json', base: 'workspace' },
          { pattern: 'pnpm-lock.yaml', base: 'workspace' },
          { pattern: 'scripts/prod-emit-check.mjs', base: 'workspace' },
          { pattern: 'packages/*/src/**', base: 'workspace' },
        ],
      },
      browser: {
        command: 'vitest --config vitest.browser.config.ts --run',
        input: [
          { auto: true },
          { pattern: 'vitest.browser.config.ts', base: 'workspace' },
          { pattern: 'tests/browser-acceptance.mjs', base: 'workspace' },
          { pattern: 'packages/browser/src/**/*.browser.test.ts', base: 'workspace' },
        ],
      },
      'p10-perf': {
        command: 'node tests/p10-perf.node.mjs',
        input: [
          { auto: true },
          { pattern: 'tests/p10-perf.node.mjs', base: 'workspace' },
          { pattern: 'dist/**', base: 'workspace' },
        ],
      },
      'compiler-perf': {
        command: 'vitest --run tests/compiler-perf.test.ts',
        input: [
          { auto: true },
          { pattern: 'tests/compiler-perf.test.ts', base: 'workspace' },
          { pattern: 'tests/compiler-perf-corpora.ts', base: 'workspace' },
          { pattern: 'tests/compiler-perf.budgets.json', base: 'workspace' },
          { pattern: 'packages/compiler/src/**/*.ts', base: 'workspace' },
        ],
      },
      integration: {
        // Framework-owned integration suite: boot a single-file Kovo fixture on a
        // real Vite-SSR server and drive it in Chromium via @playwright/test
        // (plans/integration-test-suite.md). Requires `playwright install chromium`.
        command: 'playwright test --config tests/integration/playwright.config.ts',
        input: [
          { auto: true },
          { pattern: 'tests/integration/**', base: 'workspace' },
          { pattern: 'packages/test/src/integration/**', base: 'workspace' },
          { pattern: 'packages/core/src/**', base: 'workspace' },
          { pattern: 'packages/server/src/**', base: 'workspace' },
          { pattern: 'packages/compiler/src/**', base: 'workspace' },
          { pattern: 'packages/browser/src/**', base: 'workspace' },
        ],
      },
      'conformance-drizzle': {
        command: 'vitest --run conformance/drizzle-pin/src/',
        input: [
          { auto: true },
          { pattern: 'conformance/drizzle-pin/src/**/*.ts', base: 'workspace' },
          { pattern: 'packages/drizzle/src/**/*.ts', base: 'workspace' },
        ],
      },
      conformance: {
        command:
          'pnpm --filter @kovojs/conformance-drizzle-pin test && pnpm --filter @kovojs/conformance-better-auth-pin test && pnpm --filter @kovojs/conformance-auth-spike test && pnpm --filter @kovojs/conformance-webhook-spike test && pnpm --filter @kovojs/conformance-app-shell-spike test',
        input: [
          { auto: true },
          { pattern: 'conformance/**/package.json', base: 'workspace' },
          { pattern: 'conformance/**/src/**/*.ts', base: 'workspace' },
          { pattern: 'conformance/**/docs/**', base: 'workspace' },
          { pattern: 'packages/core/src/**/*.ts', base: 'workspace' },
          { pattern: 'packages/server/src/**/*.ts', base: 'workspace' },
          { pattern: 'packages/drizzle/src/**/*.ts', base: 'workspace' },
          { pattern: 'packages/better-auth/src/**/*.ts', base: 'workspace' },
        ],
      },
      'typecheck-examples': {
        command:
          'tsc -p examples/commerce/tsconfig.json --noEmit && tsc -p examples/stackoverflow/tsconfig.json --noEmit && tsc -p examples/crm/tsconfig.json --noEmit && tsc -p examples/reference/tsconfig.json --noEmit && tsc -p conformance/drizzle-pin/tsconfig.json --noEmit && tsc -p conformance/better-auth-pin/tsconfig.json --noEmit && tsc -p conformance/auth-spike/tsconfig.json --noEmit && tsc -p conformance/webhook-spike/tsconfig.json --noEmit && tsc -p conformance/app-shell-spike/tsconfig.json --noEmit',
        input: [
          { auto: true },
          { pattern: 'examples/commerce/package.json', base: 'workspace' },
          { pattern: 'examples/commerce/tsconfig.json', base: 'workspace' },
          { pattern: 'examples/commerce/vite.config.ts', base: 'workspace' },
          { pattern: 'examples/commerce/src/**/*.ts', base: 'workspace' },
          { pattern: 'examples/stackoverflow/package.json', base: 'workspace' },
          { pattern: 'examples/stackoverflow/tsconfig.json', base: 'workspace' },
          { pattern: 'examples/stackoverflow/src/**/*.ts', base: 'workspace' },
          { pattern: 'examples/crm/package.json', base: 'workspace' },
          { pattern: 'examples/crm/tsconfig.json', base: 'workspace' },
          { pattern: 'examples/crm/src/**/*.ts', base: 'workspace' },
          { pattern: 'examples/reference/package.json', base: 'workspace' },
          { pattern: 'examples/reference/tsconfig.json', base: 'workspace' },
          { pattern: 'examples/reference/src/**/*.ts', base: 'workspace' },
          { pattern: 'conformance/**/package.json', base: 'workspace' },
          { pattern: 'conformance/**/tsconfig.json', base: 'workspace' },
          { pattern: 'conformance/**/src/**/*.ts', base: 'workspace' },
          { pattern: 'packages/*/package.json', base: 'workspace' },
          { pattern: 'packages/**/src/**/*.ts', base: 'workspace' },
          { pattern: 'tsconfig.json', base: 'workspace' },
        ],
      },
      'kovo-check': {
        command: 'node scripts/kovo-check.mjs',
        input: [
          { auto: true },
          { pattern: 'SPEC.md', base: 'workspace' },
          { pattern: 'AGENTS.md', base: 'workspace' },
          { pattern: '.github/workflows/ci.yml', base: 'workspace' },
          { pattern: 'docs/**', base: 'workspace' },
          { pattern: 'examples/commerce/package.json', base: 'workspace' },
          { pattern: 'examples/commerce/scripts/**', base: 'workspace' },
          { pattern: 'examples/commerce/src/**', base: 'workspace' },
          { pattern: 'fixtures/wire/**', base: 'workspace' },
          { pattern: 'package.json', base: 'workspace' },
          { pattern: 'packages/*/package.json', base: 'workspace' },
          { pattern: 'packages/**/src/**', base: 'workspace' },
          { pattern: 'pnpm-lock.yaml', base: 'workspace' },
          { pattern: 'scripts/kovo-check.mjs', base: 'workspace' },
          { pattern: 'scripts/commerce-graph.mjs', base: 'workspace' },
          { pattern: 'tests/kovo-check.node.mjs', base: 'workspace' },
          { pattern: 'tests/browser-acceptance.mjs', base: 'workspace' },
          { pattern: 'tests/p10-perf.node.mjs', base: 'workspace' },
          { pattern: 'tests/compiler-determinism.test.ts', base: 'workspace' },
          { pattern: 'tests/compiler-determinism-worker.mjs', base: 'workspace' },
          { pattern: 'tests/compiler-perf.test.ts', base: 'workspace' },
          { pattern: 'tests/compiler-perf-corpora.ts', base: 'workspace' },
          { pattern: 'tests/compiler-perf.budgets.json', base: 'workspace' },
          { pattern: 'vite.config.ts', base: 'workspace' },
          { pattern: 'vitest.browser.config.ts', base: 'workspace' },
        ],
      },
    },
  },
  staged: {
    '*.{js,jsx,ts,tsx,json,md,yml,yaml}': 'vp check --fix',
  },
  test: {
    // Several example suites spawn real builds / dev + HTTP servers or run the
    // ts-morph project extractor (Drizzle examples). Under the full suite's
    // parallelism these run well past Vitest's 5s default; give them headroom.
    // (Per-test overrides still apply for the heaviest cold-build cases.)
    hookTimeout: 30_000,
    testTimeout: 30_000,
    globalSetup: [exampleGeneratedGraphsGlobalSetup],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/*.browser.test.ts',
      // The framework-owned integration specs use @playwright/test, not vitest;
      // they run under their own gate (`vp run integration`).
      'tests/integration/**',
      'packages/create-kovo/templates/**/*.test.ts',
      // Conformance suites run in their own gate (`test:conformance` → `vp run conformance`,
      // per-package cwd). The root unit pool runs from the repo root, where project-mode ts-morph
      // type resolution differs; conformance is covered by its dedicated gate, not double-run here.
      'conformance/**',
    ],
  },
  pack: {
    entry: [
      'packages/*/src/index.ts',
      'packages/compiler/src/internal.ts',
      'packages/compiler/src/vite-config.ts',
      'packages/core/src/generated.ts',
      'packages/core/src/internal/component-render.ts',
      'packages/core/src/internal/derivation.ts',
      'packages/core/src/internal/diagnostics.ts',
      'packages/core/src/internal/event.ts',
      'packages/core/src/internal/fragment-target.ts',
      'packages/core/src/internal/graph.ts',
      'packages/core/src/internal/package-prefix.ts',
      'packages/core/src/internal/query-delta.ts',
      'packages/core/src/internal/storage.ts',
      'packages/browser/src/client.ts',
      'packages/browser/src/generated.ts',
      'packages/browser/src/internal/delegation.ts',
      'packages/browser/src/internal/inline-loader.ts',
      'packages/browser/src/internal/morph.ts',
      'packages/browser/src/internal/mutation.ts',
      'packages/server/src/api/app-shell/*.ts',
      'packages/server/src/internal/execution.ts',
      'packages/server/src/internal/html.ts',
      'packages/server/src/internal/route.ts',
      'packages/server/src/internal/wire.ts',
      'packages/test/src/harness.ts',
      'packages/test/src/verifier.ts',
    ],
    dts: true,
    deps: {
      neverBundle: ['typescript'],
    },
    clean: true,
  },
});
