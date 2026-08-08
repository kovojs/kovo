#!/usr/bin/env node
/**
 * Realistic-tier perf workload generator (plans/good-perf.md O17 / decision D13).
 *
 * The DevEx budget tier is calibrated on `scripts/devex-workloads/kovo-packed-check/package` —
 * 4 files / 56 LOC / 1 route. Nothing that scales with app size is observable there, which is why
 * the quadratic `kovo check` term (O7) and the KV448 import wall (O7) both shipped undetected. This
 * generator materializes an app whose module count is a parameter, so the O(app size) behaviour is
 * the thing being measured.
 *
 * Shape: a fan-out-8 component tree of `componentCount` modules rooted at `src/components/c-0.tsx`,
 * plus `src/app.tsx`, `src/kovo.ts`, a real `tsconfig.json` (so the TypeScript phase executes) and a
 * `kovo.config.ts` naming the node preset with the SPEC §14 retention floor. Framework packages are
 * symlinked out of the repo checkout, so the workload always measures the working tree.
 */
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const PERF_WORKLOAD_FAN_OUT = 8;
const LINKED_PACKAGES = Object.freeze([
  'browser',
  'cli',
  'compiler',
  'core',
  'server',
  'style',
  'ui',
]);

/** Deterministic RFC 4122 v4-shaped appId so two materializations of the same N are identical. */
export function perfWorkloadAppId(componentCount) {
  const digits = String(componentCount).padStart(12, '0');
  return `4b0f9c11-0000-4000-8000-${digits}`;
}

export function perfWorkloadChildren(index, componentCount) {
  const children = [];
  for (let slot = 1; slot <= PERF_WORKLOAD_FAN_OUT; slot += 1) {
    const child = index * PERF_WORKLOAD_FAN_OUT + slot;
    if (child < componentCount) children.push(child);
  }
  return children;
}

/**
 * The interactive leaf. An app with zero L1 interactions is INERT: it ships no inline bootstrap and
 * no runtime (O10/D7), so the inline-bootstrap and enhanced-navigation byte metrics have nothing to
 * measure. The realistic tier therefore always carries exactly one interactive component.
 */
export const PERF_WORKLOAD_INTERACTIVE_SOURCE = `/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import { s } from '@kovojs/server';

import { app } from '../kovo.js';

export const interactiveQuery = app.query({
  access: app.publicAccess('perf realistic-tier interaction query'),
  load: () => ({ label: 'ready' }),
  output: s.object({ label: s.string() }),
});

export const InteractiveLeaf = component({
  queries: { interactive: interactiveQuery },
  state: () => ({ count: 0 }),
  render: ({ interactive }: { interactive: { label: string } }, state: { count: number }) => (
    <button
      aria-label="perf workload interaction"
      type="button"
      onClick={() => {
        state.count += 1;
      }}
    >
      {interactive.label} {state.count}
    </button>
  ),
});
`;

export function perfWorkloadComponentSource(index, componentCount, options = {}) {
  const children = perfWorkloadChildren(index, componentCount);
  const interactive = options.interactive === true && index === 0;
  const imports = [
    ...(interactive ? ["import { InteractiveLeaf } from './interactive-leaf.js';"] : []),
    ...children.map((child) => `import { C${String(child)} } from './c-${String(child)}.js';`),
  ].join('\n');
  const rendered = [
    ...(interactive ? ['      <InteractiveLeaf />'] : []),
    ...children.map((child) => `      <C${String(child)} />`),
  ].join('\n');
  return `/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
${imports}${imports === '' ? '' : '\n'}
export const componentRevision${String(index)} = 0;

export const C${String(index)} = component({
  render: () => (
    <section class="perf-node perf-node-${String(index)}">
      <h2>node ${String(index)}</h2>
      <p>depth marker ${String(index)} of ${String(componentCount)}</p>
${rendered}${rendered === '' ? '' : '\n'}    </section>
  ),
});
`;
}

function appSource(componentCount, interactive) {
  return `/** @jsxImportSource @kovojs/server */
import { stylesheet } from '@kovojs/server';
// One UI component, so the O4 import-graph pruner has something to prune the catalog down TO.
// Do not name the UI package anywhere else in this module: the pruner compares recognized import
// specifiers against a TEXTUAL occurrence count of the package name, so a mention in a comment or
// string reads as unprovable dynamic usage and the build falls back to the full 122 KB catalog
// (plans/good-perf.md O4).
import { Badge } from '@kovojs/ui/badge';

import { C0 } from './components/c-0.js';${
    interactive ? "\nimport { interactiveQuery } from './components/interactive-leaf.js';" : ''
  }
import { app } from './kovo.js';

// Declaring a stylesheet is what puts a <link rel=stylesheet> in the head, and the emitted sheet is
// what O4 pruned from the whole component catalog down to the import graph. Without this the
// critical-path byte gate is document-only and a return of the 122 KB full-catalog sheet would be
// invisible to it (plans/good-perf.md O4).
const workloadStylesheets = [stylesheet('./styles.css')];

const home = app.route('/', {
  access: app.publicAccess('perf realistic-tier workload'),
  page: () => (
    <main>
      <h1>Kovo perf workload (${String(componentCount)} components)</h1>
      <Badge variant="success">realistic tier</Badge>
      <C0 />
    </main>
  ),
  stylesheets: workloadStylesheets,
});

export default app.assemble({
  queries: [${interactive ? 'interactiveQuery' : ''}],
  routes: [home],
});
`;
}

function kovoSource(componentCount) {
  return `import { defineKovo } from '@kovojs/server';

/** Perf realistic-tier workload declaration contract (SPEC §6.2.1). */
export const app = defineKovo({
  appId: '${perfWorkloadAppId(componentCount)}',
});
`;
}

/**
 * Materialize the workload under `root`. Returns the paths a runner needs.
 *
 * @param {{ componentCount: number, interactive?: boolean, repoRoot: string, root: string }} options
 */
export function materializePerfWorkload({ componentCount, interactive = true, repoRoot, root }) {
  if (!Number.isInteger(componentCount) || componentCount < 1) {
    throw new TypeError('perf workload componentCount must be a positive integer');
  }
  rmSync(root, { force: true, recursive: true });
  mkdirSync(path.join(root, 'src/components'), { recursive: true });
  mkdirSync(path.join(root, 'node_modules/@kovojs'), { recursive: true });

  for (const name of LINKED_PACKAGES) {
    symlinkSync(
      path.join(repoRoot, 'packages', name),
      path.join(root, 'node_modules/@kovojs', name),
    );
  }
  // The TypeScript preflight resolves `typescript/bin/tsc` from the app root, so the workload has to
  // present the checkout's own pinned compiler rather than whatever is globally installed.
  symlinkSync(
    path.join(repoRoot, 'node_modules/typescript'),
    path.join(root, 'node_modules/typescript'),
  );
  mkdirSync(path.join(root, 'node_modules/@types'), { recursive: true });
  symlinkSync(
    path.join(repoRoot, 'node_modules/@types/node'),
    path.join(root, 'node_modules/@types/node'),
  );

  for (let index = 0; index < componentCount; index += 1) {
    writeFileSync(
      path.join(root, `src/components/c-${String(index)}.tsx`),
      perfWorkloadComponentSource(index, componentCount, { interactive }),
      'utf8',
    );
  }
  if (interactive) {
    writeFileSync(
      path.join(root, 'src/components/interactive-leaf.tsx'),
      PERF_WORKLOAD_INTERACTIVE_SOURCE,
      'utf8',
    );
  }
  writeFileSync(path.join(root, 'src/app.tsx'), appSource(componentCount, interactive), 'utf8');
  writeFileSync(path.join(root, 'src/kovo.ts'), kovoSource(componentCount), 'utf8');
  writeFileSync(path.join(root, 'src/client.ts'), 'export const client = true;\n', 'utf8');
  writeFileSync(
    path.join(root, 'src/styles.css'),
    '.perf-node{margin-block:4px}\n.perf-node h2{font-weight:600}\n',
    'utf8',
  );
  writeFileSync(
    path.join(root, 'index.html'),
    '<!doctype html><html><body><script type="module" src="/src/client.ts"></script></body></html>\n',
    'utf8',
  );
  writeFileSync(
    path.join(root, 'kovo.config.ts'),
    `import { defineConfig, node } from '@kovojs/server/build';

export default defineConfig({
  preset: node({
    retention: {
      hours: 24,
      immutableClientModules: 'retained',
      priorTokenQueryReads: 'retained',
    },
  }),
});
`,
    'utf8',
  );
  writeFileSync(
    path.join(root, 'package.json'),
    `${JSON.stringify(
      {
        dependencies: {
          '@kovojs/browser': 'workspace:*',
          '@kovojs/core': 'workspace:*',
          '@kovojs/server': 'workspace:*',
        },
        name: '@kovojs/perf-realistic-workload',
        private: true,
        type: 'module',
        version: '1.0.0',
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  writeFileSync(
    path.join(root, 'tsconfig.json'),
    `${JSON.stringify(
      {
        compilerOptions: {
          allowImportingTsExtensions: true,
          jsx: 'react-jsx',
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          noEmit: true,
          skipLibCheck: true,
          strict: true,
          target: 'ES2024',
          types: ['node'],
        },
        include: ['src/**/*.ts', 'src/**/*.tsx'],
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  return {
    appModulePath: path.join(root, 'src/app.tsx'),
    componentCount,
    // The leaf the edit-loop suites mutate: highest index, so it is a real dependency of nothing.
    editTargetPath: path.join(root, `src/components/c-${String(componentCount - 1)}.tsx`),
    fileCount: componentCount + 3 + (interactive ? 1 : 0),
    interactive,
    root,
  };
}

/** Rewrite the edit target so a dev/check run observes a genuine content change. */
export function perfWorkloadEditedComponent(index, componentCount, revision, options = {}) {
  return perfWorkloadComponentSource(index, componentCount, options).replace(
    `export const componentRevision${String(index)} = 0;`,
    `export const componentRevision${String(index)} = ${String(revision)};`,
  );
}
