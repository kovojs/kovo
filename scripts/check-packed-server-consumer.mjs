#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

import { isMainEntry, runGate } from './lib/cli-entry.mjs';
import {
  validatePackedReleaseManifest,
  verifyPackedAttestation,
} from './publish-packed-packages.mjs';
import { manifestPath, releasePackages, repoRoot } from './release-packages.mjs';

const SERVER_PACKAGE = '@kovojs/server';
const CORE_PACKAGE = '@kovojs/core';
const ROOT_DECLARATION_COUNT = 120;
const REQUIRED_ROOT_EXPORTS = Object.freeze([
  'defineKovo',
  'mutation',
  'publicAccess',
  'query',
  'route',
  's',
  'safeRichHtml',
  'tag',
]);
const RETIRED_ROOT_EXPORTS = Object.freeze([
  'KovoApp',
  'createRequestHandler',
  'createSigningKeyRing',
  'createVerifier',
  'publicScopedKey',
  'task',
  'toNodeHandler',
  'trustedHtml',
]);
const TASK_EXPORTS = Object.freeze([
  'AppTaskDeclaration',
  'DurableTaskObservedStatus',
  'DurableTaskStatusFilters',
  'DurableTaskStatusJob',
  'DurableTaskStatusRecord',
  'DurableTaskStatusSnapshotSource',
  'DurableTaskStatusSqlExecutor',
  'DurableTaskStatusSqlResult',
  'DurableTaskStatusSqlStatement',
  'DurableTaskStatusSurface',
  'TaskCronCatchUp',
  'TaskDefinition',
  'TaskFactory',
  'TaskHandle',
  'TaskInput',
  'TaskPrincipalReadScope',
  'TaskPrincipalScope',
  'TaskPrincipalWriteScope',
  'TaskRunContext',
  'TaskRunnableMutation',
  'TaskRunnableMutationInput',
  'TaskRunnableQuery',
  'TaskRunnableQueryInput',
  'TaskScheduleOptions',
  'TaskSchedulingRequest',
  'createDurableTaskStatus',
  'task',
]);
const NODE_EXPORTS = Object.freeze(['NodeHandlerOptions', 'NodeRequestHandler', 'toNodeHandler']);
const CUSTOM_ADAPTER_EXPORTS = Object.freeze([
  'AppMutationAdapter',
  'KovoApp',
  'RequestHandler',
  'createRequestHandler',
]);
const REQUIRED_EXPORT_TARGETS = Object.freeze({
  '.': Object.freeze({
    default: './dist/index.mjs',
    types: './dist/index.d.mts',
  }),
  './custom-adapters': Object.freeze({
    default: './dist/public-custom-adapters.mjs',
    types: './dist/public-custom-adapters.d.mts',
  }),
  './node': Object.freeze({
    default: './dist/public-node.mjs',
    types: './dist/public-node.d.mts',
  }),
  './runtime-bootstrap': Object.freeze({
    default: './dist/runtime-bootstrap.mjs',
    types: './dist/runtime-bootstrap.d.mts',
  }),
  './tasks': Object.freeze({
    default: './dist/public-tasks.mjs',
    types: './dist/public-tasks.d.mts',
  }),
});

export function assertPackedServerManifest(manifest) {
  if (manifest?.name !== SERVER_PACKAGE || typeof manifest.version !== 'string') {
    throw new Error('Packed server manifest has the wrong package identity');
  }
  for (const [subpath, expected] of Object.entries(REQUIRED_EXPORT_TARGETS)) {
    const actual = manifest.exports?.[subpath];
    if (actual?.types !== expected.types || actual?.default !== expected.default) {
      throw new Error(
        `Packed server ${subpath} does not resolve its reviewed runtime and declarations`,
      );
    }
  }
  if (manifest.dependencies?.[CORE_PACKAGE] === undefined) {
    throw new Error('Packed server manifest does not declare its core dependency');
  }
  for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
    for (const [name, version] of Object.entries(manifest[field] ?? {})) {
      if (typeof version !== 'string' || version.startsWith('workspace:')) {
        throw new Error(`Packed server ${field}.${name} is not an installable version`);
      }
    }
  }
}

export function packedDeclarationExports(source, fileName = 'consumer.d.mts') {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const names = [];
  for (const statement of sourceFile.statements) {
    if (!ts.isExportDeclaration(statement) || !statement.exportClause) continue;
    if (!ts.isNamedExports(statement.exportClause)) continue;
    for (const element of statement.exportClause.elements) names.push(element.name.text);
  }
  return [...new Set(names)].sort(compareStrings);
}

export function assertPackedServerDeclarations({ customAdapters, node, root, tasks }) {
  const rootExports = packedDeclarationExports(root, 'index.d.mts');
  if (rootExports.length !== ROOT_DECLARATION_COUNT) {
    throw new Error(
      `Packed server root declarations drifted: expected ${ROOT_DECLARATION_COUNT}, got ${rootExports.length}`,
    );
  }
  assertContainsEvery(rootExports, REQUIRED_ROOT_EXPORTS, 'server root');
  const retired = RETIRED_ROOT_EXPORTS.filter((name) => rootExports.includes(name));
  if (retired.length > 0) {
    throw new Error(`Packed server root retains moved declarations: ${retired.join(', ')}`);
  }
  assertExactExports(
    packedDeclarationExports(tasks, 'public-tasks.d.mts'),
    TASK_EXPORTS,
    'server tasks',
  );
  assertExactExports(
    packedDeclarationExports(node, 'public-node.d.mts'),
    NODE_EXPORTS,
    'server Node adapter',
  );
  assertExactExports(
    packedDeclarationExports(customAdapters, 'public-custom-adapters.d.mts'),
    CUSTOM_ADAPTER_EXPORTS,
    'server custom adapters',
  );
}

export function assertLiteralFirstServerBootstrap(source) {
  const sourceFile = ts.createSourceFile(
    'server-consumer.mjs',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  const first = sourceFile.statements[0];
  if (
    first === undefined ||
    !ts.isImportDeclaration(first) ||
    first.importClause !== undefined ||
    !ts.isStringLiteral(first.moduleSpecifier) ||
    first.moduleSpecifier.text !== '@kovojs/server/runtime-bootstrap'
  ) {
    throw new Error(
      'Packed custom adapter entry must begin with the literal side-effect import @kovojs/server/runtime-bootstrap',
    );
  }
}

export function packedServerConsumerManifest(packedPackages, packageManager, nodeTypesVersion) {
  const tarballs = Object.fromEntries(
    packedPackages.map((pkg) => [
      pkg.name,
      pathToFileURL(path.resolve(repoRoot, pkg.tarball)).href,
    ]),
  );
  const server = packedPackages.find((pkg) => pkg.name === SERVER_PACKAGE);
  const serverTarball = tarballs[SERVER_PACKAGE];
  if (serverTarball === undefined || server?.manifest === undefined) {
    throw new Error(`Packed release manifest is missing ${SERVER_PACKAGE}`);
  }
  if (typeof packageManager !== 'string' || typeof nodeTypesVersion !== 'string') {
    throw new Error('Packed server consumer requires pinned package-manager and Node types');
  }
  const requiredPeers = Object.fromEntries(
    Object.entries(server.manifest.peerDependencies ?? {}).filter(
      ([name]) => server.manifest.peerDependenciesMeta?.[name]?.optional !== true,
    ),
  );
  return {
    dependencies: {
      [SERVER_PACKAGE]: serverTarball,
      '@types/node': nodeTypesVersion,
      ...requiredPeers,
    },
    name: 'kovo-packed-server-consumer',
    packageManager,
    pnpm: { overrides: tarballs },
    private: true,
    type: 'module',
    version: '0.0.0',
  };
}

export function checkPackedServerConsumer() {
  const repositoryManifest = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  const packedManifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const packedPackages = validatePackedReleaseManifest(packedManifest, releasePackages());
  const server = packedPackages.find((pkg) => pkg.name === SERVER_PACKAGE);
  if (server === undefined) {
    throw new Error(`Packed release manifest is missing ${SERVER_PACKAGE}`);
  }
  for (const pkg of packedPackages) {
    verifyPackedAttestation(pkg, path.resolve(repoRoot, pkg.tarball));
  }
  assertPackedServerManifest(server.manifest);

  const consumerRoot = mkdtempSync(path.join(os.tmpdir(), 'kovo-packed-server-consumer-'));
  try {
    writeFileSync(
      path.join(consumerRoot, 'package.json'),
      `${JSON.stringify(
        packedServerConsumerManifest(
          packedPackages,
          repositoryManifest.packageManager,
          repositoryManifest.devDependencies?.['@types/node'],
        ),
        null,
        2,
      )}\n`,
      'utf8',
    );
    runCommand(
      'pnpm',
      ['install', '--ignore-scripts', '--no-frozen-lockfile', '--strict-peer-dependencies'],
      consumerRoot,
      'install',
    );

    const installedServerRoot = path.join(consumerRoot, 'node_modules', '@kovojs', 'server');
    const installedManifest = JSON.parse(
      readFileSync(path.join(installedServerRoot, 'package.json'), 'utf8'),
    );
    assertPackedServerManifest(installedManifest);
    assertPackedServerDeclarations({
      customAdapters: readDeclaration(installedServerRoot, installedManifest, './custom-adapters'),
      node: readDeclaration(installedServerRoot, installedManifest, './node'),
      root: readDeclaration(installedServerRoot, installedManifest, '.'),
      tasks: readDeclaration(installedServerRoot, installedManifest, './tasks'),
    });
    assertPackedTypeConsumer(consumerRoot);
    assertPackedRuntimeConsumer(consumerRoot);
    assertPackedUnbootstrappedRefusal(consumerRoot);
    process.stdout.write(
      'Packed server consumer passed (120 root declarations, task/Node/custom-adapter paths, literal-first bootstrap).\n',
    );
  } finally {
    rmSync(consumerRoot, { force: true, recursive: true });
  }
}

function readDeclaration(packageRoot, manifest, subpath) {
  const target = manifest.exports[subpath].types;
  const resolved = path.resolve(packageRoot, target);
  if (resolved === packageRoot || !resolved.startsWith(`${packageRoot}${path.sep}`)) {
    throw new Error(`Packed server ${subpath} declaration target escapes its package`);
  }
  return readFileSync(resolved, 'utf8');
}

function assertPackedTypeConsumer(consumerRoot) {
  const sourcePath = path.join(consumerRoot, 'consumer.ts');
  writeFileSync(
    sourcePath,
    `import { defineKovo, s } from '@kovojs/server';
import {
  task,
  type TaskDefinition,
} from '@kovojs/server/tasks';
import {
  toNodeHandler,
  type NodeHandlerOptions,
  type NodeRequestHandler,
} from '@kovojs/server/node';
import {
  createRequestHandler,
  type AppMutationAdapter,
  type KovoApp,
  type RequestHandler,
} from '@kovojs/server/custom-adapters';

// @ts-expect-error durable tasks moved to the semantic task path.
import { task as retiredRootTask } from '@kovojs/server';
// @ts-expect-error Node adapters moved to the semantic Node path.
import { toNodeHandler as retiredRootNodeHandler } from '@kovojs/server';
// @ts-expect-error custom adapters moved to the semantic custom-adapter path.
import { createRequestHandler as retiredRootRequestHandler } from '@kovojs/server';

const app = defineKovo({
  appId: '394f368d-4e50-4d56-9b3f-f7cd970c5ac7',
  egress: { enabled: false, justification: 'packed server declaration consumer' },
});
const input = s.object({ message: s.string() });
const background = task('packed/server-consumer', {
  input,
  run(value) {
    return value.message.length;
  },
});
const taskContract: TaskDefinition<'packed/server-consumer', typeof input, number> = background;
const options: NodeHandlerOptions = { compression: false, origin: 'https://example.test' };
declare const opaqueApp: KovoApp;
const requestHandler: RequestHandler = createRequestHandler(opaqueApp);
const nodeHandler: NodeRequestHandler = toNodeHandler(requestHandler, options);
declare const adapter: AppMutationAdapter<{ key: 'packed/mutation' }>;

void [
  adapter,
  app,
  nodeHandler,
  retiredRootNodeHandler,
  retiredRootRequestHandler,
  retiredRootTask,
  taskContract,
];
`,
    'utf8',
  );
  const program = ts.createProgram([sourcePath], {
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    noEmit: true,
    skipLibCheck: false,
    strict: true,
    target: ts.ScriptTarget.ES2022,
    types: ['node'],
  });
  // Keep first-party declaration closure strict while leaving dependency-owned declaration
  // internals to their own compatibility policy (rules/api-surface.md). In particular, the pinned
  // Drizzle RC currently emits TypeScript 6 diagnostics in unrelated dialect declarations.
  const diagnostics = ts
    .getPreEmitDiagnostics(program)
    .filter((diagnostic) => !isThirdPartyDeclarationDiagnostic(diagnostic));
  if (diagnostics.length > 0) {
    throw new Error(
      `Packed server type consumer failed:\n${ts.formatDiagnosticsWithColorAndContext(diagnostics, {
        getCanonicalFileName: (fileName) => fileName,
        getCurrentDirectory: () => consumerRoot,
        getNewLine: () => '\n',
      })}`,
    );
  }
}

function isThirdPartyDeclarationDiagnostic(diagnostic) {
  const sourceFile = diagnostic.file;
  if (sourceFile === undefined || !sourceFile.isDeclarationFile) return false;
  const normalized = sourceFile.fileName.replaceAll(path.sep, '/');
  return normalized.includes('/node_modules/') && !normalized.includes('/node_modules/@kovojs/');
}

function assertPackedRuntimeConsumer(consumerRoot) {
  const source = `import '@kovojs/server/runtime-bootstrap';

import * as rootApi from '@kovojs/server';
import { task } from '@kovojs/server/tasks';
import { toNodeHandler } from '@kovojs/server/node';
import * as customAdapters from '@kovojs/server/custom-adapters';

for (const name of ${JSON.stringify(REQUIRED_ROOT_EXPORTS)}) {
  if (!(name in rootApi)) throw new Error(\`packed server root is missing \${name}\`);
}
for (const name of ${JSON.stringify(RETIRED_ROOT_EXPORTS.filter((name) => name !== 'KovoApp'))}) {
  if (name in rootApi) throw new Error(\`packed server root retains moved \${name}\`);
}
if (JSON.stringify(Object.keys(customAdapters).sort()) !== JSON.stringify(['createRequestHandler'])) {
  throw new Error('packed custom-adapter runtime exports drifted');
}
const declared = task('packed/server-consumer', {
  input: rootApi.s.object({ message: rootApi.s.string() }),
  run(value) { return value.message.length; },
});
if (declared.key !== 'packed/server-consumer') throw new Error('packed task path failed');
const nodeHandler = toNodeHandler(async () => new Response('OK'), { compression: false });
if (typeof nodeHandler !== 'function') throw new Error('packed Node adapter failed');
let forgedTokenRefused = false;
try {
  customAdapters.createRequestHandler({});
} catch (error) {
  forgedTokenRefused =
    error instanceof TypeError &&
    error.message.includes('exact opaque KovoApp') &&
    !error.message.includes('unbootstrapped');
}
if (!forgedTokenRefused) throw new Error('packed custom adapter lost its opaque-token boundary');
process.stdout.write('packed-server-consumer/v1 OK\\n');
`;
  assertLiteralFirstServerBootstrap(source);
  const entry = path.join(consumerRoot, 'runtime-consumer.mjs');
  writeFileSync(entry, source, 'utf8');
  assertProcess(
    spawnSync(process.execPath, [entry], {
      cwd: consumerRoot,
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
      timeout: 30_000,
    }),
    'bootstrapped server runtime',
    'packed-server-consumer/v1 OK\n',
  );
}

function assertPackedUnbootstrappedRefusal(consumerRoot) {
  const entry = path.join(consumerRoot, 'unbootstrapped-consumer.mjs');
  writeFileSync(
    entry,
    `import { createRequestHandler } from '@kovojs/server/custom-adapters';

try {
  createRequestHandler({});
  throw new Error('unbootstrapped custom adapter was accepted');
} catch (error) {
  if (!(error instanceof TypeError) || !error.message.includes('refuses an unbootstrapped custom runner')) {
    throw error;
  }
}
process.stdout.write('packed-server-unbootstrapped-refusal/v1 OK\\n');
`,
    'utf8',
  );
  assertProcess(
    spawnSync(process.execPath, [entry], {
      cwd: consumerRoot,
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
      timeout: 30_000,
    }),
    'unbootstrapped custom-adapter refusal',
    'packed-server-unbootstrapped-refusal/v1 OK\n',
  );
}

function assertContainsEvery(actual, expected, label) {
  const missing = expected.filter((name) => !actual.includes(name));
  if (missing.length > 0) throw new Error(`Packed ${label} is missing: ${missing.join(', ')}`);
}

function assertExactExports(actual, expected, label) {
  const sortedExpected = [...expected].sort(compareStrings);
  if (JSON.stringify(actual) !== JSON.stringify(sortedExpected)) {
    throw new Error(`Packed ${label} declarations drifted: ${JSON.stringify(actual)}`);
  }
}

function assertProcess(result, label, expectedStdout) {
  if (
    result.error ||
    result.signal !== null ||
    result.status !== 0 ||
    result.stderr !== '' ||
    result.stdout !== expectedStdout
  ) {
    throw new Error(`Packed ${label} failed: ${formatProcessFailure(result)}`);
  }
}

function runCommand(command, args, cwd, label) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 120_000,
  });
  if (result.error || result.signal !== null || result.status !== 0) {
    throw new Error(`Packed server consumer ${label} failed: ${formatProcessFailure(result)}`);
  }
  return result;
}

function formatProcessFailure(result) {
  if (result.error) return result.error.message;
  const output = [result.stdout?.trim(), result.stderr?.trim()].filter(Boolean).join('\n');
  return output || result.signal || `exit ${String(result.status)}`;
}

function compareStrings(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

if (isMainEntry(import.meta.url)) await runGate(checkPackedServerConsumer);
