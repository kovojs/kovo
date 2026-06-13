import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmod, cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';

import {
  commandSequence,
  loadVitePlusConfig,
  runCommandSequenceSync,
  type VitePlusTask,
} from './command-fixtures.ts';
import { htmlElementFacts, type HtmlElementFact } from './html-fragment.ts';
import { cssSourceDirectives } from './source-fixtures.ts';

export interface StarterTemplateSources {
  ciWorkflowSource: string;
  graphSource: string;
  indexHtmlSource: string;
  packageJsonSource: string;
  stylesSource: string;
  viteConfigSource: string;
}

export interface StarterTemplatePackageFacts {
  dependencies: readonly string[];
  devDependencies: readonly string[];
  scripts: Record<string, unknown>;
}

export interface StarterTemplateIndexHtmlFacts {
  htmlAttrs: Record<string, string> | undefined;
  linkAttrs: ReadonlyArray<Record<string, string>>;
  metaAttrs: ReadonlyArray<Record<string, string>>;
  scriptAttrs: ReadonlyArray<Record<string, string>>;
  tags: readonly string[];
}

export interface StarterTemplateFacts {
  ciRunCommands: readonly string[];
  cssDirectives: readonly string[];
  graph: Record<string, unknown>;
  indexHtml: StarterTemplateIndexHtmlFacts;
  package: StarterTemplatePackageFacts;
  viteTasks: Record<string, VitePlusTask>;
}

export interface StarterTemplateFixturePaths {
  compilerModuleUrl?: string;
  projectRoot: string | URL;
  templateRoot: string | URL;
}

export interface StarterTemplateFwOutput {
  args: readonly string[];
  output: string;
}

export interface StarterTemplateExecutionResult {
  graph: unknown;
  output: string;
}

export interface ConformancePackageFixture {
  manifest: {
    name: string;
    scripts?: Record<string, unknown>;
  };
}

export interface PnpmFilterTaskExecution {
  observed: Array<{ packageName: string; script: string }>;
  output: string;
}

interface StarterTemplatePackageJson {
  dependencies?: Record<string, unknown>;
  devDependencies?: Record<string, unknown>;
  scripts?: Record<string, unknown>;
}

const sortedKeys = (value: Record<string, unknown> | undefined): string[] =>
  Object.keys(value ?? {}).sort();

const attrsFor = (
  elements: readonly HtmlElementFact[],
  tag: string,
): Array<Record<string, string>> =>
  elements.filter((element) => element.tag === tag).map((element) => element.attrs);

export async function starterTemplateFacts(
  sources: StarterTemplateSources,
): Promise<StarterTemplateFacts> {
  const packageJson = JSON.parse(sources.packageJsonSource) as StarterTemplatePackageJson;
  const viteConfig = await loadVitePlusConfig(sources.viteConfigSource);
  const indexElements = htmlElementFacts(sources.indexHtmlSource);
  const ciRunCommands = sources.ciWorkflowSource
    .split('\n')
    .map((line) => /^\s*-\s+run:\s*(.+?)\s*$/.exec(line)?.[1])
    .filter((command): command is string => Boolean(command));

  return {
    ciRunCommands:
      ciRunCommands.length > 0
        ? commandSequence(ciRunCommands.join(' && ')).map((command) => command.raw)
        : [],
    cssDirectives: cssSourceDirectives(sources.stylesSource),
    graph: JSON.parse(sources.graphSource) as Record<string, unknown>,
    indexHtml: {
      htmlAttrs: indexElements.find((element) => element.tag === 'html')?.attrs,
      linkAttrs: attrsFor(indexElements, 'link'),
      metaAttrs: attrsFor(indexElements, 'meta'),
      scriptAttrs: attrsFor(indexElements, 'script'),
      tags: indexElements.map((element) => element.tag),
    },
    package: {
      dependencies: sortedKeys(packageJson.dependencies),
      devDependencies: sortedKeys(packageJson.devDependencies),
      scripts: { ...packageJson.scripts },
    },
    viteTasks: viteConfig.run?.tasks ?? {},
  };
}

const pathFrom = (path: string | URL): string => (path instanceof URL ? fileURLToPath(path) : path);

const compilerModuleUrlFor = (paths: StarterTemplateFixturePaths): string =>
  paths.compilerModuleUrl ??
  pathToFileURL(join(pathFrom(paths.projectRoot), 'dist/compiler/src/index.mjs')).href;

const writeCompilerShim = async (fixtureRoot: string, compilerModuleUrl: string): Promise<void> => {
  const compilerShimRoot = join(fixtureRoot, 'node_modules/@jiso/compiler');
  await mkdir(compilerShimRoot, { recursive: true });
  await writeFile(
    join(compilerShimRoot, 'package.json'),
    JSON.stringify({ exports: './index.mjs', type: 'module' }),
    'utf8',
  );
  await writeFile(
    join(compilerShimRoot, 'index.mjs'),
    `export * from ${JSON.stringify(compilerModuleUrl)};\n`,
    'utf8',
  );
};

const writeFakeFw = async (
  fakeBin: string,
  outputs: readonly StarterTemplateFwOutput[],
): Promise<string> => {
  await mkdir(fakeBin, { recursive: true });
  const fakeFw = join(fakeBin, 'fw');
  await writeFile(
    fakeFw,
    `#!/usr/bin/env node
const outputs = new Map(${JSON.stringify(
      outputs.map((entry) => [JSON.stringify(entry.args), entry.output]),
    )});
const output = outputs.get(JSON.stringify(process.argv.slice(2)));
if (output === undefined) {
  process.stderr.write(\`unexpected fw args: \${JSON.stringify(process.argv.slice(2))}\\n\`);
  process.exit(64);
}
process.stdout.write(output);
`,
    'utf8',
  );
  await chmod(fakeFw, 0o755);
  return fakeFw;
};

export async function runStarterTemplateGraphAssertions(
  paths: StarterTemplateFixturePaths,
  fwOutputs: readonly StarterTemplateFwOutput[],
): Promise<string> {
  const fakeBin = await mkdtemp(join(tmpdir(), 'jiso-fake-fw-'));

  try {
    await writeFakeFw(fakeBin, fwOutputs);

    return execFileSync('node', ['scripts/graph-assertions.mjs'], {
      cwd: pathFrom(paths.templateRoot),
      encoding: 'utf8',
      env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH ?? ''}` },
    });
  } finally {
    await rm(fakeBin, { force: true, recursive: true });
  }
}

export async function runStarterTemplateEmitGraph(
  paths: StarterTemplateFixturePaths,
): Promise<StarterTemplateExecutionResult> {
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'jiso-template-emit-graph-'));

  try {
    await cp(paths.templateRoot, fixtureRoot, { recursive: true });
    await writeCompilerShim(fixtureRoot, compilerModuleUrlFor(paths));

    const output = execFileSync('node', ['scripts/emit-graph.mjs'], {
      cwd: fixtureRoot,
      encoding: 'utf8',
      env: { ...process.env, CI: '1' },
    });
    const graph = JSON.parse(await readFile(join(fixtureRoot, 'graph.json'), 'utf8')) as unknown;

    return { graph, output };
  } finally {
    await rm(fixtureRoot, { force: true, recursive: true });
  }
}

export async function runStarterTemplateViteTaskCommand(
  command: unknown,
  paths: StarterTemplateFixturePaths,
  fwOutputs: readonly StarterTemplateFwOutput[],
): Promise<StarterTemplateExecutionResult> {
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'jiso-template-task-'));
  const fakeBin = join(fixtureRoot, '.fake-bin');

  try {
    await cp(paths.templateRoot, fixtureRoot, { recursive: true });
    await writeCompilerShim(fixtureRoot, compilerModuleUrlFor(paths));
    await writeFakeFw(fakeBin, fwOutputs);

    const output = runCommandSequenceSync(command, {
      cwd: fixtureRoot,
      encoding: 'utf8',
      env: { ...process.env, CI: '1', PATH: `${fakeBin}:${process.env.PATH ?? ''}` },
    });
    const graph = JSON.parse(await readFile(join(fixtureRoot, 'graph.json'), 'utf8')) as unknown;

    return { graph, output };
  } finally {
    await rm(fixtureRoot, { force: true, recursive: true });
  }
}

export async function runPnpmFilterTaskCommand(
  command: unknown,
  expectedPackages: readonly ConformancePackageFixture[],
  options: { cwd: string | URL },
): Promise<PnpmFilterTaskExecution> {
  const fakeBin = await mkdtemp(join(tmpdir(), 'jiso-conformance-pnpm-'));
  const fakePnpm = join(fakeBin, 'pnpm');
  const observedPath = join(fakeBin, 'observed.jsonl');
  const packageScripts = Object.fromEntries(
    expectedPackages.map(({ manifest }) => [manifest.name, manifest.scripts ?? {}]),
  );
  const expectedPackageNames = expectedPackages
    .map(({ manifest }) => manifest.name)
    .toSorted((left, right) => left.localeCompare(right));

  try {
    await writeFile(
      fakePnpm,
      `#!/usr/bin/env node
import assert from 'node:assert/strict';
import { appendFileSync } from 'node:fs';

const args = process.argv.slice(2);
const scriptsByPackage = JSON.parse(process.env.JISO_CONFORMANCE_PACKAGE_SCRIPTS ?? '{}');
assert.deepEqual(args.slice(0, 2), ['--filter', args[1]]);
assert.equal(args[2], 'test');
assert.equal(args.length, 3);
const packageName = args[1];
assert.equal(
  scriptsByPackage[packageName]?.test,
  'vitest --run src/index.test.ts',
  \`\${packageName} exposes the expected conformance test command\`,
);
appendFileSync(process.env.JISO_CONFORMANCE_OBSERVED, JSON.stringify({ packageName, script: args[2] }) + '\\n');
process.stdout.write(\`pnpm-filter-test \${packageName}\\n\`);
`,
      'utf8',
    );
    await chmod(fakePnpm, 0o755);

    const output = runCommandSequenceSync(command, {
      cwd: pathFrom(options.cwd),
      encoding: 'utf8',
      env: {
        ...process.env,
        JISO_CONFORMANCE_OBSERVED: observedPath,
        JISO_CONFORMANCE_PACKAGE_SCRIPTS: JSON.stringify(packageScripts),
        PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
      },
    });
    const observed = (await readFile(observedPath, 'utf8'))
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { packageName: string; script: string });

    assert.deepEqual(
      observed
        .map((entry) => entry.packageName)
        .toSorted((left, right) => left.localeCompare(right)),
      expectedPackageNames,
      'conformance task executes every discovered conformance package test',
    );

    return { observed, output };
  } finally {
    await rm(fakeBin, { force: true, recursive: true });
  }
}

export interface StarterClientTemplateFixture {
  appendCalls: Array<[position: string, html: string]>;
  deferredApplications: unknown[];
  documentRoot: unknown;
  exports: Record<string, unknown>;
  fetchCalls: Array<[url: string, options: Record<string, unknown>]>;
  loaderInstalls: unknown[];
  queryStore: unknown;
}

interface StarterClientElement {
  innerHTML: string;
  insertAdjacentHTML(position: string, html: string): void;
}

export async function executeStarterClientTemplate(
  source: string,
): Promise<StarterClientTemplateFixture> {
  const ts = await import('typescript');
  const appendCalls: Array<[position: string, html: string]> = [];
  const deferredApplications: unknown[] = [];
  const fetchCalls: Array<[url: string, options: Record<string, unknown>]> = [];
  const loaderInstalls: unknown[] = [];
  const queryStore = { kind: 'starter-query-store' };
  const module = { exports: {} as Record<string, unknown> };
  const fragmentById: Record<string, StarterClientElement> = {
    'cart-badge': {
      innerHTML: '<cart-badge>0</cart-badge>',
      insertAdjacentHTML(position, html) {
        appendCalls.push([position, html]);
      },
    },
  };
  const documentRoot = {
    getElementById(id: string) {
      return fragmentById[id] ?? null;
    },
    querySelector(selector: string) {
      return selector === '[fw-fragment-target="cart-list"]'
        ? {
            innerHTML: '<ul></ul>',
            insertAdjacentHTML(position: string, html: string) {
              appendCalls.push([position, html]);
            },
          }
        : null;
    },
    querySelectorAll() {
      return [];
    },
  };
  const runtime = {
    applyDeferredStreamResponseToDom(options: unknown) {
      deferredApplications.push(options);
      return { applied: true };
    },
    createQueryStore() {
      return queryStore;
    },
    installJisoLoader(options: unknown) {
      loaderInstalls.push(options);
    },
  };
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;

  runInNewContext(compiled, {
    CSS: { escape: (value: string) => value },
    document: documentRoot,
    exports: module.exports,
    fetch(url: string, options: Record<string, unknown>) {
      fetchCalls.push([url, options]);
      return { ok: true };
    },
    module,
    require(specifier: string) {
      if (specifier === '@jiso/runtime') return runtime;
      assert.fail(`unexpected starter client import ${specifier}`);
    },
  });

  return {
    appendCalls,
    deferredApplications,
    documentRoot,
    exports: module.exports,
    fetchCalls,
    loaderInstalls,
    queryStore,
  };
}
