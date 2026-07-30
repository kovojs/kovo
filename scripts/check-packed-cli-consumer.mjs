#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import ts from 'typescript';

import { isMainEntry, runGate } from './lib/cli-entry.mjs';
import {
  packageSubjectFromSnapshotKey,
  parsePnpmSnapshotDependencies,
} from './lib/pnpm-lock-packages.mjs';
import {
  validatePackedReleaseManifest,
  verifyPackedAttestation,
} from './publish-packed-packages.mjs';
import { manifestPath, releasePackages, repoRoot } from './release-packages.mjs';
import { parsePnpmAuditResult } from './supply-chain-gates.mjs';

export const forbiddenPackedCliDependencies = Object.freeze([
  '@hono/node-server',
  '@modelcontextprotocol/sdk',
  'ajv',
  'body-parser',
  'express',
  'fast-uri',
  'hono',
]);

const expectedMcpTools = Object.freeze([
  'compile_component',
  'kovo_check',
  'kovo_docs',
  'kovo_explain',
  'list_diagnostics',
]);
const expectedApiV1Batches = Object.freeze([
  'core-task-topology-v1',
  'style-opaque-handles',
  'ui-headless-icons-v1',
  'browser-client-installer-v1',
  'browser-authoring-v1',
  'browser-inline-optimism-v1',
  'server-task-topology-v1',
  'test-harness-v2',
  'drizzle-typed-annotations-v1',
  'better-auth-generated-assembly-v1',
]);
const apiV1RewriteFixtures = Object.freeze([
  'core-task-topology-v1/task-imports.input.ts',
  'style-opaque-handles/style-record.input.ts',
  'ui-headless-icons-v1/icon-render-result.input.ts',
  'browser-client-installer-v1/install.input.ts',
  'browser-authoring-v1/trust-reason.input.ts',
  'server-task-topology-v1/task-imports.input.ts',
  'drizzle-typed-annotations-v1/schema.input.ts',
  'better-auth-generated-assembly-v1/generated-bindings.input.ts',
]);
const apiV1RefusalFixtures = Object.freeze([
  'core-task-topology-v1/registry.refusal.ts',
  'style-opaque-handles/create-theme.refusal.ts',
  'ui-headless-icons-v1/headless-helper.refusal.ts',
  'ui-headless-icons-v1/ui-root.refusal.ts',
  'browser-client-installer-v1/manual-assembly.refusal.ts',
  'browser-authoring-v1/derive-strings.refusal.ts',
  'browser-authoring-v1/missing-metadata.refusal.ts',
  'browser-inline-optimism-v1/optimistic-for.refusal.ts',
  'browser-inline-optimism-v1/optimistic-plan.refusal.ts',
  'browser-inline-optimism-v1/query-support.refusal.ts',
  'server-task-topology-v1/internal-carrier.refusal.ts',
  'test-harness-v2/legacy-harness.refusal.ts',
  'drizzle-typed-annotations-v1/runtime-metadata.refusal.ts',
  'better-auth-generated-assembly-v1/internal-carrier.refusal.ts',
]);

export function productionDependencyNamesFromLockfile(lockfileText) {
  const { findings, snapshots } = parsePnpmSnapshotDependencies(lockfileText, {
    lockfilePath: 'packed-consumer/pnpm-lock.yaml',
  });
  if (findings.length > 0) {
    throw new Error(`Packed CLI consumer lockfile is invalid:\n  ${findings.join('\n  ')}`);
  }
  return [
    ...new Set(
      [...snapshots.keys()]
        .map((key) => packageSubjectFromSnapshotKey(key)?.dependency)
        .filter((name) => name !== undefined),
    ),
  ].sort(compareStrings);
}

export function assertPackedCliDependencyClosure(lockfileText) {
  const names = new Set(productionDependencyNamesFromLockfile(lockfileText));
  const present = forbiddenPackedCliDependencies.filter((name) => names.has(name));
  if (present.length > 0) {
    throw new Error(
      `Packed CLI production graph contains the removed MCP SDK subtree: ${present.join(', ')}`,
    );
  }
}

export function assertPackedMcpLifecycle(stdout) {
  let responses;
  try {
    responses = stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    throw new Error('Packed kovo mcp emitted non-NDJSON stdout');
  }
  if (
    responses.length !== 2 ||
    responses[0]?.id !== 1 ||
    responses[0]?.result?.protocolVersion !== '2025-11-25' ||
    responses[1]?.id !== 2 ||
    !Array.isArray(responses[1]?.result?.tools)
  ) {
    throw new Error('Packed kovo mcp did not complete the finite lifecycle');
  }
  const toolNames = responses[1].result.tools
    .map((tool) => tool?.name)
    .filter((name) => typeof name === 'string')
    .sort(compareStrings);
  if (JSON.stringify(toolNames) !== JSON.stringify(expectedMcpTools)) {
    throw new Error(`Packed kovo mcp tool vocabulary drifted: ${JSON.stringify(toolNames)}`);
  }
}

export function assertPackedDocsJourney(updateStdout, docsStdout, consumerRoot) {
  if (
    !/^kovo-update-docs\/v1\nOK source=installed-package version=[^\s]+ files=\d+\nOK snapshot=sha256:[a-f0-9]{64} current=\.kovo\/docs\/current\.json\n$/u.test(
      updateStdout,
    )
  ) {
    throw new Error('Packed kovo update-docs did not authenticate and select its bundled snapshot');
  }

  let payload;
  try {
    payload = JSON.parse(docsStdout);
  } catch {
    throw new Error('Packed kovo docs emitted non-JSON output for --format json');
  }
  if (
    payload?.version !== 'kovo-docs/v1' ||
    !Array.isArray(payload.results) ||
    payload.results.length === 0 ||
    payload.results.length > 5
  ) {
    throw new Error('Packed kovo docs did not return a bounded kovo-docs/v1 result');
  }

  const snapshotDigests = new Set();
  for (const result of payload.results) {
    if (
      typeof result?.path !== 'string' ||
      result.path.startsWith('/') ||
      result.path.split('/').includes('..') ||
      typeof result.excerpt !== 'string' ||
      result.excerpt.length === 0 ||
      result.excerpt.includes('Bundled starter placeholder') ||
      !/^sha256:[a-f0-9]{64}$/u.test(result.sha256) ||
      !/^sha256:[a-f0-9]{64}$/u.test(result.snapshotDigest) ||
      typeof result.version !== 'string' ||
      result.version.length === 0
    ) {
      throw new Error('Packed kovo docs returned malformed, unsafe, or placeholder content');
    }
    snapshotDigests.add(result.snapshotDigest);
  }
  if (snapshotDigests.size !== 1) {
    throw new Error('Packed kovo docs mixed results from more than one authenticated snapshot');
  }

  const pointer = JSON.parse(
    readFileSync(path.join(consumerRoot, '.kovo', 'docs', 'current.json'), 'utf8'),
  );
  const [snapshotDigest] = snapshotDigests;
  if (pointer?.snapshotDigest !== snapshotDigest) {
    throw new Error('Packed kovo docs result does not match the selected snapshot pointer');
  }
  const agents = readFileSync(path.join(consumerRoot, 'AGENTS.md'), 'utf8');
  const digestDirectory = snapshotDigest.slice('sha256:'.length);
  if (
    !agents.includes(`./.kovo/docs/snapshots/${digestDirectory}/kovo-rules.md`) ||
    agents.includes('Bundled starter placeholder')
  ) {
    throw new Error('Packed kovo update-docs did not install authenticated agent instructions');
  }
}

export function assertPackedCliProcessContract(observations) {
  const informational = [
    ['kovo', observations.root],
    ['kovo --help', observations.rootHelp],
    ['kovo help', observations.help],
    ['kovo build --help', observations.buildHelp],
    ['kovo --version', observations.version],
  ];
  for (const [label, result] of informational) {
    assertCompletedProcess(result, label);
    if (result.status !== 0 || result.stderr !== '' || result.stdout.length === 0) {
      const detail = [result.stderr, result.stdout].filter(Boolean).join('\n').trim();
      throw new Error(
        `Packed ${label} must exit 0 with stdout only; observed status=${String(result.status)}${detail ? `:\n${detail}` : ''}`,
      );
    }
  }
  if (
    observations.root.stdout !== observations.rootHelp.stdout ||
    observations.root.stdout !== observations.help.stdout
  ) {
    throw new Error('Packed root help paths do not render the same schema-owned output');
  }
  if (
    !observations.buildHelp.stdout.includes('kovo build') ||
    !observations.buildHelp.stdout.includes('Exit codes:')
  ) {
    throw new Error('Packed command help is missing generated usage or exit behavior');
  }
  if (!/^kovo \d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?\n$/u.test(observations.version.stdout)) {
    throw new Error('Packed kovo --version output is not the installed semantic version');
  }

  for (const [label, result] of [
    ['unknown command', observations.usage],
    ['invalid config', observations.config],
    ['invalid compile config', observations.compileConfig],
  ]) {
    assertCompletedProcess(result, label);
    if (result.status !== 2 || result.stdout !== '' || result.stderr.length === 0) {
      throw new Error(
        `Packed ${label} must exit 2 with stderr only; observed status=${String(result.status)}`,
      );
    }
  }
  assertCompletedProcess(observations.finding, 'proof finding');
  if (
    observations.finding.status !== 1 ||
    observations.finding.stdout !== '' ||
    observations.finding.stderr.length === 0
  ) {
    throw new Error(
      `Packed proof finding must exit 1 with stderr only; observed status=${String(observations.finding.status)}`,
    );
  }
}

export function assertPackedSemanticApiBoundary(stdout) {
  if (stdout !== 'packed-semantic-api-boundary/v1 OK\n') {
    throw new Error('Packed semantic CLI API did not reject caller execution before lockdown');
  }
}

export async function checkPackedCliConsumer({ apiV1Only = false } = {}) {
  const rootManifest = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  const packedManifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const packedPackages = validatePackedReleaseManifest(packedManifest, releasePackages());
  for (const pkg of packedPackages) {
    verifyPackedAttestation(pkg, path.resolve(repoRoot, pkg.tarball));
  }

  const consumerRoot = mkdtempSync(path.join(os.tmpdir(), 'kovo-packed-cli-consumer-'));
  try {
    writeFileSync(
      path.join(consumerRoot, 'package.json'),
      `${JSON.stringify(
        packedCliConsumerManifest(packedPackages, rootManifest.packageManager),
        null,
        2,
      )}\n`,
      'utf8',
    );
    runCommand(
      'pnpm',
      ['install', '--prod', '--ignore-scripts', '--no-frozen-lockfile'],
      consumerRoot,
      'install',
    );

    const lockfileText = readFileSync(path.join(consumerRoot, 'pnpm-lock.yaml'), 'utf8');
    assertPackedCliDependencyClosure(lockfileText);
    writeFileSync(
      path.join(consumerRoot, 'component.tsx'),
      'export const Component = () => null;\n',
      'utf8',
    );

    if (apiV1Only) {
      assertPackedApiV1MigrationJourney(consumerRoot);
      console.log('Packed CLI cumulative api-v1 migration consumer passed.');
      return;
    }

    assertPackedCliProcessContract({
      buildHelp: captureCommand('pnpm', ['exec', 'kovo', 'build', '--help'], consumerRoot),
      config: captureCommand(
        'pnpm',
        ['exec', 'kovo', 'db', 'check', '--schema', 'missing-schema.ts'],
        consumerRoot,
      ),
      compileConfig: captureCommand(
        'pnpm',
        [
          'exec',
          'kovo',
          'compile',
          'component',
          'component.tsx',
          '--out',
          'component.generated.tsx',
          '--registry-facts',
          'missing-registry-facts.json',
          '--check',
        ],
        consumerRoot,
      ),
      finding: captureCommand(
        'pnpm',
        ['exec', 'kovo', 'check', 'missing-graph.json'],
        consumerRoot,
      ),
      help: captureCommand('pnpm', ['exec', 'kovo', 'help'], consumerRoot),
      root: captureCommand('pnpm', ['exec', 'kovo'], consumerRoot),
      rootHelp: captureCommand('pnpm', ['exec', 'kovo', '--help'], consumerRoot),
      usage: captureCommand('pnpm', ['exec', 'kovo', 'not-a-command'], consumerRoot),
      version: captureCommand('pnpm', ['exec', 'kovo', '--version'], consumerRoot),
    });

    writeFileSync(
      path.join(consumerRoot, 'semantic-api-boundary.mjs'),
      semanticApiBoundarySource(),
      'utf8',
    );
    const semanticApiBoundary = runCommand(
      'node',
      ['semantic-api-boundary.mjs'],
      consumerRoot,
      'semantic API bootstrap boundary',
    );
    assertPackedSemanticApiBoundary(semanticApiBoundary.stdout);

    const updateDocs = runCommand(
      'pnpm',
      ['exec', 'kovo', 'update-docs'],
      consumerRoot,
      'authenticated docs install',
    );
    const docs = runCommand(
      'pnpm',
      ['exec', 'kovo', 'docs', 'quickstart', '--format', 'json'],
      consumerRoot,
      'bounded local docs retrieval',
    );
    assertPackedDocsJourney(updateDocs.stdout, docs.stdout, consumerRoot);
    assertPackedComponentCatalogJourney(consumerRoot);
    assertPackedApiV1MigrationJourney(consumerRoot);

    const lifecycle = runCommand(
      'pnpm',
      ['exec', 'kovo', 'mcp'],
      consumerRoot,
      'finite MCP lifecycle',
      finiteMcpLifecycleInput(),
    );
    assertPackedMcpLifecycle(lifecycle.stdout);
    await assertPackedDevJourney(consumerRoot);

    const auditResult = spawnSync('pnpm', ['audit', '--prod', '--json'], {
      cwd: consumerRoot,
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const audit = parsePnpmAuditResult(auditResult);
    const advisories = Object.values(audit.advisories);
    if (advisories.length > 0) {
      throw new Error(
        `Packed CLI consumer audit reported ${advisories
          .map((advisory) => `${advisory.severity} ${advisory.module_name}`)
          .join(', ')}`,
      );
    }

    process.stdout.write(
      `Packed CLI consumer passed (${audit.metadata.dependencies} production dependencies, zero advisories).\n`,
    );
  } finally {
    rmSync(consumerRoot, { force: true, recursive: true });
  }
}

export function assertPackedComponentCatalogJourney(consumerRoot, { run = runCommand } = {}) {
  const uiRoot = path.join(consumerRoot, 'node_modules', '@kovojs', 'ui');
  const iconsRoot = path.join(consumerRoot, 'node_modules', '@kovojs', 'icons');
  const uiManifest = JSON.parse(readFileSync(path.join(uiRoot, 'package.json'), 'utf8'));
  const uiCatalog = JSON.parse(readFileSync(path.join(uiRoot, 'catalog.json'), 'utf8'));
  const uiRegistry = JSON.parse(readFileSync(path.join(uiRoot, 'registry.json'), 'utf8'));
  const iconCatalog = JSON.parse(readFileSync(path.join(iconsRoot, 'catalog.json'), 'utf8'));
  if (Object.hasOwn(uiManifest.exports ?? {}, '.')) {
    throw new Error('Packed @kovojs/ui unexpectedly exposes an empty root entry');
  }
  if (
    uiCatalog?.schema !== 'kovo-component-catalog/v1' ||
    uiCatalog.entries?.length !== 44 ||
    uiRegistry.components?.length !== 44 ||
    iconCatalog?.schema !== 'kovo-component-catalog/v1' ||
    iconCatalog.entries?.length !== 1_737
  ) {
    throw new Error('Packed component/icon catalogs do not cover 44 components and 1737 glyphs');
  }

  const componentNames = uiCatalog.entries.map((entry) => entry.name);
  const outDir = path.join(consumerRoot, 'src', 'components', 'ui');
  const result = run(
    'pnpm',
    ['exec', 'kovo', 'add', ...componentNames, '--out', outDir],
    consumerRoot,
    'all-44 component copy-in',
  );
  if (!result.stdout.includes('SUMMARY total=44')) {
    throw new Error('Packed kovo add did not report all 44 copied components');
  }
  for (const component of componentNames) {
    const source = readFileSync(path.join(outDir, `${component}.tsx`), 'utf8');
    if (sourceImportsPackage(source, '@kovojs/ui')) {
      throw new Error(`Packed copied ${component}.tsx recursively imports @kovojs/ui`);
    }
  }
  const card = readFileSync(path.join(outDir, 'card.tsx'), 'utf8');
  for (const symbol of [
    'Card',
    'CardHeader',
    'CardTitle',
    'CardDescription',
    'CardContent',
    'CardFooter',
  ]) {
    if (!card.includes(`export const ${symbol} = component({`)) {
      throw new Error(`Packed copied Card anatomy is missing ${symbol}`);
    }
  }
}

export function sourceImportsPackage(source, packageName) {
  return ts
    .preProcessFile(source, true, true)
    .importedFiles.some(
      ({ fileName }) => fileName === packageName || fileName.startsWith(`${packageName}/`),
    );
}

export function assertPackedApiV1MigrationJourney(consumerRoot, { capture = captureCommand } = {}) {
  const fixturesRoot = path.join(repoRoot, 'scripts', 'fixtures', 'api-migrations');
  const rewriteRoot = path.join(consumerRoot, 'api-v1-rewrites');
  mkdirSync(rewriteRoot, { recursive: true });
  const originals = new Map();
  for (const [index, fixture] of apiV1RewriteFixtures.entries()) {
    const target = path.join(rewriteRoot, `${String(index).padStart(2, '0')}.ts`);
    const source = readFileSync(path.join(fixturesRoot, fixture), 'utf8');
    writeFileSync(target, source, 'utf8');
    originals.set(target, source);
  }

  const checked = capture(
    'pnpm',
    ['exec', 'kovo', 'fix', 'api-v1', 'api-v1-rewrites', '--check'],
    consumerRoot,
  );
  const checkedResult = parsePackedApiV1Result(checked, 1, 'rewrite check');
  assertPackedApiV1Result(checkedResult, {
    refused: 0,
    rewritten: apiV1RewriteFixtures.length,
    unchanged: 0,
  });
  for (const [target, source] of originals) {
    if (readFileSync(target, 'utf8') !== source) {
      throw new Error('Packed kovo fix api-v1 --check changed a rewrite fixture');
    }
  }

  const written = capture(
    'pnpm',
    ['exec', 'kovo', 'fix', 'api-v1', 'api-v1-rewrites', '--write'],
    consumerRoot,
  );
  const writtenResult = parsePackedApiV1Result(written, 0, 'rewrite write');
  assertPackedApiV1Result(writtenResult, {
    refused: 0,
    rewritten: apiV1RewriteFixtures.length,
    unchanged: 0,
  });
  for (const [target, source] of originals) {
    if (readFileSync(target, 'utf8') === source) {
      throw new Error(`Packed kovo fix api-v1 did not rewrite ${path.basename(target)}`);
    }
  }

  const idempotent = capture(
    'pnpm',
    ['exec', 'kovo', 'fix', 'api-v1', 'api-v1-rewrites', '--check'],
    consumerRoot,
  );
  const idempotentResult = parsePackedApiV1Result(idempotent, 0, 'idempotence check');
  assertPackedApiV1Result(idempotentResult, {
    refused: 0,
    rewritten: 0,
    unchanged: apiV1RewriteFixtures.length,
  });

  const refusalRoot = path.join(consumerRoot, 'api-v1-refusals');
  mkdirSync(refusalRoot, { recursive: true });
  const refusalOriginals = new Map();
  for (const [index, fixture] of apiV1RefusalFixtures.entries()) {
    const target = path.join(refusalRoot, `${String(index).padStart(2, '0')}.ts`);
    const source = readFileSync(path.join(fixturesRoot, fixture), 'utf8');
    writeFileSync(target, source, 'utf8');
    refusalOriginals.set(target, source);
  }
  const transactionProbe = path.join(refusalRoot, 'rewrite-probe.ts');
  const transactionProbeSource = readFileSync(
    path.join(fixturesRoot, apiV1RewriteFixtures[1]),
    'utf8',
  );
  writeFileSync(transactionProbe, transactionProbeSource, 'utf8');

  const refused = capture(
    'pnpm',
    ['exec', 'kovo', 'fix', 'api-v1', 'api-v1-refusals', '--write'],
    consumerRoot,
  );
  const refusedResult = parsePackedApiV1Result(refused, 1, 'refusal transaction');
  if (
    refusedResult.summary.refused !== apiV1RefusalFixtures.length ||
    refusedResult.summary.rewritten !== 1 ||
    readFileSync(transactionProbe, 'utf8') !== transactionProbeSource
  ) {
    throw new Error('Packed kovo fix api-v1 did not keep a refused batch transaction read-only');
  }
  for (const [target, source] of refusalOriginals) {
    if (readFileSync(target, 'utf8') !== source) {
      throw new Error(`Packed kovo fix api-v1 changed refused source ${path.basename(target)}`);
    }
  }
  for (const file of refusedResult.files.filter((entry) => entry.state === 'refused')) {
    if (
      !Array.isArray(file.refusals) ||
      file.refusals.length === 0 ||
      file.refusals.some(
        (refusal) =>
          !expectedApiV1Batches.includes(refusal.batch) ||
          typeof refusal.category !== 'string' ||
          refusal.category.length === 0 ||
          typeof refusal.reason !== 'string' ||
          refusal.reason.length === 0 ||
          typeof refusal.manualAction !== 'string' ||
          !refusal.manualAction.includes('kovo fix api-v1 --check') ||
          !Number.isInteger(refusal.anchor?.start) ||
          !Number.isInteger(refusal.anchor?.end) ||
          refusal.anchor.start < 0 ||
          refusal.anchor.end < refusal.anchor.start,
      )
    ) {
      throw new Error(`Packed kovo fix api-v1 emitted a non-actionable refusal for ${file.path}`);
    }
  }
}

export function assertPackedApiV1Result(result, expectedSummary) {
  if (
    result?.schema !== 'kovo-api-migration-result/v1' ||
    result?.batch !== 'api-v1' ||
    JSON.stringify(result.migrationBatches) !== JSON.stringify(expectedApiV1Batches) ||
    !Array.isArray(result.files) ||
    result.summary?.rewritten !== expectedSummary.rewritten ||
    result.summary?.unchanged !== expectedSummary.unchanged ||
    result.summary?.refused !== expectedSummary.refused ||
    result.files.length !==
      expectedSummary.rewritten + expectedSummary.unchanged + expectedSummary.refused
  ) {
    throw new Error('Packed kovo fix api-v1 result drifted from the checked cumulative protocol');
  }
}

function parsePackedApiV1Result(processResult, expectedStatus, label) {
  assertCompletedProcess(processResult, `api-v1 ${label}`);
  if (
    processResult.status !== expectedStatus ||
    processResult.stderr !== '' ||
    processResult.stdout.length === 0
  ) {
    const detail = [processResult.stderr, processResult.stdout].filter(Boolean).join('\n').trim();
    const contract = JSON.stringify({
      expectedStatus,
      status: processResult.status,
      stderr: processResult.stderr,
      stdoutLength: processResult.stdout.length,
    });
    throw new Error(
      `Packed kovo fix api-v1 ${label} expected status ${String(expectedStatus)} with JSON stdout only; observed ${contract}${detail ? `:\n${detail}` : ''}`,
    );
  }
  try {
    return JSON.parse(processResult.stdout);
  } catch {
    throw new Error(`Packed kovo fix api-v1 ${label} emitted non-JSON stdout`);
  }
}

function semanticApiBoundarySource() {
  return `import { runKovoCommand } from '@kovojs/cli';

let accessorRan = false;
const accessorRequest = {
  arguments: {},
  form: 'graph',
  options: {},
};
Object.defineProperty(accessorRequest, 'command', {
  enumerable: true,
  get() {
    accessorRan = true;
    const nativeFind = Array.prototype.find;
    Array.prototype.find = function interceptedFind(...args) {
      Array.prototype.find = nativeFind;
      return Reflect.apply(nativeFind, this, args);
    };
    return 'check';
  },
});
await runKovoCommand(accessorRequest).then(
  () => { throw new Error('accessor request was accepted'); },
  (error) => {
    if (!(error instanceof TypeError)) throw error;
  },
);
if (accessorRan) throw new Error('semantic request accessor ran before lockdown');

let proxyTrapped = false;
const proxyRequest = new Proxy(
  { arguments: {}, command: 'check', form: 'graph', options: {} },
  {
    get() {
      proxyTrapped = true;
      throw new Error('proxy get trap ran');
    },
    getOwnPropertyDescriptor() {
      proxyTrapped = true;
      throw new Error('proxy descriptor trap ran');
    },
    ownKeys() {
      proxyTrapped = true;
      throw new Error('proxy ownKeys trap ran');
    },
  },
);
await runKovoCommand(proxyRequest).then(
  () => { throw new Error('proxy request was accepted'); },
  (error) => {
    if (!(error instanceof TypeError)) throw error;
  },
);
if (proxyTrapped) throw new Error('semantic request proxy trap ran before lockdown');

const exit = await runKovoCommand({
  arguments: { appModule: './definitely-missing-app.tsx' },
  command: 'build',
  form: 'build',
  options: { check: true },
});
if (exit !== 1 && exit !== 2) throw new Error('semantic build returned an invalid exit');
process.stdout.write('packed-semantic-api-boundary/v1 OK\\n');
`;
}

function packedCliConsumerManifest(packedPackages, packageManager) {
  const tarballs = Object.fromEntries(
    packedPackages.map((pkg) => [
      pkg.name,
      pathToFileURL(path.resolve(repoRoot, pkg.tarball)).href,
    ]),
  );
  const cliTarball = tarballs['@kovojs/cli'];
  const iconsTarball = tarballs['@kovojs/icons'];
  const serverTarball = tarballs['@kovojs/server'];
  const styleTarball = tarballs['@kovojs/style'];
  const uiTarball = tarballs['@kovojs/ui'];
  if (cliTarball === undefined) throw new Error('Packed release manifest is missing @kovojs/cli');
  if (iconsTarball === undefined) {
    throw new Error('Packed release manifest is missing @kovojs/icons');
  }
  if (serverTarball === undefined) {
    throw new Error('Packed release manifest is missing @kovojs/server');
  }
  if (styleTarball === undefined) {
    throw new Error('Packed release manifest is missing @kovojs/style');
  }
  if (uiTarball === undefined) throw new Error('Packed release manifest is missing @kovojs/ui');
  return {
    dependencies: {
      '@kovojs/cli': cliTarball,
      '@kovojs/icons': iconsTarball,
      '@kovojs/server': serverTarball,
      '@kovojs/style': styleTarball,
      '@kovojs/ui': uiTarball,
    },
    name: 'kovo-packed-cli-consumer',
    packageManager,
    pnpm: { overrides: tarballs },
    private: true,
    version: '0.0.0',
  };
}

async function assertPackedDevJourney(consumerRoot) {
  mkdirSync(path.join(consumerRoot, 'src'), { recursive: true });
  writeFileSync(
    path.join(consumerRoot, 'src', 'app.ts'),
    `import '@kovojs/server/runtime-bootstrap';
import { defineKovo } from '@kovojs/server';

const app = defineKovo({ appId: '00000000-0000-4000-8000-000000000001' });
const home = app.route('/', {
  access: app.publicAccess('packed devtool smoke'),
  page: () => '<main>Packed dev ready</main>',
});

export default app.assemble({ routes: [home] });
`,
    'utf8',
  );

  const child = spawn(
    process.execPath,
    [
      path.join(consumerRoot, 'node_modules', '@kovojs', 'cli', 'dist', 'bin.mjs'),
      'dev',
      './src/app.ts',
      '--root',
      consumerRoot,
      '--host',
      '127.0.0.1',
      '--port',
      '0',
      '--strict-port',
    ],
    {
      cwd: consumerRoot,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    stdout += String(chunk);
  });
  child.stderr.on('data', (chunk) => {
    stderr += String(chunk);
  });

  try {
    const localUrl = await waitForPackedDevReady(
      () => ({ stderr, stdout }),
      () => child.exitCode,
    );
    const page = await fetch(`${localUrl}__kovo`);
    const html = await page.text();
    if (
      page.status !== 200 ||
      !html.includes('<title>Kovo Dataflow Devtool</title>') ||
      !html.includes('live closed createApp() runtime registry')
    ) {
      throw new Error(
        `Packed kovo dev did not serve its devtool page (${page.status}).\n${stdout}\n${stderr}`,
      );
    }
    const cookie = page.headers.get('set-cookie')?.split(';', 1)[0];
    if (cookie === undefined) {
      throw new Error('Packed kovo dev did not mint its browser authentication cookie');
    }
    const client = await fetch(`${localUrl}__kovo/client.js`, {
      headers: { Cookie: cookie },
    });
    const clientSource = await client.text();
    if (client.status !== 200 || !clientSource.includes('const kovoDevtoolInit = function')) {
      throw new Error(
        `Packed kovo dev did not serve its bundled client island (${client.status}).\n${stdout}\n${stderr}`,
      );
    }
  } finally {
    await stopPackedDev(child);
  }
}

async function waitForPackedDevReady(output, exitCode) {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    const current = output();
    const match = /Local URL\s+(http:\/\/127\.0\.0\.1:(?!0\/)\d+\/)/u.exec(current.stdout);
    if (match?.[1] !== undefined) return match[1];
    if (exitCode() !== null) {
      throw new Error(
        `Packed kovo dev exited before readiness.\n${current.stdout}\n${current.stderr}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const current = output();
  throw new Error(`Packed kovo dev readiness timed out.\n${current.stdout}\n${current.stderr}`);
}

async function stopPackedDev(child) {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (child.exitCode === null) child.kill('SIGKILL');
      resolve();
    }, 5_000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function finiteMcpLifecycleInput() {
  return `${[
    {
      id: 1,
      jsonrpc: '2.0',
      method: 'initialize',
      params: {
        capabilities: {},
        clientInfo: { name: 'packed-consumer', version: '1.0.0' },
        protocolVersion: '2025-11-25',
      },
    },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { id: 2, jsonrpc: '2.0', method: 'tools/list' },
  ]
    .map((message) => JSON.stringify(message))
    .join('\n')}\n`;
}

function runCommand(command, args, cwd, label, input) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    input,
    maxBuffer: 16 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  if (result.error || result.signal || result.status !== 0) {
    const detail = [result.stderr, result.stdout].filter(Boolean).join('\n').trim();
    throw new Error(
      `Packed CLI consumer ${label} failed${result.status === null ? '' : ` with status ${result.status}`}: ${detail || result.error?.message || '<no output>'}`,
    );
  }
  return result;
}

function captureCommand(command, args, cwd) {
  return spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function assertCompletedProcess(result, label) {
  if (result?.error || result?.signal || typeof result?.status !== 'number') {
    throw new Error(
      `Packed ${label} did not complete normally: ${result?.error?.message ?? result?.signal ?? '<no status>'}`,
    );
  }
}

function compareStrings(left, right) {
  return left.localeCompare(right);
}

if (isMainEntry(import.meta.url)) {
  const args = process.argv.slice(2);
  const unsupported = args.filter((arg) => arg !== '--api-v1-only');
  if (unsupported.length > 0) {
    throw new Error(`Unsupported packed CLI consumer option: ${unsupported.join(', ')}`);
  }
  await runGate(() => checkPackedCliConsumer({ apiV1Only: args.includes('--api-v1-only') }));
}
