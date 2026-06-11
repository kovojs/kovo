#!/usr/bin/env node
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

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

export interface WriteJisoProjectResult {
  files: string[];
  name: string;
  root: string;
}

const starterGraph = {
  components: [
    { fragments: ['cart-badge'], name: 'CartBadge', queries: ['cart'] },
    { fragments: ['cart-panel'], name: 'CartPanel', queries: ['cart'] },
  ],
  mutations: [
    {
      guards: ['authed'],
      invalidates: ['cart'],
      inputFields: ['productId', 'quantity'],
      key: 'cart/add',
      session: 'starterSession',
      writes: ['cart'],
    },
  ],
  optimistic: [{ mutation: 'cart/add', query: 'cart', status: 'await-fragment' }],
  pages: [
    {
      i18n: ['en-US:cartTitle'],
      meta: {
        description: 'Starter cart backed by query data.',
        title: 'Jiso Starter Cart',
      },
      queries: ['cart'],
      route: '/cart',
      stylesheets: ['/src/styles.css'],
    },
  ],
  queries: [{ domains: ['cart'], query: 'cart' }],
  touchGraph: {
    'cart.addItem': {
      touches: [{ domain: 'cart', keys: null, site: 'src/cart.ts:12', via: 'cart_items' }],
      unresolved: [],
    },
  },
};

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
              '@jiso/runtime': 'workspace:*',
            },
            devDependencies: {
              '@jiso/compiler': 'workspace:*',
              '@tailwindcss/vite': '^4.1.0',
              '@typescript/native-preview': '^7.0.0-dev.20260610.1',
              fw: 'workspace:*',
              tailwindcss: '^4.1.0',
              typescript: '^6.0.0',
              'vite-plus': '^0.1.24',
              vitest: '^4.1.8',
            },
            private: true,
            scripts: {
              check: 'vp check',
              dev: 'vp dev',
              'emit-graph': 'node scripts/emit-graph.mjs',
              test: 'vp test',
              'fw-check': 'vp run fw-check',
              'graph-assertions': 'vp run graph-assertions',
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
      build: {
        command: 'vp build',
        input: [
          { pattern: 'index.html', base: 'workspace' },
          { pattern: 'src/**/*', base: 'workspace' },
          { pattern: 'vite.config.ts', base: 'workspace' },
        ],
        output: ['dist/**'],
      },
      'fw-check': {
        command: 'node scripts/emit-graph.mjs && fw check graph.json',
        input: [
          { pattern: 'scripts/emit-graph.mjs', base: 'workspace' },
          { pattern: 'src/**/*', base: 'workspace' },
        ],
        output: ['graph.json'],
      },
      'graph-assertions': {
        command: 'node scripts/emit-graph.mjs && node scripts/graph-assertions.mjs',
        input: [
          { pattern: 'graph.json', base: 'workspace' },
          { pattern: 'scripts/emit-graph.mjs', base: 'workspace' },
          { pattern: 'scripts/graph-assertions.mjs', base: 'workspace' },
          { pattern: 'src/**/*', base: 'workspace' },
        ],
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
      - run: vp run build
      - run: vp run fw-check
      - run: vp run graph-assertions
`,
      },
      {
        path: 'README.md',
        source: `# Jiso Starter

This starter uses Vite+ as the single project entrypoint:

\`\`\`sh
vp check
vp test
vp run build
vp run emit-graph
vp run fw-check
vp run graph-assertions
\`\`\`

Tailwind is the default app styling path. Keep class names in templates as static strings so the generated CSS contains every class that can appear in SSR pages, mutation fragments, and deferred streams. Safelist classes explicitly with \`@source inline("...")\` in \`src/styles.css\` when a fragment must emit a class that cannot be discovered statically.
`,
      },
      {
        path: 'graph.json',
        source: `${JSON.stringify(starterGraph, null, 2)}\n`,
      },
      {
        path: 'scripts/emit-graph.mjs',
        source: `import { writeFileSync } from 'node:fs';
import { deriveAppGraph } from '@jiso/compiler';

const graphDeclarations = ${JSON.stringify(starterGraph, null, 2)};

const { graph } = deriveAppGraph({ graph: graphDeclarations });
writeFileSync(new URL('../graph.json', import.meta.url), \`\${JSON.stringify(graph, null, 2)}\\n\`);
process.stdout.write('emit-graph/v1\\nOK\\n');
`,
      },
      {
        path: 'scripts/graph-assertions.mjs',
        source: `import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

function fwExplain(args) {
  return execFileSync('fw', ['explain', ...args, 'graph.json'], { encoding: 'utf8' });
}

function explainLine(output, prefix) {
  const line = output.split('\\n').find((item) => item.startsWith(prefix));
  assert.ok(line, \`Missing fw explain line: \${prefix}\`);
  return line.slice(prefix.length);
}

function explainList(value) {
  return value === '-' ? [] : value.split(',').filter(Boolean);
}

const cartQuery = fwExplain(['query', 'cart']);
const cartConsumers = explainList(explainLine(cartQuery, 'consumers: ')).filter((consumer) =>
  consumer.startsWith('component:'),
);

assert.deepEqual(cartConsumers.sort(), ['component:CartBadge', 'component:CartPanel']);
assert.match(explainLine(cartQuery, 'invalidated-by: '), /(^|,)cart\\/add(,|$)/);
assert.match(explainLine(cartQuery, 'domain-writes: '), /(^|,)cart\\.addItem(,|$)/);

const cartAdd = fwExplain(['mutation', 'cart/add', '--optimistic']);
assert.equal(explainLine(cartAdd, 'session: '), 'starterSession');
assert.deepEqual(explainList(explainLine(cartAdd, 'input-fields: ')), ['productId', 'quantity']);
assert.match(cartAdd, /^updates: cart->component:CartBadge,component:CartPanel,page:\\/cart$/m);
assert.match(cartAdd, /^OPTIMISTIC cart await-fragment$/m);
assert.match(cartAdd, /^OPTIMISTIC-SUMMARY .*UNHANDLED=0$/m);

const cartPage = fwExplain(['page', '/cart']);
assert.equal(explainLine(cartPage, 'prefetch: '), 'false');
assert.match(explainLine(cartPage, 'meta: '), /title=Jiso Starter Cart/);
assert.deepEqual(explainList(explainLine(cartPage, 'i18n: ')), ['en-US:cartTitle']);
assert.deepEqual(explainList(explainLine(cartPage, 'modulepreloads: ')), []);
assert.deepEqual(explainList(explainLine(cartPage, 'stylesheets: ')), ['/src/styles.css']);
assert.deepEqual(explainList(explainLine(cartPage, 'queries: ')), ['cart']);

process.stdout.write('graph-assertions/v1\\nOK\\n');
`,
      },
      {
        path: 'docs/graph-assertions.md',
        source: `# Graph Assertion Recipes

Jiso keeps application wiring auditable through the generated graph file consumed by the CLI:

\`\`\`sh
vp run emit-graph
vp run fw-check
vp run graph-assertions
fw explain component CartBadge graph.json
fw explain mutation cart/add --optimistic graph.json
fw explain --unguarded graph.json
fw explain query cart graph.json
fw explain page /cart graph.json
\`\`\`

Use \`fw check graph.json\` in CI for semantic checks that do not belong in \`vp check\`: optimistic coverage (\`FW310\`), touch-graph consistency, unguarded mutation audits, manual invalidation review, and Jiso-specific lints.
Use \`fw explain --unguarded graph.json\` when you need the stable, diffable audit list from SPEC.md section 10.3.
When debugging enhanced mutations, keep the wire contract from SPEC.md section 9.1 visible: \`FW-Idem\` keys make duplicate POSTs replayable, and \`FW-Targets\` shows which live DOM dependencies asked for fragments.

## Intent Assertions

SPEC.md section 11.4.3 treats behavior checks as graph queries over stable \`fw explain\` output. Keep these assertions in CI beside ordinary tests when a product rule matters more than one rendered page snapshot.
This starter wires the minimal cart assertions into \`vp run graph-assertions\` and GitHub Actions; extend \`scripts/graph-assertions.mjs\` as product rules become important.

This starter's \`scripts/emit-graph.mjs\` is the tiny runnable graph-emission path. Keep app facts flowing through \`deriveAppGraph\`; as your app grows, replace the inline declarations with compiler-emitted component/query/route facts before writing \`graph.json\`.

Assert that every component displaying cart data is registered as a cart consumer:

\`\`\`sh
mkdir -p .jiso
fw explain query cart graph.json > .jiso/cart.query.txt
awk -F': ' '/^consumers: / { print $2 }' .jiso/cart.query.txt | tr ',' '\\n' | grep '^component:' | sort > .jiso/cart.consumers.txt
printf '%s\\n' component:CartBadge component:CartPanel | sort > .jiso/cart.expected-consumers.txt
diff -u .jiso/cart.expected-consumers.txt .jiso/cart.consumers.txt
\`\`\`

Assert that \`cart/add\` refreshes those consumers by invalidating the cart query:

\`\`\`sh
grep '^invalidated-by: .*cart/add' .jiso/cart.query.txt
grep '^domain-writes: .*cart.addItem' .jiso/cart.query.txt
fw explain mutation cart/add --optimistic graph.json | grep '^OPTIMISTIC cart await-fragment'
\`\`\`

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
- Use Tailwind as the default app styling path. Keep class names statically discoverable or safelisted with \`@source inline("...")\` so SSR pages, mutation fragments, and deferred streams never reference missing CSS.
- Route writes through domain functions. Direct database access in mutation handlers is a framework lint because invalidation and verification depend on the domain graph.
- The v1 server is stateless. Liveness comes from BroadcastChannel rebroadcast and refetch-on-focus/visibility, not Redis, SSE, or a live bus.
- Unguarded mutation review should use \`fw explain --unguarded graph.json\` as the stable audit path.
- Enhanced mutations must preserve the SPEC.md section 9.1 wire contract: \`FW-Idem\` replay for duplicate submissions, readable \`FW-Fragment\`/\`FW-Targets\` headers, and HTML/\`<fw-query>\` responses in the Network panel.
- Every mutation/query pair should have an explicit optimistic status: \`hand-written\`, \`await-fragment\`, or temporarily \`UNHANDLED\` while developing.
`,
      },
      {
        path: 'src/styles.css',
        source: `@import "tailwindcss";

@source "../index.html";
@source "./**/*.{ts,tsx,html}";
@source inline("bg-emerald-50 text-emerald-700 border-emerald-200 bg-amber-50 text-amber-700 border-amber-200");

@theme {
  --color-jiso-ink: #17202a;
  --color-jiso-accent: #0f8b8d;
}
`,
      },
      {
        path: 'src/client.ts',
        source: `import {
  applyDeferredStreamResponseToDom,
  createQueryStore,
  installJisoLoader,
} from '@jiso/runtime';

const store = createQueryStore();
const queryPlans = {};

type DeferredStreamOptions = {
  boundary?: string;
  morph?: Parameters<typeof applyDeferredStreamResponseToDom>[0]['morph'];
  root?: Parameters<typeof applyDeferredStreamResponseToDom>[0]['root'];
};

installJisoLoader({
  importModule: (specifier) => import(specifier),
  root: document,
  queryStore: store,
  enhancedMutations: {
    fetch: (url, options) => fetch(url, options),
    queryPlans,
    root: document,
    store,
  },
});

export function applyJisoDeferredStreamResponse(
  body: string,
  options: DeferredStreamOptions = {},
) {
  return applyDeferredStreamResponseToDom({
    body,
    ...(options.boundary ? { boundary: options.boundary } : {}),
    ...(options.morph ? { morph: options.morph } : {}),
    queryPlans,
    root: options.root ?? document,
    store,
  });
}
`,
      },
      {
        path: 'index.html',
        source: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="stylesheet" href="/src/styles.css" />
    <script type="module" src="/src/client.ts"></script>
    <title>Jiso Starter</title>
  </head>
  <body>
    <main class="mx-auto grid min-h-dvh max-w-3xl place-items-center px-6 text-jiso-ink">
      <h1 class="text-3xl font-semibold tracking-normal text-jiso-accent">Hello from Jiso</h1>
    </main>
  </body>
</html>
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
        source: `import { readFileSync } from 'node:fs';

import { assertFixpoint, assertRenderEquivalence, compileComponentModule } from '@jiso/compiler';
import { describe, expect, it } from 'vitest';

describe('compiler fixpoint', () => {
  it('keeps the starter component lowering authorable', () => {
    // SPEC.md section 5.2 requires generated starters to enforce the compiler fixpoint.
    const result = compileComponentModule({
      fileName: 'src/app.tsx',
      source: readFileSync(new URL('./app.tsx', import.meta.url), 'utf8'),
    });

    expect(() => assertFixpoint(result)).not.toThrow();
    expect(() => assertRenderEquivalence(result)).not.toThrow();
  });
});
`,
      },
    ],
    name: packageName,
  };
}

export function writeJisoProject(
  targetDirectory: string,
  options: Partial<CreateJisoOptions> = {},
): WriteJisoProjectResult {
  const root = resolve(targetDirectory);
  const name = options.name ?? basename(root);
  const project = createJisoProject({ name });

  assertWritableTarget(root);

  for (const file of project.files) {
    const destination = resolve(root, file.path);

    const relativeDestination = relative(root, destination);

    if (
      relativeDestination === '' ||
      relativeDestination.startsWith('..') ||
      isAbsolute(relativeDestination)
    ) {
      throw new Error(`Refusing to write outside target directory: ${file.path}`);
    }

    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, file.source, 'utf8');
  }

  return {
    files: project.files.map((file) => file.path),
    name: project.name,
    root,
  };
}

export function main(args: readonly string[] = process.argv.slice(2)): number {
  const [targetDirectory, ...rest] = args;

  if (!targetDirectory || targetDirectory === '--help' || targetDirectory === '-h') {
    process.stdout.write('usage: create-jiso <target-directory> [--name <package-name>]\n');
    return targetDirectory ? 0 : 1;
  }

  const name = readNameOption(rest);

  try {
    const result = writeJisoProject(targetDirectory, name ? { name } : {});
    process.stdout.write(`create-jiso: wrote ${result.files.length} files to ${result.root}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(
      `create-jiso: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 1;
  }
}

function normalizePackageName(name: string): string {
  const normalized = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-|-$/g, '');

  return normalized || 'jiso-app';
}

function assertWritableTarget(root: string): void {
  if (!existsSync(root)) {
    return;
  }

  const stats = statSync(root);

  if (!stats.isDirectory()) {
    throw new Error(`Target exists and is not a directory: ${root}`);
  }

  const existingEntries = readdirSync(root);

  if (existingEntries.length > 0) {
    throw new Error(`Target directory is not empty: ${root}`);
  }
}

function readNameOption(args: readonly string[]): string | undefined {
  let name: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) continue;

    if (arg === '--name') {
      name = args[index + 1];
      index += 1;
      continue;
    }

    if (arg.startsWith('--name=')) {
      name = arg.slice('--name='.length);
    }
  }

  return name;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main();
}
