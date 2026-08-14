#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEV_PORT_ALLOCATION_POSTURE } from '../harness/dev-port-allocation.mjs';

export { DEV_PORT_ALLOCATION_POSTURE } from '../harness/dev-port-allocation.mjs';

export const CORPUS_SCHEMA = 'kovo-dev-corpus/v1';
export const SUPPORTED_SIZES = Object.freeze([24, 216]);
export const EDIT_SAVE_POSTURE = 'posix-sibling-temp-write-rename/v1';
export const EDIT_STATE_POSTURE = 'refresh-surfaces-sibling-to-local-state/v1';
export const DEV_SESSION_PORT_STRIDE = 128;
export const EDIT_REFRESH_SURFACES = Object.freeze({
  data: Object.freeze({ file: 'src/data.tsx', selector: '[data-benchmark-data]' }),
  entry: Object.freeze({ file: 'src/page.tsx', selector: '[data-benchmark-entry]' }),
  leaf: Object.freeze({
    file: 'src/components/component-000.tsx',
    selector: '[data-module="000"]',
  }),
});

const CORPUS_OWNER_FILE = '.kovo-benchmark-corpus-owner.json';
const CORPUS_OWNER_SCHEMA = 'kovo-benchmark-corpus-owner/v1';

const corporaRoot = fileURLToPath(new URL('.', import.meta.url));
const benchmarkRoot = path.resolve(corporaRoot, '..');
const repoRoot = path.resolve(benchmarkRoot, '..');

export async function generateCorpora({ outDir, sizes = SUPPORTED_SIZES } = {}) {
  const resolvedOut = outDir === undefined ? undefined : path.resolve(outDir);
  if (resolvedOut !== undefined) assertSafeOutputRoot(resolvedOut);
  const normalizedSizes = [...new Set(sizes.map(validateSize))].sort((left, right) => left - right);
  const manifests = [];
  for (const size of normalizedSizes) {
    for (const framework of ['kovo', 'nextjs']) {
      // Keep runnable corpora below each entrant by default. Turbopack deliberately rejects a
      // project-local node_modules symlink that leaves its filesystem root, whereas placing the
      // temporary app below benchmarks/nextjs lets ordinary ancestor resolution find the real
      // install without a symlink. Kovo uses the same layout so the corpus topology stays matched.
      const frameworkOut = resolvedOut ?? path.join(benchmarkRoot, framework, '.corpora');
      manifests.push(await generateCorpus({ framework, outDir: frameworkOut, size }));
    }
  }
  return manifests;
}

export async function generateCorpus({ dependencyMode = 'auto', framework, outDir, size }) {
  if (framework !== 'kovo' && framework !== 'nextjs') {
    throw new TypeError(`Unsupported corpus framework ${String(framework)}.`);
  }
  const moduleCount = validateSize(size);
  const outputRoot = path.resolve(outDir);
  assertSafeOutputRoot(outputRoot);
  if (dependencyMode !== 'auto' && dependencyMode !== 'deferred') {
    throw new TypeError('Corpus dependency mode must be auto or deferred.');
  }
  const appRoot = path.join(outputRoot, framework, `n${moduleCount}`);
  if (!appRoot.startsWith(`${outputRoot}${path.sep}`))
    throw new TypeError('Corpus path escaped output root.');
  await prepareOwnedAppRoot({ appRoot, framework, modules: moduleCount });
  await mkdir(path.join(appRoot, 'src', 'components'), { recursive: true });

  const files = framework === 'kovo' ? kovoFiles(moduleCount) : nextFiles(moduleCount);
  for (const [relativePath, source] of Object.entries(files)) {
    const target = path.join(appRoot, relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, source);
  }

  const dependencyRoot =
    framework === 'kovo'
      ? path.join(benchmarkRoot, 'kovo', 'node_modules')
      : path.join(benchmarkRoot, 'nextjs', 'node_modules');
  const usesAncestorDependencies =
    dependencyMode === 'auto' && isPathWithin(path.dirname(dependencyRoot), appRoot);
  if (dependencyMode === 'auto' && !usesAncestorDependencies) {
    await symlink(dependencyRoot, path.join(appRoot, 'node_modules'), 'dir');
  }
  const bin = (name) =>
    usesAncestorDependencies
      ? path.relative(appRoot, path.join(dependencyRoot, '.bin', name))
      : path.join('node_modules', '.bin', name);

  const shape = corpusShape(moduleCount);
  const sourceFiles = sourceFileEvidence(files);
  const manifest = {
    approximateLoc: lineCount(files),
    build: buildContract(framework, bin),
    dev: devContract(framework, bin),
    framework,
    modules: moduleCount,
    routes: shape.routes,
    schema: CORPUS_SCHEMA,
    shapeDigest: digest(shape),
    sourceDigest: sha256(JSON.stringify(sourceFiles)),
    sourceFiles,
    workload: shape,
  };
  const manifestPath = path.join(appRoot, 'manifest.json');
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifestPath;
}

function buildContract(framework, bin) {
  return {
    command: {
      argv: framework === 'kovo' ? [bin('kovo'), 'build', './src/app.tsx'] : [bin('next'), 'build'],
      cwd: '.',
      env: {},
    },
    edit: {
      file: 'src/components/component-000.tsx',
      replacementTemplate: 'data-revision="build-{revision}"',
      search: 'data-revision="leaf-r0"',
    },
    outputs:
      framework === 'kovo'
        ? {
            absent: ['.kovo-build-stage-*'],
            requiredNonempty: ['.kovo', 'dist'],
          }
        : { absent: [], requiredNonempty: ['.next'] },
  };
}

function corpusShape(modules) {
  return {
    buildOutputContract: 'required-nonempty-and-cleanup-absent/v1',
    componentImportFanout: modules,
    devPortAllocationPosture: DEV_PORT_ALLOCATION_POSTURE,
    editClasses: ['leaf', 'entry', 'data', 'syntaxError', 'recovery'],
    editRefreshSurfaces: EDIT_REFRESH_SURFACES,
    editSavePosture: EDIT_SAVE_POSTURE,
    editStatePosture: EDIT_STATE_POSTURE,
    routes: 4,
    stateSurface: 'local-counter',
    workloadModules: modules,
  };
}

function devContract(framework, bin) {
  return {
    command: {
      argv:
        framework === 'kovo'
          ? [
              bin('kovo'),
              'dev',
              './src/app.tsx',
              '--host',
              'localhost',
              '--strict-port',
              '--port',
              '{port}',
            ]
          : [bin('next'), 'dev', '--hostname', 'localhost', '--port', '{port}'],
      cwd: '.',
      env: {},
    },
    edits: {
      data: {
        evidence: { expectedTemplate: 'data-{revision}', selector: '[data-benchmark-data]' },
        file: EDIT_REFRESH_SURFACES.data.file,
        replacementTemplate: "'data-{revision}'",
        search: "'data-r0'",
      },
      entry: {
        evidence: {
          attribute: 'data-entry-revision',
          expectedTemplate: 'entry-{revision}',
          selector: EDIT_REFRESH_SURFACES.entry.selector,
        },
        file: EDIT_REFRESH_SURFACES.entry.file,
        replacementTemplate: 'data-entry-revision="entry-{revision}"',
        search: 'data-entry-revision="entry-r0"',
      },
      leaf: {
        evidence: {
          attribute: 'data-revision',
          expectedTemplate: 'leaf-{revision}',
          selector: '[data-module="000"]',
        },
        file: EDIT_REFRESH_SURFACES.leaf.file,
        replacementTemplate: 'data-revision="leaf-{revision}"',
        search: 'data-revision="leaf-r0"',
      },
      recovery: {
        evidence: {
          attribute: 'data-revision',
          expectedTemplate: 'leaf-r0',
          selector: '[data-module="000"]',
        },
      },
      syntaxError: {
        evidence: { text: 'error' },
        file: 'src/components/component-000.tsx',
        replacement: 'data-revision={',
        search: 'data-revision="leaf-r0"',
      },
    },
    ready: {
      attribute: 'data-benchmark-ready',
      expected: 'true',
      path: '/',
      selector: 'main',
    },
    state: {
      property: 'textContent',
      selector: '[data-benchmark-state]',
      setup: { action: 'click' },
      value: 'Count 1',
    },
  };
}

function kovoFiles(size) {
  const componentImports = componentNames(size)
    .map((name, index) => `import { ${name} } from './components/component-${pad(index)}.js';`)
    .join('\n');
  const componentElements = componentNames(size)
    .map((name) => `      <${name} />`)
    .join('\n');
  const routeDefinitions = ['/', '/route-a', '/route-b', '/route-c']
    .map(
      (route, index) => `const route${index} = app.route('${route}', {
  access: app.publicAccess('generated equal-shape performance corpus'),
  page: () => <CorpusPage />,
});`,
    )
    .join('\n\n');
  return {
    'index.html': `<!doctype html>
<html lang="en-US">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Kovo equal-shape performance corpus</title>
  </head>
  <body></body>
</html>
`,
    'kovo.config.ts': `import { defineConfig, node } from '@kovojs/server/build';

// SPEC §14: one immutable benchmark build is served for the lifetime of each isolated run.
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
    'package.json': `${JSON.stringify({ name: `kovo-benchmark-corpus-${size}`, private: true, type: 'module' }, null, 2)}\n`,
    'src/app.tsx': `/** @jsxImportSource @kovojs/server */
import { app, benchmarkRefreshQuery } from './kovo.js';
import { CorpusPage } from './shell.js';

${routeDefinitions}

export default app.assemble({
  queries: [benchmarkRefreshQuery],
  routes: [${['0', '1', '2', '3'].map((value) => `route${value}`).join(', ')}],
});
`,
    'src/counter-island.tsx': `/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';

export const CounterIsland = component({
  state: () => ({ count: 0 }),
  render: (_queries: Record<string, never>, state: { count: number }) => (
    <button data-benchmark-state="true" type="button" onClick={() => { state.count += 1; }}>
      Count {state.count}
    </button>
  ),
});
`,
    'src/data.tsx': `/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';

import { benchmarkRefreshQuery } from './kovo.js';

export const benchmarkDataLabel = 'data-r0';

export const DataRefreshSurface = component({
  queries: { refresh: benchmarkRefreshQuery },
  render: ({ refresh }: { refresh: { label: string } }) => (
    <p
      data-benchmark-data="true"
      data-benchmark-surface="data"
      data-refresh-ready={refresh.label}
    >
      {benchmarkDataLabel}
    </p>
  ),
});
`,
    'src/kovo.ts': `import { defineKovo, s } from '@kovojs/server';

export const app = defineKovo({
  appId: '03a0649a-09f2-4f3a-881b-${String(size).padStart(12, '0')}',
  document: { lang: 'en-US' },
  renderRoute(value) { return typeof value === 'string' ? value : String(value ?? ''); },
});

export const benchmarkRefreshQuery = app.query({
  access: app.publicAccess('generated equal-shape refresh-surface query'),
  load: () => ({ label: 'ready' }),
  output: s.object({ label: s.string() }),
});
`,
    'src/page.tsx': `/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';

import { benchmarkRefreshQuery } from './kovo.js';

export const EntryRefreshSurface = component({
  queries: { refresh: benchmarkRefreshQuery },
  render: ({ refresh }: { refresh: { label: string } }) => (
    <header
      data-benchmark-entry="true"
      data-benchmark-surface="entry"
      data-entry-revision="entry-r0"
      data-refresh-ready={refresh.label}
    >
      <h1>Equal-shape ${size}-module corpus</h1>
    </header>
  ),
});
`,
    'src/shell.tsx': `/** @jsxImportSource @kovojs/server */
${componentImports}
import { CounterIsland } from './counter-island.js';
import { DataRefreshSurface } from './data.js';
import { EntryRefreshSurface } from './page.js';

export function CorpusPage(): string {
  return (
    <main data-benchmark-ready="true">
      {/* SPEC §4.1/§4.9/§9.5.1 + KV420: every measured refresh target is a sibling of local state. */}
      <EntryRefreshSurface />
      <DataRefreshSurface />
${componentElements}
      <CounterIsland />
    </main>
  );
}
`,
    'tsconfig.json': `${JSON.stringify(
      {
        compilerOptions: {
          jsx: 'react-jsx',
          jsxImportSource: '@kovojs/server',
          module: 'ESNext',
          moduleResolution: 'Bundler',
          allowImportingTsExtensions: true,
          skipLibCheck: true,
          strict: true,
          target: 'ES2024',
        },
        include: ['src/**/*.ts', 'src/**/*.tsx'],
      },
      null,
      2,
    )}\n`,
    ...Object.fromEntries(
      componentNames(size).map((name, index) => [
        `src/components/component-${pad(index)}.tsx`,
        kovoComponent(name, index),
      ]),
    ),
  };
}

function nextFiles(size) {
  const componentImports = componentNames(size)
    .map((name, index) => `import { ${name} } from './components/component-${pad(index)}';`)
    .join('\n');
  const componentElements = componentNames(size)
    .map((name) => `      <${name} />`)
    .join('\n');
  return {
    'app/[route]/page.tsx': `import { CorpusPage } from '../../src/shell';

export function generateStaticParams() {
  return [{ route: 'route-a' }, { route: 'route-b' }, { route: 'route-c' }];
}

export default CorpusPage;
`,
    'app/layout.tsx': `import type { ReactNode } from 'react';

export default function Layout({ children }: { children: ReactNode }) {
  return <html lang="en-US"><body>{children}</body></html>;
}
`,
    'app/page.tsx': `export { CorpusPage as default } from '../src/shell';\n`,
    'next.config.mjs': `export default { output: 'standalone' };\n`,
    'next-env.d.ts': `/// <reference types="next" />
/// <reference types="next/image-types/global" />
import "./.next/types/routes.d.ts";

// NOTE: This file should not be edited
// see https://nextjs.org/docs/app/api-reference/config/typescript for more information.
`,
    'package.json': `${JSON.stringify({ name: `next-benchmark-corpus-${size}`, private: true, type: 'module' }, null, 2)}\n`,
    'src/counter-island.tsx': `'use client';
import { useState } from 'react';

export function CounterIsland() {
  const [count, setCount] = useState(0);
  return (
    <button data-benchmark-state="true" type="button" onClick={() => setCount((value) => value + 1)}>
      Count {count}
    </button>
  );
}
`,
    'src/data.tsx': `export const benchmarkDataLabel = 'data-r0';

export function DataRefreshSurface() {
  return (
    <p
      data-benchmark-data="true"
      data-benchmark-surface="data"
      data-refresh-ready="ready"
    >
      {benchmarkDataLabel}
    </p>
  );
}
`,
    'src/page.tsx': `export function EntryRefreshSurface() {
  return (
    <header
      data-benchmark-entry="true"
      data-benchmark-surface="entry"
      data-entry-revision="entry-r0"
      data-refresh-ready="ready"
    >
      <h1>Equal-shape ${size}-module corpus</h1>
    </header>
  );
}
`,
    'src/shell.tsx': `${componentImports}
import { CounterIsland } from './counter-island';
import { DataRefreshSurface } from './data';
import { EntryRefreshSurface } from './page';

export function CorpusPage() {
  return (
    <main data-benchmark-ready="true">
      {/* Matched refresh surfaces stay siblings of local state so Fast Refresh preserves it. */}
      <EntryRefreshSurface />
      <DataRefreshSurface />
${componentElements}
      <CounterIsland />
    </main>
  );
}
`,
    'tsconfig.json': `${JSON.stringify(
      {
        compilerOptions: {
          allowJs: true,
          esModuleInterop: true,
          incremental: true,
          isolatedModules: true,
          jsx: 'react-jsx',
          lib: ['dom', 'dom.iterable', 'es2022'],
          module: 'esnext',
          moduleResolution: 'bundler',
          noEmit: true,
          plugins: [{ name: 'next' }],
          resolveJsonModule: true,
          skipLibCheck: true,
          strict: true,
          target: 'es2022',
        },
        include: [
          'next-env.d.ts',
          '**/*.ts',
          '**/*.tsx',
          '.next/types/**/*.ts',
          '.next/dev/types/**/*.ts',
        ],
        exclude: ['node_modules'],
      },
      null,
      2,
    )}\n`,
    ...Object.fromEntries(
      componentNames(size).map((name, index) => [
        `src/components/component-${pad(index)}.tsx`,
        nextComponent(name, index),
      ]),
    ),
  };
}

function kovoComponent(name, index) {
  const id = pad(index);
  const refreshImport = index === 0 ? "\nimport { benchmarkRefreshQuery } from '../kovo.js';" : '';
  const refreshContract =
    index === 0
      ? `  queries: { refresh: benchmarkRefreshQuery },\n  render: ({ refresh }: { refresh: { label: string } }) => (`
      : '  render: () => (';
  const refreshAttribute =
    index === 0
      ? '\n      data-benchmark-surface="leaf"\n      data-refresh-ready={refresh.label}'
      : '';
  return `/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';${refreshImport}

export const ${name} = component({
${refreshContract}
    <article
      data-module="${id}"
      data-revision="${index === 0 ? 'leaf-r0' : 'stable'}"${refreshAttribute}
    >
      <h2>Module ${id}</h2>
      <p>Shared workload line ${id}.</p>
    </article>
  ),
});
`;
}

function nextComponent(name, index) {
  const id = pad(index);
  const refreshAttribute =
    index === 0 ? '\n      data-benchmark-surface="leaf"\n      data-refresh-ready="ready"' : '';
  return `// Equal-shape module ${id}.
// The comment padding keeps authored workload LOC aligned with Kovo.
// Both entrants render the same observable element and text.
export function ${name}() {
  return (
    <article
      data-module="${id}"
      data-revision="${index === 0 ? 'leaf-r0' : 'stable'}"${refreshAttribute}
    >
      <h2>Module ${id}</h2>
      <p>Shared workload line ${id}.</p>
    </article>
  );
}
`;
}

function componentNames(size) {
  return Array.from({ length: size }, (_, index) => `CorpusComponent${pad(index)}`);
}

function pad(value) {
  return String(value).padStart(3, '0');
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function sha256(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function sourceFileEvidence(files) {
  return Object.entries(files)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([file, source]) => ({
      bytes: Buffer.byteLength(source),
      file,
      sha256: sha256(source),
    }));
}

function lineCount(files) {
  return Object.entries(files)
    .filter(([name]) => /\.[cm]?[jt]sx?$/u.test(name))
    .reduce((total, [, source]) => total + source.trimEnd().split('\n').length, 0);
}

function validateSize(value) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || !SUPPORTED_SIZES.includes(number)) {
    throw new TypeError(`Corpus size must be one of ${SUPPORTED_SIZES.join(', ')}.`);
  }
  return number;
}

function assertSafeOutputRoot(outputRoot) {
  const root = path.parse(outputRoot).root;
  if (outputRoot === root || outputRoot === repoRoot || outputRoot === benchmarkRoot) {
    throw new TypeError(`Refusing unsafe corpus output root ${outputRoot}.`);
  }
}

function isPathWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return (
    relative !== '' &&
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

async function prepareOwnedAppRoot({ appRoot, framework, modules }) {
  const ownership = {
    appRoot,
    framework,
    modules,
    schema: CORPUS_OWNER_SCHEMA,
  };
  let existing;
  try {
    existing = await lstat(appRoot);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  if (existing) {
    if (existing.isSymbolicLink() || !existing.isDirectory()) {
      throw new TypeError(`Refusing to replace non-directory corpus path ${appRoot}.`);
    }
    let owner;
    try {
      owner = JSON.parse(await readFile(path.join(appRoot, CORPUS_OWNER_FILE), 'utf8'));
    } catch (error) {
      if (error?.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
    }
    if (JSON.stringify(owner) !== JSON.stringify(ownership)) {
      throw new TypeError(
        `Refusing to replace unowned corpus directory ${appRoot}; remove it explicitly or choose a fresh --out root.`,
      );
    }
    await rm(appRoot, { recursive: true });
  }

  await mkdir(appRoot, { recursive: true });
  await writeFile(path.join(appRoot, CORPUS_OWNER_FILE), `${JSON.stringify(ownership, null, 2)}\n`);
}

function readOption(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) throw new TypeError(`${name} requires a value.`);
  return value;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const outDir = readOption('--out');
  const rawSizes = readOption('--sizes');
  const manifests = await generateCorpora({
    ...(outDir === undefined ? {} : { outDir }),
    ...(rawSizes === undefined ? {} : { sizes: rawSizes.split(',') }),
  });
  process.stdout.write(`${manifests.join('\n')}\n`);
}
