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
  pack: {
    entry: ['packages/*/src/index.ts'],
    dts: true,
    clean: true,
  },
});
