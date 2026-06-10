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
            dependencies: {
              '@jiso/core': 'workspace:*',
            },
            devDependencies: {
              '@jiso/compiler': 'workspace:*',
              '@tailwindcss/vite': '^4.0.0',
              '@typescript/native-preview': '^7.0.0-dev.20260610.1',
              tailwindcss: '^4.0.0',
              typescript: '^6.0.0',
              'vite-plus': '^0.1.24',
              vitest: '^4.1.8',
            },
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
        source: `import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite-plus';

export default defineConfig({
  plugins: [tailwindcss()],
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
        path: 'docs/graph-assertions.md',
        source: `# Graph Assertion Recipes

Jiso keeps application wiring auditable through the generated graph file consumed by the CLI:

\`\`\`sh
vp run fw-check
fw explain component App graph.json
fw explain mutation cart/add --optimistic graph.json
fw explain --unguarded graph.json
fw explain query cart graph.json
fw explain page /cart graph.json
\`\`\`

Use \`fw check graph.json\` in CI for semantic checks that do not belong in \`vp check\`: optimistic coverage (\`FW310\`), touch-graph consistency, unguarded mutation audits, manual invalidation review, and Jiso-specific lints.
Use \`fw explain --unguarded graph.json\` when you need the stable, diffable audit list from SPEC.md section 10.3.

Keep every mutation/query pair explicit in \`graph.json\`:

\`\`\`json
{
  "optimistic": [
    { "mutation": "cart/add", "query": "cart", "status": "hand-written" },
    { "mutation": "cart/add", "query": "recommendations", "status": "await-fragment" }
  ],
  "touchGraph": {
    "cart.addItem": {
      "touches": [{ "domain": "cart", "keys": null, "site": "src/cart.ts:12", "via": "cart_items" }],
      "unresolved": []
    }
  }
}
\`\`\`

\`UNHANDLED\` optimistic entries are allowed while developing, but they produce \`FW310\` warnings and should be driven to zero before release.
`,
      },
      {
        path: 'docs/deployment.md',
        source: `# Deployment Notes

Jiso v1 keeps the application server stateless. Mutation responses are ordinary HTML fragments and \`<fw-query>\` payloads; the server answers each request from its inputs instead of retaining a session of what is currently on screen.

Per SPEC.md section 9.3, v1 liveness is intentionally limited to client-owned behaviors:

- BroadcastChannel rebroadcast shares a mutation's query response with the user's other open tabs.
- Refetch-on-focus/visibility re-runs stale queries when a backgrounded tab becomes active again.

No SSE or live bus ships in v1. SSE-backed \`<fw-live>\` subscriptions and live-bus infrastructure are v2 features, using the same fragment/query vocabulary as an additive transport.
`,
      },
      {
        path: 'docs/framework-rules.md',
        source: `# Framework Rules

\`SPEC.md\` is the source of truth for how Jiso works. Keep local conventions in this project aligned with the spec instead of inventing app-only behavior.

The v1 implementation depends on these hard rules:

- Generated output must remain authorable Jiso source, and the fixpoint test must stay in CI.
- Handler references, fragment targets, form fields, query bindings, guards, invalidations, and optimistic coverage are checked by TypeScript static checking plus \`fw check\`.
- \`data-bind\` paths must exist in declared query result shapes; column renames should fail static checks instead of becoming stale DOM.
- Use Tailwind as the default app styling path. Keep class names statically discoverable or safelisted so SSR pages, mutation fragments, and deferred streams never reference missing CSS.
- Route writes through domain functions. Direct database access in mutation handlers is a framework lint because invalidation and verification depend on the domain graph.
- The v1 server is stateless. Liveness comes from BroadcastChannel rebroadcast and refetch-on-focus/visibility, not Redis, SSE, or a live bus.
- Unguarded mutation review should use \`fw explain --unguarded graph.json\` as the stable audit path.
- Every mutation/query pair should have an explicit optimistic status: \`hand-written\`, \`await-fragment\`, or temporarily \`UNHANDLED\` while developing.
`,
      },
      {
        path: 'src/styles.css',
        source: `@import "tailwindcss";

@source "./**/*.{ts,tsx,html}";

@theme {
  --color-jiso-ink: #17202a;
  --color-jiso-accent: #0f8b8d;
}
`,
      },
      {
        path: 'src/app.tsx',
        source: `import { component } from '@jiso/core';
import './styles.css';

export const App = component('app-root', {
  state: () => ({}),
  render: () =>
    '<main class="mx-auto grid min-h-dvh max-w-3xl place-items-center px-6 text-jiso-ink"><h1 class="text-3xl font-semibold tracking-normal text-jiso-accent">Hello from Jiso</h1></main>',
});
`,
      },
      {
        path: 'src/app.fixpoint.test.ts',
        source: `import { assertFixpoint, compileComponentModule } from '@jiso/compiler';
import { describe, expect, it } from 'vitest';

describe('compiler fixpoint', () => {
  it('keeps the starter component lowering authorable', () => {
    // SPEC.md section 5.2 requires generated starters to enforce the compiler fixpoint.
    const result = compileComponentModule({
      fileName: 'src/app.tsx',
      source: [
        "import { component } from '@jiso/core';",
        '',
        "export const App = component('app-root', {",
        '  state: () => ({}),',
        "  render: () => '<main>Hello from Jiso</main>',",
        '});',
        '',
      ].join('\\n'),
    });

    expect(() => assertFixpoint(result)).not.toThrow();
  });
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
