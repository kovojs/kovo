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
        command: 'vp pack',
        output: ['dist/**'],
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
      'fw-check': {
        command: 'node --test tests/fw-check.node.mjs',
        input: [
          { auto: true },
          { pattern: 'SPEC.md', base: 'workspace' },
          { pattern: 'IMPLEMENT_v1.md', base: 'workspace' },
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
    clean: true,
  },
});
