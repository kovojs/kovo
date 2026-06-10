export interface CreateJisoOptions {
  name: string;
}

export interface GeneratedFile {
  path: string;
  source: string;
}

export interface CreateJisoProject {
  files: GeneratedFile[];
  name: string;
}

export function createJisoProject(options: CreateJisoOptions): CreateJisoProject {
  const packageName = normalizePackageName(options.name);

  return {
    files: [
      {
        path: 'package.json',
        source: `${JSON.stringify(
          {
            name: packageName,
            private: true,
            scripts: {
              check: 'vp check',
              dev: 'vp dev',
              test: 'vp test',
              'fw-check': 'vp run fw-check',
            },
            type: 'module',
          },
          null,
          2,
        )}\n`,
      },
      {
        path: 'vite.config.ts',
        source: `import { defineConfig } from 'vite-plus';

export default defineConfig({
  lint: {
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  fmt: {
    semi: true,
    singleQuote: true,
    sortPackageJson: true,
  },
  run: {
    tasks: {
      'fw-check': {
        command: 'fw check graph.json',
        input: [{ pattern: 'graph.json', base: 'workspace' }],
      },
    },
  },
});
`,
      },
      {
        path: '.github/workflows/ci.yml',
        source: `name: CI

on:
  pull_request:
  push:
    branches:
      - main

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: voidzero-dev/setup-vp@v1
        with:
          node-version: 24
      - run: vp install
      - run: vp check
      - run: vp test
      - run: vp run fw-check
`,
      },
      {
        path: 'graph.json',
        source: `${JSON.stringify({ optimistic: [], touchGraph: {} }, null, 2)}\n`,
      },
      {
        path: 'src/app.tsx',
        source: `import { component } from '@jiso/core';

export const App = component('app-root', {
  state: () => ({}),
  render: () => '<main>Hello from Jiso</main>',
});
`,
      },
    ],
    name: packageName,
  };
}

function normalizePackageName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-|-$/g, '');
}
