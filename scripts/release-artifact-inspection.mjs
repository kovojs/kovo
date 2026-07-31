#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import ts from 'typescript';

import { authenticatedPackedJourneyPackages } from './golden-journey.mjs';
import {
  declareJourneyProductionRetention,
  materializePackedPackage,
  rewriteScaffoldDependenciesToPackedTarballs,
  sanitizeDiagnosticResponseHeaders,
  sanitizeMarkupPreview,
} from './golden-journey/packed-app.mjs';
import { isMainEntry, runGate } from './lib/cli-entry.mjs';
import { manifestPath as defaultPackedManifest, repoRoot } from './release-packages.mjs';

export const RELEASE_ARTIFACT_INSPECTION_SCHEMA = 'kovo.release-artifact-inspection/v1';
export const APP_COMPONENT_SOURCE_CENSUS_SCHEMA = 'kovo.app-component-source-census/v1';
export const BUILT_ARTIFACT_INSPECTION_SCHEMA = 'kovo.built-artifact-inspection/v1';
export const RUNTIME_WIRE_INSPECTION_SCHEMA = 'kovo.runtime-wire-inspection/v1';

const DIAGNOSTIC_ENVELOPE_VERSION = 'kovo-diagnostic/v1';
const CHECK_PROTOCOL = 'kovo-check/v1';
const GRAPH_PROVENANCE_SCHEMA = 'kovo.artifact.provenance/v1';
const GRAPH_SCHEMA = 'kovo.graph/v2';
const SECURITY_GUARANTEE_SCHEMA = 'kovo.security.guarantees/v1';
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const BUILD_TOKEN_PATTERN = /^[0-9a-f]{64}$/u;
const COMMAND_TIMEOUT_MS = 10 * 60 * 1_000;
const SERVER_READY_TIMEOUT_MS = 90_000;
const MAX_COMMAND_OUTPUT_BYTES = 64 * 1024 * 1024;
const MAX_INSPECTED_FILE_BYTES = 64 * 1024 * 1024;
const MAX_INSPECTED_TREE_BYTES = 512 * 1024 * 1024;
const MAX_INSPECTED_FILES = 16_384;
const APP_COMPONENT_SOURCE_ROOTS = Object.freeze([
  'benchmarks/kovo',
  'examples',
  'packages/create-kovo/templates',
  'scripts/devex-workloads',
  'security/fixtures',
  'site/recipes/golden',
  'site/src',
  'site/tutorial',
  'tests/integration/fixtures',
]);
const APP_SOURCE_EXTENSION_PATTERN = /\.(?:[cm]?[jt]sx?)$/u;
const COMPONENT_AUTHORING_EXTENSION_PATTERN = /\.(?:tsx|jsx)$/u;
const JAVASCRIPT_MODULE_EXTENSION_PATTERN = /\.(?:mjs|js)$/u;
const CSS_EXTENSION_PATTERN = /\.css$/u;
const LOWERED_IR_HEADER_PATTERN = /^(?:\/\/|\/\*)\s*@kovojs-ir\b/u;
const REQUIRED_GRAPH_PACKAGES = Object.freeze([
  '@kovojs/cli',
  '@kovojs/compiler',
  '@kovojs/core',
  '@kovojs/server',
]);

export function parseReleaseArtifactInspectionArgs(argv) {
  let packedManifest = defaultPackedManifest;
  let output = path.join(repoRoot, '.release', 'final-artifact-inspection');
  let temporaryParent = tmpdir();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token !== '--packed-manifest' && token !== '--output' && token !== '--temporary-parent') {
      throw new Error(`Unknown release-artifact-inspection argument ${JSON.stringify(token)}.`);
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('-')) throw new Error(`${token} requires a value.`);
    index += 1;
    if (token === '--packed-manifest') packedManifest = path.resolve(repoRoot, value);
    if (token === '--output') output = path.resolve(repoRoot, value);
    if (token === '--temporary-parent') temporaryParent = path.resolve(repoRoot, value);
  }
  return Object.freeze({
    output,
    packedManifest: path.resolve(packedManifest),
    temporaryParent: path.resolve(temporaryParent),
  });
}

export async function runReleaseArtifactInspection(argv = process.argv.slice(2)) {
  const options = parseReleaseArtifactInspectionArgs(argv);
  if (existsSync(options.output)) {
    throw new Error(`release inspection output already exists: ${options.output}`);
  }
  requireCleanTrackedSource(repoRoot);
  const packedPackages = authenticatedPackedJourneyPackages(options.packedManifest);
  const sourceCommit = gitOutput(['rev-parse', 'HEAD'], repoRoot).trim();
  if (!/^[0-9a-f]{40}$/u.test(sourceCommit)) {
    throw new Error('release inspection requires an exact Git source commit');
  }

  mkdirSync(options.temporaryParent, { recursive: true });
  const temporaryRoot = mkdtempSync(
    path.join(options.temporaryParent, 'kovo-release-artifact-inspection-'),
  );
  const appRoot = path.join(temporaryRoot, 'app');
  const creatorRoot = path.join(temporaryRoot, 'creator');
  const storeRoot = path.join(temporaryRoot, 'pnpm-store');
  let stagingRoot;
  try {
    const commands = scaffoldAndBuildPackedApp({
      appRoot,
      creatorRoot,
      packedPackages,
      storeRoot,
      temporaryRoot,
    });
    const sourceCensus = censusTrackedAppComponents({
      root: repoRoot,
    });
    const artifact = inspectBuiltArtifact({
      distRoot: path.join(appRoot, 'dist'),
      packedPackages,
    });
    const runtime = await inspectProductionRuntime({ appRoot });
    const packageSubject = packedPackageSubject(packedPackages);
    const packedManifest = {
      bytes: statSync(options.packedManifest).size,
      path: path.relative(repoRoot, options.packedManifest).split(path.sep).join('/'),
      sha256: sha256(readFileSync(options.packedManifest)),
    };

    mkdirSync(path.dirname(options.output), { recursive: true });
    stagingRoot = mkdtempSync(
      path.join(path.dirname(options.output), '.release-artifact-inspection-staging-'),
    );
    const retained = retainInspectionEvidence({
      artifact,
      commands,
      runtime,
      stagingRoot,
    });
    const report = {
      schema: RELEASE_ARTIFACT_INSPECTION_SCHEMA,
      pass: true,
      sourceCommit,
      packedManifest,
      packageSubject,
      packages: [...packedPackages.values()]
        .map((pkg) => ({ name: pkg.name, sha512: pkg.sha512, version: pkg.version }))
        .sort(compareNamedRecords),
      commands: commands.summary,
      sourceCensus,
      artifact: artifact.report,
      runtime: runtime.report,
      retained,
    };
    const findings = validateReleaseArtifactInspectionReport(report);
    if (findings.length > 0) {
      throw new Error(`release artifact inspection report is invalid:\n- ${findings.join('\n- ')}`);
    }
    writeNewFile(path.join(stagingRoot, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
    renameSync(stagingRoot, options.output);
    stagingRoot = undefined;
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return report;
  } finally {
    if (stagingRoot !== undefined) rmSync(stagingRoot, { force: true, recursive: true });
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
}

function scaffoldAndBuildPackedApp({
  appRoot,
  creatorRoot,
  packedPackages,
  storeRoot,
  temporaryRoot,
}) {
  mkdirSync(path.join(creatorRoot, 'node_modules', '@kovojs'), { recursive: true });
  materializePackedPackage(
    packedPackages.get('create-kovo'),
    path.join(creatorRoot, 'node_modules', 'create-kovo'),
  );
  materializePackedPackage(
    packedPackages.get('@kovojs/core'),
    path.join(creatorRoot, 'node_modules', '@kovojs', 'core'),
  );
  const creator = path.join(creatorRoot, 'node_modules', 'create-kovo', 'dist', 'index.mjs');
  assertAuthenticatedInstalledEntry(packedPackages.get('create-kovo'), creator, 'dist/index.mjs');

  const create = runCommand(
    [
      process.execPath,
      creator,
      appRoot,
      '--name',
      'kovo-release-artifact-inspection',
      '--disable-git',
      '--postgres',
    ],
    { cwd: temporaryRoot, label: 'create' },
  );
  rewriteScaffoldDependenciesToPackedTarballs(appRoot, packedPackages);
  const install = runCommand(
    ['pnpm', 'install', '--ignore-workspace', '--no-frozen-lockfile', '--store-dir', storeRoot],
    { cwd: appRoot, label: 'install' },
  );

  const cliEntry = path.join(appRoot, 'node_modules', '@kovojs', 'cli', 'dist', 'bin.mjs');
  assertAuthenticatedInstalledEntry(packedPackages.get('@kovojs/cli'), cliEntry, 'dist/bin.mjs');
  const greenCheck = runCommand(
    [
      process.execPath,
      cliEntry,
      'check',
      'source',
      './src/app.tsx',
      '--no-cache',
      '--format',
      'json',
    ],
    { cwd: appRoot, label: 'check-green' },
  );
  if (greenCheck.stderr !== '') {
    throw new Error(
      `green packed source check emitted a non-JSON stderr side channel:\n${boundedText(greenCheck.stderr, 4_096)}`,
    );
  }
  const greenEnvelope = parseStructuredDiagnosticEnvelope(greenCheck.stdout, {
    expectedExitCode: 0,
    label: 'green source check',
  });
  if (greenEnvelope.diagnostics.length !== 0) {
    throw new Error('green packed source check emitted diagnostics');
  }

  const hostileSourcePath = path.join(appRoot, 'src', 'components', 'contacts.tsx');
  const originalComponentSource = readFileSync(hostileSourcePath, 'utf8');
  const serverImport = "import { mutationFormAttributes } from '@kovojs/server';\n";
  const localImports =
    "import { contactsQuery, type ContactListResult, type ContactRow } from '../queries.js';\n";
  if (
    !originalComponentSource.includes(serverImport) ||
    !originalComponentSource.includes(localImports)
  ) {
    throw new Error('packed starter contacts component no longer has the expected import anchors');
  }
  const hostileComponentSource = originalComponentSource
    .replace(
      serverImport,
      `${serverImport}import { jsx as releaseInspectionLoweredIr } from '@kovojs/server/jsx-runtime';\n`,
    )
    .replace(
      localImports,
      `${localImports}\nexport const releaseInspectionLoweredIrProof = releaseInspectionLoweredIr;\n`,
    );
  writeFileSync(hostileSourcePath, hostileComponentSource, 'utf8');
  let kv235Check;
  try {
    kv235Check = runCommand(
      [
        process.execPath,
        cliEntry,
        'check',
        'source',
        './src/app.tsx',
        '--no-cache',
        '--format',
        'json',
      ],
      { allowedExitCodes: [1], cwd: appRoot, label: 'check-kv235' },
    );
  } finally {
    writeFileSync(hostileSourcePath, originalComponentSource, 'utf8');
  }
  if (kv235Check.stdout !== '') {
    throw new Error(
      `KV235 packed source check emitted a non-JSON stdout side channel:\n${boundedText(kv235Check.stdout, 4_096)}`,
    );
  }
  const kv235Envelope = parseStructuredDiagnosticEnvelope(kv235Check.stderr, {
    expectedExitCode: 1,
    label: 'KV235 source check',
  });
  const kv235Diagnostics = kv235Envelope.diagnostics.filter(
    (diagnostic) => diagnostic.code === 'KV235',
  );
  if (
    kv235Diagnostics.length === 0 ||
    kv235Diagnostics.some(
      (diagnostic) =>
        typeof diagnostic.help !== 'string' ||
        !diagnostic.help.includes('TSX') ||
        !/SPEC(?:\.md)? §5\.2/u.test(diagnostic.help),
    )
  ) {
    throw new Error(
      `packed KV235 source check did not emit its structured TSX teaching diagnostic:\n${boundedText(JSON.stringify(kv235Envelope.diagnostics), 4_096)}`,
    );
  }

  declareJourneyProductionRetention(appRoot);
  const build = runCommand(['pnpm', 'run', 'build:prod'], {
    cwd: appRoot,
    label: 'build',
  });
  return Object.freeze({
    greenEnvelope,
    kv235Envelope,
    summary: Object.freeze(
      [create, install, greenCheck, kv235Check, build].map((command) => ({
        durationMs: command.durationMs,
        exitCode: command.exitCode,
        name: command.label,
        stderrSha256: sha256(command.stderr),
        stdoutSha256: sha256(command.stdout),
      })),
    ),
  });
}

export function censusTrackedAppComponents({
  readSource = (file) => readFileSync(file, 'utf8'),
  root = repoRoot,
  sourceRoots = APP_COMPONENT_SOURCE_ROOTS,
  trackedFiles,
} = {}) {
  const normalizedRoots = normalizeSourceRoots(sourceRoots);
  const files =
    trackedFiles === undefined
      ? trackedSourceFiles(root, normalizedRoots)
      : normalizeTrackedFiles(trackedFiles, normalizedRoots);
  if (files.length === 0) throw new Error('app-component census found no tracked app source');

  const rootsSeen = new Set();
  const components = [];
  const loweredIrFindings = [];
  let sourceFiles = 0;
  let sourceBytes = 0;
  for (const relative of files) {
    const matchedRoot = normalizedRoots.find(
      (sourceRoot) => relative === sourceRoot || relative.startsWith(`${sourceRoot}/`),
    );
    if (matchedRoot === undefined) {
      throw new Error(`tracked app source is outside the declared census roots: ${relative}`);
    }
    rootsSeen.add(matchedRoot);
    if (!APP_SOURCE_EXTENSION_PATTERN.test(relative)) continue;
    const absolute = path.join(root, ...relative.split('/'));
    const source = readSource(absolute, relative);
    if (typeof source !== 'string') throw new TypeError(`${relative}: source must be text`);
    sourceFiles += 1;
    sourceBytes += Buffer.byteLength(source);

    if (LOWERED_IR_HEADER_PATTERN.test(source)) {
      loweredIrFindings.push(`${relative}: app-authored source starts with compiler lowered IR`);
    }
    const syntax = componentSyntaxCensus(relative, source);
    if (syntax.componentCalls === 0) continue;
    if (!COMPONENT_AUTHORING_EXTENSION_PATTERN.test(relative)) {
      loweredIrFindings.push(
        `${relative}: ${String(syntax.componentCalls)} app component call(s) are not authored in TSX/JSX`,
      );
    }
    if (syntax.jsxNodes === 0) {
      loweredIrFindings.push(`${relative}: app component source contains no authored JSX`);
    }
    if (syntax.stringRenderReturns > 0) {
      loweredIrFindings.push(
        `${relative}: ${String(syntax.stringRenderReturns)} app component render return(s) hand-author string/lowered IR`,
      );
    }
    for (const specifier of moduleSpecifiers(relative, source)) {
      if (isForbiddenAppGeneratedSpecifier(specifier)) {
        loweredIrFindings.push(
          `${relative}: app component source imports compiler-owned ${specifier}`,
        );
      }
    }
    components.push({
      componentCalls: syntax.componentCalls,
      file: relative,
      jsxNodes: syntax.jsxNodes,
      sha256: sha256(source),
    });
  }

  for (const sourceRoot of normalizedRoots) {
    if (!rootsSeen.has(sourceRoot)) {
      throw new Error(`app-component census root has no tracked files: ${sourceRoot}`);
    }
  }
  if (loweredIrFindings.length > 0) {
    throw new Error(
      `SPEC.md §5.2 / KV235 app-component source census failed:\n- ${[...new Set(loweredIrFindings)]
        .sort(compareUtf8)
        .join('\n- ')}`,
    );
  }
  if (components.length === 0) throw new Error('app-component census found no component calls');
  components.sort((left, right) => compareUtf8(left.file, right.file));
  return Object.freeze({
    schema: APP_COMPONENT_SOURCE_CENSUS_SCHEMA,
    sourceRoots: normalizedRoots,
    trackedSourceFiles: sourceFiles,
    trackedSourceBytes: sourceBytes,
    componentFiles: components.length,
    componentCalls: components.reduce((total, entry) => total + entry.componentCalls, 0),
    components,
    findings: [],
    pass: true,
  });
}

function normalizeSourceRoots(sourceRoots) {
  if (!Array.isArray(sourceRoots) || sourceRoots.length === 0) {
    throw new TypeError('app-component source roots must be a non-empty array');
  }
  const normalized = sourceRoots.map((sourceRoot) => {
    if (
      typeof sourceRoot !== 'string' ||
      sourceRoot.length === 0 ||
      path.isAbsolute(sourceRoot) ||
      sourceRoot.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
    ) {
      throw new TypeError(`invalid app-component source root ${JSON.stringify(sourceRoot)}`);
    }
    return sourceRoot;
  });
  const unique = [...new Set(normalized)].sort(compareUtf8);
  if (unique.length !== normalized.length) {
    throw new TypeError('app-component source roots contain duplicates');
  }
  return Object.freeze(unique);
}

function trackedSourceFiles(root, sourceRoots) {
  const output = spawnSync('git', ['ls-files', '-z', '--', ...sourceRoots], {
    cwd: root,
    encoding: 'buffer',
    maxBuffer: MAX_COMMAND_OUTPUT_BYTES,
    timeout: 30_000,
  });
  if (output.status !== 0 || output.error) {
    throw new Error(
      `could not enumerate tracked app source: ${
        output.error?.message ?? Buffer.from(output.stderr ?? []).toString('utf8')
      }`,
    );
  }
  return normalizeTrackedFiles(
    Buffer.from(output.stdout ?? [])
      .toString('utf8')
      .split('\0')
      .filter(Boolean),
    sourceRoots,
  );
}

function normalizeTrackedFiles(trackedFiles, sourceRoots) {
  if (!Array.isArray(trackedFiles)) {
    throw new TypeError('tracked app source files must be an array');
  }
  const normalized = trackedFiles.map((relative) => {
    if (
      typeof relative !== 'string' ||
      relative.length === 0 ||
      path.isAbsolute(relative) ||
      relative.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
    ) {
      throw new TypeError(`invalid tracked app source path ${JSON.stringify(relative)}`);
    }
    if (
      !sourceRoots.some(
        (sourceRoot) => relative === sourceRoot || relative.startsWith(`${sourceRoot}/`),
      )
    ) {
      throw new TypeError(`tracked app source path is outside declared roots: ${relative}`);
    }
    return relative;
  });
  const unique = [...new Set(normalized)].sort(compareUtf8);
  if (unique.length !== normalized.length) throw new TypeError('tracked app source has duplicates');
  return unique;
}

function moduleSpecifiers(fileName, source) {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(fileName),
  );
  const specifiers = [];
  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      specifiers.push(statement.moduleSpecifier.text);
    }
    if (
      ts.isExportDeclaration(statement) &&
      statement.moduleSpecifier &&
      ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      specifiers.push(statement.moduleSpecifier.text);
    }
  }
  return specifiers;
}

function componentSyntaxCensus(fileName, source) {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(fileName),
  );
  const directBindings = new Set();
  const namespaceBindings = new Set();
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== '@kovojs/core' ||
      statement.importClause?.isTypeOnly
    ) {
      continue;
    }
    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) {
        if (
          !element.isTypeOnly &&
          (element.propertyName?.text ?? element.name.text) === 'component'
        ) {
          directBindings.add(element.name.text);
        }
      }
    } else if (bindings && ts.isNamespaceImport(bindings)) {
      namespaceBindings.add(bindings.name.text);
    }
  }

  let componentCalls = 0;
  let jsxNodes = 0;
  let stringRenderReturns = 0;
  const visit = (node) => {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) {
      jsxNodes += 1;
    }
    if (ts.isCallExpression(node)) {
      const direct = ts.isIdentifier(node.expression) && directBindings.has(node.expression.text);
      const namespaced =
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === 'component' &&
        ts.isIdentifier(node.expression.expression) &&
        namespaceBindings.has(node.expression.expression.text);
      if (direct || namespaced) {
        componentCalls += 1;
        stringRenderReturns += componentStringRenderReturnCount(node);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return { componentCalls, jsxNodes, stringRenderReturns };
}

function componentStringRenderReturnCount(call) {
  const options = call.arguments[0];
  if (!options || !ts.isObjectLiteralExpression(options)) return 0;
  let count = 0;
  for (const property of options.properties) {
    const name =
      property.name && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))
        ? property.name.text
        : undefined;
    if (name !== 'render' && name !== 'renderSource') continue;
    const body = ts.isMethodDeclaration(property)
      ? property.body
      : ts.isPropertyAssignment(property) &&
          (ts.isArrowFunction(property.initializer) ||
            ts.isFunctionExpression(property.initializer))
        ? property.initializer.body
        : undefined;
    if (!body) continue;
    if (
      !ts.isBlock(body) &&
      (ts.isStringLiteral(body) ||
        ts.isNoSubstitutionTemplateLiteral(body) ||
        ts.isTemplateExpression(body))
    ) {
      count += 1;
      continue;
    }
    if (!ts.isBlock(body)) continue;
    const visit = (node) => {
      if (
        ts.isReturnStatement(node) &&
        node.expression &&
        (ts.isStringLiteral(node.expression) ||
          ts.isNoSubstitutionTemplateLiteral(node.expression) ||
          ts.isTemplateExpression(node.expression))
      ) {
        count += 1;
      }
      ts.forEachChild(node, visit);
    };
    visit(body);
  }
  return count;
}

function scriptKind(fileName) {
  if (fileName.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (fileName.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (/\.(?:mjs|cjs|js)$/u.test(fileName)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function isForbiddenAppGeneratedSpecifier(specifier) {
  return (
    /^@kovojs\/[^/]+\/(?:generated|internal)(?:\/|$)/u.test(specifier) ||
    /^(?:\.{1,2}\/|\/).*\/generated(?:\/|$)/u.test(specifier) ||
    /^@kovojs\/(?:core|server)\/jsx-(?:dev-)?runtime$/u.test(specifier)
  );
}

export function inspectBuiltArtifact({ distRoot, packedPackages }) {
  if (!(packedPackages instanceof Map)) {
    throw new TypeError('built artifact inspection requires authenticated packed packages');
  }
  const resolvedDist = realDirectory(distRoot, 'built artifact dist');
  const graphPath = path.join(resolvedDist, '.kovo', 'graph.json');
  const graphBytes = readBoundedRegularFile(graphPath, 'production graph');
  let graph;
  try {
    graph = JSON.parse(graphBytes.toString('utf8'));
  } catch (error) {
    throw new Error(
      `production graph is not JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const graphReport = validateAuthenticatedGraph(graph, graphBytes, packedPackages);
  const serverModules = inventoryTree(path.join(resolvedDist, 'server'), {
    excludedTopLevelDirectories: ['client', 'static'],
    include: JAVASCRIPT_MODULE_EXTENSION_PATTERN,
    label: 'server modules',
  });
  const deployedClientRoot = path.join(resolvedDist, 'server', 'client');
  const clientModules = inventoryTree(deployedClientRoot, {
    include: JAVASCRIPT_MODULE_EXTENSION_PATTERN,
    label: 'client modules',
  });
  const cssAssets = inventoryTree(deployedClientRoot, {
    include: CSS_EXTENSION_PATTERN,
    label: 'client CSS assets',
  });
  if (serverModules.length === 0) throw new Error('production artifact has no server modules');
  if (clientModules.length === 0) throw new Error('production artifact has no client modules');
  if (cssAssets.length === 0) throw new Error('production artifact has no CSS assets');
  if (!serverModules.some((entry) => entry.path === 'server.mjs')) {
    throw new Error('production artifact has no server/server.mjs entry');
  }
  if (!serverModules.some((entry) => entry.path === 'server/handler.mjs')) {
    throw new Error('production artifact has no emitted server handler module');
  }
  if (!clientModules.some((entry) => /(?:^|\/)c\/__v\/[0-9a-f]{64}\//u.test(entry.path))) {
    throw new Error('production artifact has no content-addressed /c/__v/ client module');
  }
  for (const entry of [...serverModules, ...clientModules]) {
    const source = readBoundedRegularFile(
      path.join(
        entry.kind === 'server' ? path.join(resolvedDist, 'server') : deployedClientRoot,
        ...entry.path.split('/'),
      ),
      `emitted module ${entry.path}`,
    ).toString('utf8');
    if (source.length === 0 || source.includes('\0')) {
      throw new Error(`emitted module ${entry.path} is empty or contains NUL`);
    }
  }
  return Object.freeze({
    graph,
    graphBytes,
    report: Object.freeze({
      schema: BUILT_ARTIFACT_INSPECTION_SCHEMA,
      graph: graphReport,
      serverModules,
      clientModules,
      cssAssets,
      pass: true,
    }),
  });
}

function validateAuthenticatedGraph(graph, graphBytes, packedPackages) {
  if (!isPlainObject(graph)) throw new Error('production graph must be an object');
  const provenance = graph.provenance;
  if (!isPlainObject(provenance) || provenance.schema !== GRAPH_PROVENANCE_SCHEMA) {
    throw new Error(`production graph provenance must be ${GRAPH_PROVENANCE_SCHEMA}`);
  }
  if (provenance.graphSchemaVersion !== GRAPH_SCHEMA) {
    throw new Error(`production graph schema must be ${GRAPH_SCHEMA}`);
  }
  if (
    !isPlainObject(provenance.pnpmLock) ||
    !SHA256_PATTERN.test(provenance.pnpmLock.contentHash)
  ) {
    throw new Error('production graph has no authenticated pnpm lock hash');
  }
  if (
    !isPlainObject(provenance.securityGuarantees) ||
    provenance.securityGuarantees.schema !== SECURITY_GUARANTEE_SCHEMA ||
    !SHA256_PATTERN.test(provenance.securityGuarantees.canonicalHash)
  ) {
    throw new Error('production graph has no authenticated security-guarantee identity');
  }
  if (!Array.isArray(provenance.frameworkPackages) || provenance.frameworkPackages.length === 0) {
    throw new Error('production graph has no framework package provenance');
  }
  const seenIdentities = new Set();
  const seenNames = new Set();
  let previous = '';
  for (const [index, entry] of provenance.frameworkPackages.entries()) {
    const identity =
      isPlainObject(entry) && typeof entry.name === 'string' && typeof entry.version === 'string'
        ? `${entry.name}\0${entry.version}`
        : '';
    if (
      !isPlainObject(entry) ||
      typeof entry.name !== 'string' ||
      typeof entry.version !== 'string' ||
      identity <= previous ||
      seenIdentities.has(identity)
    ) {
      throw new Error(`production graph frameworkPackages[${String(index)}] is not unique/sorted`);
    }
    const authenticated = packedPackages.get(entry.name);
    if (authenticated?.version !== entry.version) {
      throw new Error(
        `production graph package ${entry.name}@${entry.version} is absent from authenticated tarballs`,
      );
    }
    previous = identity;
    seenIdentities.add(identity);
    seenNames.add(entry.name);
  }
  for (const packageName of REQUIRED_GRAPH_PACKAGES) {
    if (!seenNames.has(packageName)) {
      throw new Error(`production graph omits required framework package ${packageName}`);
    }
  }
  for (const key of ['components', 'pages', 'queries', 'mutations']) {
    if (!Array.isArray(graph[key]) || graph[key].length === 0) {
      throw new Error(`production graph has no ${key} facts`);
    }
  }
  for (const key of ['diagnostics', 'verificationDiagnostics']) {
    if (graph[key] !== undefined && !Array.isArray(graph[key])) {
      throw new Error(`production graph ${key} must be an array when present`);
    }
  }
  return Object.freeze({
    bytes: graphBytes.length,
    diagnostics: Array.isArray(graph.diagnostics) ? graph.diagnostics.length : 0,
    frameworkPackages: provenance.frameworkPackages,
    graphSchemaVersion: provenance.graphSchemaVersion,
    sha256: sha256(graphBytes),
    verificationDiagnostics: Array.isArray(graph.verificationDiagnostics)
      ? graph.verificationDiagnostics.length
      : 0,
  });
}

function inventoryTree(root, { excludedTopLevelDirectories = [], include, label }) {
  const resolvedRoot = realDirectory(root, label);
  const excluded = new Set(excludedTopLevelDirectories);
  const inventory = [];
  let totalBytes = 0;
  const walk = (directory, relativeRoot = '') => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
      compareUtf8(left.name, right.name),
    )) {
      const relative = relativeRoot ? `${relativeRoot}/${entry.name}` : entry.name;
      const file = path.join(directory, entry.name);
      const stat = lstatSync(file);
      if (stat.isSymbolicLink()) throw new Error(`${label} contains symlink ${relative}`);
      if (stat.isDirectory()) {
        if (relativeRoot === '' && excluded.has(entry.name)) continue;
        walk(file, relative);
        continue;
      }
      if (!stat.isFile()) throw new Error(`${label} contains non-regular entry ${relative}`);
      if (!include.test(relative)) continue;
      if (stat.size > MAX_INSPECTED_FILE_BYTES) {
        throw new Error(`${label} file exceeds inspection bound: ${relative}`);
      }
      totalBytes += stat.size;
      if (inventory.length >= MAX_INSPECTED_FILES || totalBytes > MAX_INSPECTED_TREE_BYTES) {
        throw new Error(`${label} exceeds bounded inspection census`);
      }
      inventory.push({
        bytes: stat.size,
        kind: label.startsWith('server')
          ? 'server'
          : label.startsWith('client module')
            ? 'client'
            : 'css',
        path: relative,
        sha256: sha256(readFileSync(file)),
      });
    }
  };
  walk(resolvedRoot);
  return Object.freeze(inventory);
}

async function inspectProductionRuntime({ appRoot }) {
  const port = await reserveLoopbackPort();
  const origin = `http://127.0.0.1:${String(port)}`;
  const child = spawn(process.execPath, ['dist/server/server.mjs'], {
    cwd: appRoot,
    detached: process.platform !== 'win32',
    env: {
      ...process.env,
      BETTER_AUTH_URL: origin,
      HOST: '127.0.0.1',
      NODE_ENV: 'test',
      PORT: String(port),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const output = boundedChildOutput(child);
  try {
    await fetchWhenReady(`${origin}/login`, output);
    const jar = new Map();
    const loginResponse = await fetch(`${origin}/login`);
    mergeCookies(jar, loginResponse.headers.getSetCookie());
    const loginHtml = await loginResponse.text();
    const loginBuildToken = requireBuildToken(loginResponse, loginHtml, 'login document');
    requireHtmlDocument(loginResponse, loginHtml, 'login document');
    if (!loginHtml.includes('Sign in')) throw new Error('login document omits Sign in');

    const stylesheetHref = stylesheetHrefFromHtml(loginHtml);
    const stylesheetResponse = await fetch(new URL(stylesheetHref, origin));
    const stylesheet = await stylesheetResponse.text();
    if (
      stylesheetResponse.status !== 200 ||
      !/^text\/css(?:;|$)/iu.test(stylesheetResponse.headers.get('content-type') ?? '') ||
      !stylesheet.includes('--kovo-theme') ||
      stylesheet.length === 0 ||
      Buffer.byteLength(stylesheet) > MAX_INSPECTED_FILE_BYTES
    ) {
      throw new Error('production CSS response is missing, malformed, or unthemed');
    }

    const demoPassword = envValue(path.join(appRoot, '.env'), 'KOVO_DEMO_PASSWORD');
    const signIn = await fetch(`${origin}/_m/auth/sign-in`, {
      body: new URLSearchParams({
        csrf: fieldValue(loginHtml, 'csrf'),
        email: 'demo@example.com',
        'Kovo-Idem': fieldValue(loginHtml, 'Kovo-Idem'),
        next: '/',
        password: demoPassword,
      }),
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        cookie: cookieHeader(jar),
        origin,
      },
      method: 'POST',
      redirect: 'manual',
    });
    mergeCookies(jar, signIn.headers.getSetCookie());
    if (signIn.status !== 303) {
      throw new Error(`production sign-in returned ${String(signIn.status)}`);
    }

    const homeResponse = await fetch(`${origin}/`, {
      headers: { cookie: cookieHeader(jar) },
    });
    const homeHtml = await homeResponse.text();
    requireHtmlDocument(homeResponse, homeHtml, 'authenticated document');
    const buildToken = requireBuildToken(homeResponse, homeHtml, 'authenticated document');
    if (buildToken !== loginBuildToken) {
      throw new Error('document build token changed inside one production artifact');
    }
    const addForm = formHtmlByAction(homeHtml, '/_m/mutations/add-contact');
    const contactRegion = elementOpeningTagByAttribute(
      homeHtml,
      'kovo-fragment-target',
      'contacts-region',
    );
    const target = requiredAttribute(contactRegion, 'kovo-fragment-target');
    const deps = requiredAttribute(contactRegion, 'kovo-deps');
    const component = requiredAttribute(contactRegion, 'kovo-live-component');
    const liveToken = requiredAttribute(contactRegion, 'kovo-live-token');
    const props = attributeValue(contactRegion, 'kovo-props') ?? '{}';
    const idem = fieldValue(addForm, 'Kovo-Idem');
    const email = 'artifact-inspection@example.test';
    const mutationResponse = await fetch(`${origin}/_m/mutations/add-contact`, {
      body: new URLSearchParams({
        company: 'Kovo',
        csrf: fieldValue(addForm, 'csrf'),
        email,
        'Kovo-Idem': idem,
        name: 'Artifact Inspection',
      }),
      headers: {
        accept: 'text/vnd.kovo.fragment+html',
        'content-type': 'application/x-www-form-urlencoded',
        cookie: cookieHeader(jar),
        'Kovo-Build': buildToken,
        'Kovo-Current-Url': `${origin}/`,
        'Kovo-Form-Target': encodeIdentityToken(target),
        'Kovo-Fragment': 'true',
        'Kovo-Idem': idem,
        'Kovo-Live-Targets': `${encodeIdentityToken(target)}#${encodeIdentityToken(component)}@${liveToken}:${props}`,
        'Kovo-Targets': `${encodeIdentityToken(target)}=${deps}`,
        origin,
      },
      method: 'POST',
    });
    const mutationFrame = await mutationResponse.text();
    validateMutationWireFrame({
      buildToken,
      email,
      frame: mutationFrame,
      response: mutationResponse,
      target,
    });
    const report = {
      schema: RUNTIME_WIRE_INSPECTION_SCHEMA,
      document: {
        bytes: Buffer.byteLength(homeHtml),
        buildToken,
        contentType: homeResponse.headers.get('content-type'),
        sha256: sha256(homeHtml),
        status: homeResponse.status,
      },
      css: {
        bytes: Buffer.byteLength(stylesheet),
        contentType: stylesheetResponse.headers.get('content-type'),
        href: stylesheetHref,
        sha256: sha256(stylesheet),
        status: stylesheetResponse.status,
      },
      mutationFrame: {
        bytes: Buffer.byteLength(mutationFrame),
        contentType: mutationResponse.headers.get('content-type'),
        headers: sanitizeDiagnosticResponseHeaders(
          Object.fromEntries(mutationResponse.headers.entries()),
        ),
        sha256: sha256(mutationFrame),
        status: mutationResponse.status,
        target,
      },
      pass: true,
    };
    return Object.freeze({
      documentRedacted: sanitizeMarkupPreview(homeHtml, 64 * 1024),
      mutationFrameRedacted: sanitizeMarkupPreview(mutationFrame, 64 * 1024),
      report: Object.freeze(report),
      stylesheet,
    });
  } finally {
    await stopChild(child);
  }
}

export function validateMutationWireFrame({ buildToken, email, frame, response, target }) {
  if (response.status !== 200) {
    throw new Error(`production mutation frame returned ${String(response.status)}`);
  }
  if (
    !/^text\/vnd\.kovo\.fragment\+html(?:;|$)/iu.test(response.headers.get('content-type') ?? '')
  ) {
    throw new Error('production mutation frame has the wrong content type');
  }
  if (response.headers.get('kovo-build') !== buildToken) {
    throw new Error('production mutation frame has the wrong build token');
  }
  if (
    !frame.includes('<kovo-query') ||
    !frame.includes(`<kovo-fragment target="${target}"`) ||
    !frame.includes(email)
  ) {
    throw new Error('production mutation frame omits query, fragment, target, or changed data');
  }
}

function requireHtmlDocument(response, html, label) {
  if (
    response.status !== 200 ||
    !/^text\/html(?:;|$)/iu.test(response.headers.get('content-type') ?? '') ||
    !/<!doctype html>/iu.test(html) ||
    !/<html\b/iu.test(html) ||
    !/<body\b/iu.test(html)
  ) {
    throw new Error(`${label} is not a complete successful HTML document`);
  }
}

function requireBuildToken(response, html, label) {
  const header = response.headers.get('kovo-build');
  const meta = /<meta\b(?=[^>]*\bname="kovo-build")[^>]*>/iu.exec(html)?.[0];
  const content = meta ? attributeValue(meta, 'content') : undefined;
  if (!header || !BUILD_TOKEN_PATTERN.test(header) || content !== header) {
    throw new Error(`${label} does not carry one exact Kovo build token`);
  }
  return header;
}

function stylesheetHrefFromHtml(html) {
  for (const match of html.matchAll(/<link\b[^>]*>/giu)) {
    const tag = match[0];
    if (attributeValue(tag, 'rel') === 'stylesheet') {
      const href = attributeValue(tag, 'href');
      if (href && href.endsWith('.css')) return href;
    }
  }
  throw new Error('production document has no stylesheet href');
}

function retainInspectionEvidence({ artifact, commands, runtime, stagingRoot }) {
  const values = [
    ['check-green.json', `${JSON.stringify(commands.greenEnvelope, null, 2)}\n`],
    ['check-kv235.json', `${JSON.stringify(commands.kv235Envelope, null, 2)}\n`],
    ['document.redacted.html', `${runtime.documentRedacted}\n`],
    ['graph.json', artifact.graphBytes],
    ['mutation-frame.redacted.html', `${runtime.mutationFrameRedacted}\n`],
    ['styles.css', runtime.stylesheet],
  ];
  for (const [relative, value] of values) {
    if (Buffer.byteLength(value) > MAX_INSPECTED_FILE_BYTES) {
      throw new Error(`retained inspection evidence exceeds file bound: ${relative}`);
    }
    writeNewFile(path.join(stagingRoot, relative), value);
  }
  return Object.freeze(
    values
      .map(([relative]) => {
        const bytes = readFileSync(path.join(stagingRoot, relative));
        return { bytes: bytes.length, path: relative, sha256: sha256(bytes) };
      })
      .sort((left, right) => compareUtf8(left.path, right.path)),
  );
}

export function validateStructuredDiagnosticEnvelope(
  envelope,
  { expectedExitCode, label = 'structured diagnostic envelope' } = {},
) {
  const findings = [];
  if (!isPlainObject(envelope)) return [`${label} must be an object`];
  if (envelope.version !== DIAGNOSTIC_ENVELOPE_VERSION) {
    findings.push(`${label} version must be ${DIAGNOSTIC_ENVELOPE_VERSION}`);
  }
  if (!Array.isArray(envelope.diagnostics)) {
    findings.push(`${label} diagnostics must be an array`);
  } else {
    for (const [index, diagnostic] of envelope.diagnostics.entries()) {
      if (
        !isPlainObject(diagnostic) ||
        typeof diagnostic.code !== 'string' ||
        diagnostic.code.length === 0 ||
        typeof diagnostic.message !== 'string' ||
        diagnostic.message.length === 0 ||
        diagnostic.version !== DIAGNOSTIC_ENVELOPE_VERSION
      ) {
        findings.push(`${label} diagnostics[${String(index)}] is malformed`);
      }
    }
  }
  if (
    !isPlainObject(envelope.result) ||
    envelope.result.command !== 'check' ||
    envelope.result.protocol !== CHECK_PROTOCOL ||
    envelope.result.exitCode !== expectedExitCode ||
    typeof envelope.result.text !== 'string' ||
    !envelope.result.text.startsWith(`${CHECK_PROTOCOL}\n`)
  ) {
    findings.push(`${label} result is not an exact ${CHECK_PROTOCOL} check result`);
  }
  return findings;
}

function parseStructuredDiagnosticEnvelope(text, options) {
  let envelope;
  try {
    envelope = JSON.parse(text);
  } catch (error) {
    throw new Error(
      `${options.label} did not emit JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const findings = validateStructuredDiagnosticEnvelope(envelope, options);
  if (findings.length > 0) throw new Error(findings.join('\n'));
  return envelope;
}

export function validateReleaseArtifactInspectionReport(report) {
  const findings = [];
  if (!isPlainObject(report)) return ['report must be an object'];
  if (report.schema !== RELEASE_ARTIFACT_INSPECTION_SCHEMA) {
    findings.push(`schema must be ${RELEASE_ARTIFACT_INSPECTION_SCHEMA}`);
  }
  if (report.pass !== true) findings.push('report pass must be true');
  if (!/^[0-9a-f]{40}$/u.test(report.sourceCommit ?? '')) {
    findings.push('sourceCommit must be an exact Git commit');
  }
  if (!SHA256_PATTERN.test(report.packedManifest?.sha256 ?? '')) {
    findings.push('packed manifest SHA-256 is missing');
  }
  if (!SHA256_PATTERN.test(report.packageSubject ?? '')) {
    findings.push('authenticated package subject is missing');
  }
  if (
    report.sourceCensus?.schema !== APP_COMPONENT_SOURCE_CENSUS_SCHEMA ||
    report.sourceCensus?.pass !== true ||
    !Array.isArray(report.sourceCensus?.components) ||
    report.sourceCensus.components.length === 0 ||
    !Array.isArray(report.sourceCensus?.findings) ||
    report.sourceCensus.findings.length !== 0
  ) {
    findings.push('app-component source census is missing or not clean');
  }
  if (
    report.artifact?.schema !== BUILT_ARTIFACT_INSPECTION_SCHEMA ||
    report.artifact?.pass !== true ||
    !Array.isArray(report.artifact?.serverModules) ||
    report.artifact.serverModules.length === 0 ||
    !Array.isArray(report.artifact?.clientModules) ||
    report.artifact.clientModules.length === 0 ||
    !Array.isArray(report.artifact?.cssAssets) ||
    report.artifact.cssAssets.length === 0
  ) {
    findings.push('built server/client/CSS artifact inspection is incomplete');
  }
  if (
    report.runtime?.schema !== RUNTIME_WIRE_INSPECTION_SCHEMA ||
    report.runtime?.pass !== true ||
    !SHA256_PATTERN.test(report.runtime?.document?.sha256 ?? '') ||
    !SHA256_PATTERN.test(report.runtime?.css?.sha256 ?? '') ||
    !SHA256_PATTERN.test(report.runtime?.mutationFrame?.sha256 ?? '')
  ) {
    findings.push('runtime HTML/CSS/wire inspection is incomplete');
  }
  const requiredRetained = new Set([
    'check-green.json',
    'check-kv235.json',
    'document.redacted.html',
    'graph.json',
    'mutation-frame.redacted.html',
    'styles.css',
  ]);
  if (!Array.isArray(report.retained)) {
    findings.push('retained evidence inventory is missing');
  } else {
    for (const entry of report.retained) {
      if (
        !isPlainObject(entry) ||
        !requiredRetained.delete(entry.path) ||
        !Number.isSafeInteger(entry.bytes) ||
        entry.bytes <= 0 ||
        !SHA256_PATTERN.test(entry.sha256 ?? '')
      ) {
        findings.push('retained evidence inventory contains an invalid entry');
      }
    }
    if (requiredRetained.size > 0) {
      findings.push(
        `retained evidence omits ${[...requiredRetained].sort(compareUtf8).join(', ')}`,
      );
    }
  }
  return findings;
}

function runCommand(command, { allowedExitCodes = [0], cwd, label }) {
  const started = performance.now();
  const env = { ...process.env, CI: '1', NO_COLOR: '1' };
  delete env.FORCE_COLOR;
  const result = spawnSync(command[0], command.slice(1), {
    cwd,
    encoding: 'utf8',
    env,
    maxBuffer: MAX_COMMAND_OUTPUT_BYTES,
    timeout: COMMAND_TIMEOUT_MS,
  });
  const durationMs = performance.now() - started;
  const exitCode = result.status;
  const stderr = result.stderr ?? '';
  const stdout = result.stdout ?? '';
  if (
    result.error ||
    exitCode === null ||
    !allowedExitCodes.includes(exitCode) ||
    result.signal !== null
  ) {
    throw new Error(
      [
        `${label} failed status=${String(exitCode)} signal=${String(result.signal)}`,
        result.error?.message ?? '',
        boundedText(stderr, 8_192),
        boundedText(stdout, 8_192),
      ]
        .filter(Boolean)
        .join('\n'),
    );
  }
  return Object.freeze({ durationMs, exitCode, label, stderr, stdout });
}

function assertAuthenticatedInstalledEntry(pkg, installedPath, relative) {
  if (!pkg || !Array.isArray(pkg.entries)) {
    throw new TypeError(`authenticated package for ${relative} is unavailable`);
  }
  const entry = pkg.entries.find((candidate) => candidate.name === `package/${relative}`);
  if (!entry) throw new Error(`${pkg.name} authenticated tarball omits ${relative}`);
  const installed = readBoundedRegularFile(installedPath, `${pkg.name} installed ${relative}`);
  if (!Buffer.from(entry.data).equals(installed)) {
    throw new Error(`${pkg.name} installed ${relative} differs from authenticated tarball bytes`);
  }
}

function packedPackageSubject(packedPackages) {
  const entries = [...packedPackages.values()]
    .map((pkg) => `${pkg.name}\0${pkg.version}\0${pkg.sha512}`)
    .sort(compareUtf8);
  return sha256(entries.join('\0'));
}

function requireCleanTrackedSource(root) {
  const status = gitOutput(['status', '--porcelain', '--untracked-files=no'], root);
  if (status.trim().length > 0) {
    throw new Error('release artifact inspection requires a clean tracked worktree');
  }
}

function gitOutput(args, cwd) {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: MAX_COMMAND_OUTPUT_BYTES,
    timeout: 30_000,
  });
  if (result.status !== 0 || result.error) {
    throw new Error(
      `git ${args.join(' ')} failed: ${result.error?.message ?? result.stderr ?? ''}`,
    );
  }
  return result.stdout;
}

async function reserveLoopbackPort() {
  const { createServer } = await import('node:net');
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  if (!address || typeof address === 'string') throw new Error('could not reserve loopback port');
  return address.port;
}

async function fetchWhenReady(url, output) {
  const deadline = performance.now() + SERVER_READY_TIMEOUT_MS;
  let lastError;
  while (performance.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.status === 200) {
        await response.arrayBuffer();
        return;
      }
      lastError = new Error(`status ${String(response.status)}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(
    `production server did not become ready: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }\n${output()}`,
  );
}

function boundedChildOutput(child) {
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    stdout = boundedText(`${stdout}${chunk}`, 128 * 1024);
  });
  child.stderr.on('data', (chunk) => {
    stderr = boundedText(`${stderr}${chunk}`, 128 * 1024);
  });
  return () => `${stdout}\n${stderr}`;
}

async function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((resolve) => child.once('exit', resolve));
  try {
    process.kill(process.platform === 'win32' ? child.pid : -child.pid, 'SIGTERM');
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error;
  }
  const timer = new Promise((resolve) => setTimeout(resolve, 5_000, 'timeout'));
  if ((await Promise.race([exited, timer])) === 'timeout') {
    try {
      process.kill(process.platform === 'win32' ? child.pid : -child.pid, 'SIGKILL');
    } catch (error) {
      if (error?.code !== 'ESRCH') throw error;
    }
    await exited;
  }
}

function mergeCookies(jar, setCookieHeaders) {
  for (const header of setCookieHeaders) {
    const pair = header.split(';', 1)[0] ?? '';
    const separator = pair.indexOf('=');
    if (separator <= 0) continue;
    jar.set(pair.slice(0, separator), pair.slice(separator + 1));
  }
}

function cookieHeader(jar) {
  return [...jar.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
}

function envValue(file, key) {
  const match = new RegExp(`^${escapeRegExp(key)}=(.+)$`, 'mu').exec(readFileSync(file, 'utf8'));
  if (!match?.[1]) throw new Error(`generated app environment omits ${key}`);
  return match[1].trim().replace(/^(['"])(.*)\1$/u, '$2');
}

function formHtmlByAction(html, action) {
  const match = new RegExp(
    `<form\\b(?=[^>]*\\baction="${escapeRegExp(action)}")[\\s\\S]*?</form>`,
    'iu',
  ).exec(html);
  if (!match?.[0]) throw new Error(`expected form action ${action}`);
  return match[0];
}

function elementOpeningTagByAttribute(html, name, value) {
  const match = new RegExp(
    `<[A-Za-z][A-Za-z0-9:-]*\\b(?=[^>]*\\b${escapeRegExp(name)}="${escapeRegExp(value)}")[^>]*>`,
    'iu',
  ).exec(html);
  if (!match?.[0]) throw new Error(`expected element with ${name}=${value}`);
  return match[0];
}

function fieldValue(html, name) {
  const tag = elementOpeningTagByAttribute(html, 'name', name);
  const value = attributeValue(tag, 'value');
  if (value === undefined) throw new Error(`expected field value for ${name}`);
  return value;
}

function attributeValue(html, name) {
  return new RegExp(`\\b${escapeRegExp(name)}="([^"]*)"`, 'u').exec(html)?.[1];
}

function requiredAttribute(html, name) {
  const value = attributeValue(html, name);
  if (!value) throw new Error(`expected non-empty ${name} attribute`);
  return value;
}

function encodeIdentityToken(value) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('wire identity must be non-empty text');
  }
  return encodeURIComponent(value)
    .replace(/!/gu, '%21')
    .replace(/'/gu, '%27')
    .replace(/\(/gu, '%28')
    .replace(/\)/gu, '%29')
    .replace(/\*/gu, '%2A');
}

function realDirectory(value, label) {
  const resolved = realpathSync(path.resolve(value));
  const stat = lstatSync(resolved);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`${label} must be a real non-symlink directory`);
  }
  return resolved;
}

function readBoundedRegularFile(file, label) {
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_INSPECTED_FILE_BYTES) {
    throw new Error(`${label} must be a bounded regular non-symlink file`);
  }
  return readFileSync(file);
}

function writeNewFile(file, value) {
  writeFileSync(file, value, {
    encoding: typeof value === 'string' ? 'utf8' : undefined,
    flag: 'wx',
  });
}

function boundedText(value, maxBytes) {
  const text = String(value);
  if (Buffer.byteLength(text) <= maxBytes) return text;
  const marker = '\n[TRUNCATED]';
  const maximum = Math.max(0, maxBytes - Buffer.byteLength(marker));
  let result = Buffer.from(text).subarray(0, maximum).toString('utf8');
  while (Buffer.byteLength(result) > maximum) result = result.slice(0, -1);
  return `${result}${marker}`;
}

function sha256(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left), Buffer.from(right));
}

function compareNamedRecords(left, right) {
  return compareUtf8(left.name, right.name);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

if (isMainEntry(import.meta.url)) await runGate(runReleaseArtifactInspection);
