import { defineConfig } from 'vite-plus';

export default defineConfig({
  lint: {
    // site/tutorial/steps/*/src/generated holds compiler-emitted IR pinned
    // byte-identical to @jiso/compiler output; lint governs authored code.
    ignorePatterns: ['packages/create-jiso/templates/**', 'site/tutorial/steps/*/src/generated/**'],
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  fmt: {
    // examples/commerce/src/generated and the tutorial step generated dirs
    // hold compiler-emitted IR that must stay byte-identical to
    // @jiso/compiler output (SPEC.md section 5.2.3 staleness and fixpoint
    // pins), so the formatter must not rewrite them.
    ignorePatterns: [
      'dist/**',
      'coverage/**',
      'node_modules/**',
      'examples/commerce/src/generated/**',
      'site/tutorial/steps/*/src/generated/**',
    ],
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
          { pattern: 'packages/runtime/src/**/*.browser.test.ts', base: 'workspace' },
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
          'pnpm --filter @jiso/conformance-drizzle-pin test && pnpm --filter @jiso/conformance-better-auth-pin test && pnpm --filter @jiso/conformance-auth-spike test && pnpm --filter @jiso/conformance-webhook-spike test && pnpm --filter @jiso/conformance-app-shell-spike test',
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
          'tsc -p examples/commerce/tsconfig.json --noEmit && tsc -p examples/reference/tsconfig.json --noEmit && tsc -p conformance/drizzle-pin/tsconfig.json --noEmit && tsc -p conformance/better-auth-pin/tsconfig.json --noEmit && tsc -p conformance/auth-spike/tsconfig.json --noEmit && tsc -p conformance/webhook-spike/tsconfig.json --noEmit && tsc -p conformance/app-shell-spike/tsconfig.json --noEmit',
        input: [
          { auto: true },
          { pattern: 'examples/commerce/package.json', base: 'workspace' },
          { pattern: 'examples/commerce/tsconfig.json', base: 'workspace' },
          { pattern: 'examples/commerce/vite.config.ts', base: 'workspace' },
          { pattern: 'examples/commerce/src/**/*.ts', base: 'workspace' },
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
      'fw-check': {
        command: 'node scripts/fw-check.mjs',
        input: [
          { auto: true },
          { pattern: 'SPEC.md', base: 'workspace' },
          { pattern: 'plans/v1-cleanup.md', base: 'workspace' },
          { pattern: 'AGENTS.md', base: 'workspace' },
          { pattern: '.github/workflows/ci.yml', base: 'workspace' },
          { pattern: 'docs/**', base: 'workspace' },
          { pattern: 'examples/commerce/package.json', base: 'workspace' },
          { pattern: 'examples/commerce/scripts/**', base: 'workspace' },
          { pattern: 'examples/commerce/src/**', base: 'workspace' },
          { pattern: 'examples/commerce/src/generated/graph.json', base: 'workspace' },
          { pattern: 'fixtures/wire/**', base: 'workspace' },
          { pattern: 'package.json', base: 'workspace' },
          { pattern: 'packages/*/package.json', base: 'workspace' },
          { pattern: 'packages/**/src/**', base: 'workspace' },
          { pattern: 'pnpm-lock.yaml', base: 'workspace' },
          { pattern: 'scripts/fw-check.mjs', base: 'workspace' },
          { pattern: 'tests/fw-check.node.mjs', base: 'workspace' },
          { pattern: 'tests/browser-acceptance.mjs', base: 'workspace' },
          { pattern: 'tests/p10-perf.node.mjs', base: 'workspace' },
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
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/*.browser.test.ts',
      'packages/create-jiso/templates/**/*.test.ts',
      // Conformance suites run in their own gate (`test:conformance` → `vp run conformance`,
      // per-package cwd). The root unit pool runs from the repo root, where project-mode ts-morph
      // type resolution differs; conformance is covered by its dedicated gate, not double-run here.
      'conformance/**',
    ],
  },
  pack: {
    entry: ['packages/*/src/index.ts', 'packages/server/src/api/app-shell/*.ts'],
    dts: true,
    deps: {
      neverBundle: ['typescript'],
    },
    clean: true,
  },
});
