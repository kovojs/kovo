import { defineConfig } from 'vite-plus';

export default defineConfig({
  lint: {
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
          { pattern: 'packages/compiler/src/**', base: 'workspace' },
        ],
      },
      browser: {
        command: 'vitest --config vitest.browser.config.ts --run',
        input: [
          { auto: true },
          { pattern: 'vitest.browser.config.ts', base: 'workspace' },
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
        command: 'vitest --run conformance/drizzle-pin/src/index.test.ts',
        input: [
          { auto: true },
          { pattern: 'conformance/drizzle-pin/src/index.test.ts', base: 'workspace' },
          { pattern: 'packages/drizzle/src/**/*.ts', base: 'workspace' },
        ],
      },
      conformance: {
        command:
          'pnpm --filter @jiso/conformance-drizzle-pin test && pnpm --filter @jiso/conformance-auth-spike test && pnpm --filter @jiso/conformance-webhook-spike test && pnpm --filter @jiso/conformance-app-shell-spike test',
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
      'fw-check': {
        command: 'node scripts/fw-check.mjs',
        input: [
          { auto: true },
          { pattern: 'SPEC.md', base: 'workspace' },
          { pattern: 'IMPLEMENT_v1.md', base: 'workspace' },
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
    exclude: ['**/node_modules/**', '**/dist/**', '**/*.browser.test.ts'],
  },
  pack: {
    entry: ['packages/*/src/index.ts'],
    dts: true,
    deps: {
      neverBundle: ['typescript'],
    },
    clean: true,
  },
});
