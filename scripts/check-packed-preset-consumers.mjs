#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { authenticatedPackedJourneyPackages } from './golden-journey.mjs';
import {
  materializePackedPackage,
  rewriteScaffoldDependenciesToPackedTarballs,
} from './golden-journey/packed-app.mjs';
import { deterministicPackEnvironment } from './lib/deterministic-tarball.mjs';
import { isMainEntry, runGate } from './lib/cli-entry.mjs';
import { manifestPath as defaultPackedManifest, repoRoot } from './release-packages.mjs';

const SUPPORTED_PRESETS = Object.freeze(['node', 'vercel', 'cloudflare']);
const REQUIRED_GRAPH_PACKAGES = Object.freeze([
  '@kovojs/cli',
  '@kovojs/compiler',
  '@kovojs/core',
  '@kovojs/server',
]);
const GRAPH_PROOF_KEYS = Object.freeze([
  'appBuildToken',
  'appId',
  'compilerVersion',
  'completion',
  'configDigest',
  'postureProfile',
  'schema',
  'sourceSetDigest',
]);
const MAX_COMMAND_OUTPUT_BYTES = 64 * 1024 * 1024;
const MAX_ARTIFACT_FILE_BYTES = 64 * 1024 * 1024;
const MAX_ARTIFACT_TREE_BYTES = 512 * 1024 * 1024;
const MAX_ARTIFACT_FILES = 20_000;
const INSTALL_TIMEOUT_MS = 5 * 60 * 1_000;
const BUILD_TIMEOUT_MS = 10 * 60 * 1_000;
const RETENTION_PROOF = Object.freeze({
  hours: 24,
  immutableClientModules: 'retained',
  priorTokenQueryReads: 'retained',
});
const TEXT_ARTIFACT_PATTERN = /(?:^Dockerfile$|\.(?:c?js|mjs|json|html|css|toml|txt)$)/u;
const DEVELOPMENT_ARTIFACT_PATTERNS = Object.freeze([
  Object.freeze({ label: 'the development devtool client', pattern: /\/__kovo\/client\.js/u }),
  Object.freeze({ label: 'the Vite development client', pattern: /["'`]\/@vite\/client["'`]/u }),
  Object.freeze({ label: 'Vite hot-module state', pattern: /\bimport\.meta\.hot\b/u }),
  Object.freeze({ label: 'the development ready reporter', pattern: /\bKovo dev ready in\b/u }),
  Object.freeze({
    label: 'a fixed loopback development origin',
    pattern: /http:\/\/(?:127\.0\.0\.1|localhost):5173\b/u,
  }),
]);

export function parsePackedPresetConsumerArgs(argv) {
  let packedManifest = defaultPackedManifest;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token !== '--packed-manifest') {
      throw new Error(`Unknown packed-preset-consumer argument ${JSON.stringify(token)}.`);
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('-')) {
      throw new Error('--packed-manifest requires a value.');
    }
    packedManifest = path.resolve(repoRoot, value);
    index += 1;
  }
  return Object.freeze({ packedManifest: path.resolve(packedManifest) });
}

/** Render one explicit SPEC §14 deployment assertion for a supported built-in preset. */
export function packedPresetConfig(preset) {
  assertSupportedPreset(preset);
  return [
    `import { defineConfig, ${preset} } from '@kovojs/server/build';`,
    '',
    'export default defineConfig({',
    `  preset: ${preset}({`,
    '    retention: {',
    `      hours: ${String(RETENTION_PROOF.hours)},`,
    `      immutableClientModules: '${RETENTION_PROOF.immutableClientModules}',`,
    `      priorTokenQueryReads: '${RETENTION_PROOF.priorTokenQueryReads}',`,
    '    },',
    '  }),',
    '});',
    '',
    '// SPEC §14: this declaration is a deployment assertion. Keep it only while the serving',
    '// layer retains both named artifact classes for the full 24-hour window.',
    '',
  ].join('\n');
}

export function assertPackedPresetConfig(source, expectedPreset) {
  const expected = packedPresetConfig(expectedPreset);
  if (source !== expected) {
    throw new Error(
      `Packed scaffold/config does not carry the exact ${expectedPreset} SPEC §14 posture.`,
    );
  }
}

/** Remove ambient provider auto-selection while preserving inherited egress controls. */
export function packedPresetConsumerEnvironment(base = process.env) {
  const environment = deterministicPackEnvironment({
    ...base,
    CI: '1',
    NO_COLOR: '1',
    npm_config_audit: 'false',
    npm_config_fund: 'false',
  });
  for (const name of ['CF_PAGES', 'CLOUDFLARE', 'KOVO_PRESET', 'VERCEL']) {
    delete environment[name];
  }
  return environment;
}

/**
 * Prove an installed package is byte-for-byte the already-authenticated tarball subject.
 *
 * pnpm may make the package root itself a symlink into its consumer-confined virtual store. The
 * resolved root must remain inside that fresh install, and every package entry must remain an exact
 * regular-file copy of the attested tar entry.
 */
export function assertInstalledPackedSubject(appRoot, pkg) {
  if (
    pkg?.name === undefined ||
    !Array.isArray(pkg.entries) ||
    !/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u.test(pkg.name)
  ) {
    throw new TypeError('Installed packed subject requires an authenticated package record.');
  }
  const nodeModules = realpathSync(path.join(appRoot, 'node_modules'));
  const packageRoot = path.join(appRoot, 'node_modules', ...pkg.name.split('/'));
  const resolvedPackageRoot = realpathSync(packageRoot);
  if (
    resolvedPackageRoot === nodeModules ||
    !resolvedPackageRoot.startsWith(`${nodeModules}${path.sep}`) ||
    !lstatSync(resolvedPackageRoot).isDirectory()
  ) {
    throw new Error(`Installed ${pkg.name} resolves outside the fresh packed app.`);
  }

  const expected = new Map();
  for (const entry of pkg.entries) {
    if (!entry.name.startsWith('package/')) {
      throw new Error(`${pkg.name} authenticated entry escapes package/.`);
    }
    const relative = entry.name.slice('package/'.length);
    if (
      relative.length === 0 ||
      relative.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
    ) {
      throw new Error(`${pkg.name} authenticated entry has an unsafe path.`);
    }
    expected.set(relative, Buffer.from(entry.data));
  }

  const actual = [];
  walkRegularFiles(resolvedPackageRoot, (file, relative, stat) => {
    if (stat.size > MAX_ARTIFACT_FILE_BYTES) {
      throw new Error(`Installed ${pkg.name} file exceeds the inspection bound: ${relative}.`);
    }
    actual.push(relative);
    const expectedBytes = expected.get(relative);
    if (expectedBytes === undefined || !expectedBytes.equals(readFileSync(file))) {
      throw new Error(
        `Installed ${pkg.name} file ${relative} differs from its authenticated tarball subject.`,
      );
    }
  });
  actual.sort(compareUtf8);
  const expectedFiles = [...expected.keys()].sort(compareUtf8);
  if (JSON.stringify(actual) !== JSON.stringify(expectedFiles)) {
    throw new Error(`Installed ${pkg.name} file census differs from its authenticated tarball.`);
  }
}

export function assertPackedPresetBuild({ outDir, packedPackages, preset, stdout }) {
  assertSupportedPreset(preset);
  if (!(packedPackages instanceof Map)) {
    throw new TypeError('Packed preset output requires authenticated packages.');
  }
  const requestedOut = path.resolve(outDir);
  const resolvedOut = realDirectory(outDir, `packed ${preset} output`);
  assertBuildSuccessReport(preset, requestedOut, stdout);
  assertNeutralBuildProof(preset, resolvedOut, packedPackages);
  assertNoForeignPresetOutput(preset, resolvedOut);

  if (preset === 'node') assertNodeOutput(resolvedOut);
  if (preset === 'vercel') assertVercelOutput(resolvedOut);
  if (preset === 'cloudflare') assertCloudflareOutput(resolvedOut);

  const deployedRoot = presetOutputRoot(preset, resolvedOut);
  assertProductionArtifactCensus(deployedRoot, preset);
}

export function checkPackedPresetConsumers(argv = process.argv.slice(2)) {
  const options = parsePackedPresetConsumerArgs(argv);
  // This shared helper authenticates schema/census/source-manifest identity, SHA-512, tar entry
  // list, packed package.json, and confined tarball location. It never packs workspace source.
  const packedPackages = authenticatedPackedJourneyPackages(options.packedManifest);
  const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), 'kovo-packed-preset-consumers-'));
  const creatorRoot = path.join(temporaryRoot, 'creator');
  const appRoot = path.join(temporaryRoot, 'app');
  const storeRoot = path.join(temporaryRoot, 'pnpm-store');
  const environment = packedPresetConsumerEnvironment();

  try {
    scaffoldPackedApp({
      appRoot,
      creatorRoot,
      environment,
      packedPackages,
      temporaryRoot,
    });
    rewriteScaffoldDependenciesToPackedTarballs(appRoot, packedPackages);
    runCommand(
      ['pnpm', 'install', '--ignore-workspace', '--no-frozen-lockfile', '--store-dir', storeRoot],
      {
        cwd: appRoot,
        environment,
        label: 'install',
        timeoutMs: INSTALL_TIMEOUT_MS,
      },
    );

    for (const pkg of packedPackages.values()) {
      if (pkg.name !== 'create-kovo') assertInstalledPackedSubject(appRoot, pkg);
    }
    const cliEntry = path.join(appRoot, 'node_modules', '@kovojs', 'cli', 'dist', 'bin.mjs');
    assertAuthenticatedPackageFile(packedPackages.get('@kovojs/cli'), cliEntry, 'dist/bin.mjs');

    const configPath = path.join(appRoot, 'kovo.config.ts');
    for (const preset of SUPPORTED_PRESETS) {
      writeFileSync(configPath, packedPresetConfig(preset), 'utf8');
      assertPackedPresetConfig(readFileSync(configPath, 'utf8'), preset);
      const outDir = path.join(appRoot, `dist-${preset}`);
      const build = runCommand(
        [process.execPath, cliEntry, 'build', './src/app.tsx', '--out', outDir],
        {
          cwd: appRoot,
          environment,
          label: `${preset} build`,
          timeoutMs: BUILD_TIMEOUT_MS,
        },
      );
      if (build.stderr !== '') {
        throw new Error(`Packed ${preset} build emitted an unexpected stderr side channel.`);
      }
      assertPackedPresetBuild({
        outDir,
        packedPackages,
        preset,
        stdout: build.stdout,
      });
    }

    process.stdout.write(
      'Packed preset consumers passed (one authenticated fresh app; Node, Vercel, and Cloudflare builds; SPEC §14 and emitted-artifact posture).\n',
    );
  } finally {
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
}

function scaffoldPackedApp({ appRoot, creatorRoot, environment, packedPackages, temporaryRoot }) {
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
  assertAuthenticatedPackageFile(packedPackages.get('create-kovo'), creator, 'dist/index.mjs');
  const create = runCommand(
    [
      process.execPath,
      creator,
      appRoot,
      '--name',
      'kovo-packed-preset-consumers',
      '--disable-git',
      '--no-install',
      '--postgres',
      '--deployment',
      'node',
      '--retention',
      'retained-24h',
    ],
    {
      cwd: temporaryRoot,
      environment,
      label: 'create',
      timeoutMs: 60_000,
    },
  );
  if (
    create.stderr !== '' ||
    !create.stdout.startsWith('Kovo app created\n') ||
    !create.stdout.includes('  Deploy      node\n') ||
    !create.stdout.includes('  Retention   retained-24h\n') ||
    !existsSync(path.join(appRoot, 'src', 'app.tsx'))
  ) {
    throw new Error('Packed create-kovo did not emit the selected fresh retained Node scaffold.');
  }
  assertPackedPresetConfig(readFileSync(path.join(appRoot, 'kovo.config.ts'), 'utf8'), 'node');
}

function assertAuthenticatedPackageFile(pkg, installedPath, relative) {
  if (!pkg || !Array.isArray(pkg.entries)) {
    throw new TypeError(`Authenticated package for ${relative} is unavailable.`);
  }
  const entry = pkg.entries.find((candidate) => candidate.name === `package/${relative}`);
  if (entry === undefined) throw new Error(`${pkg.name} authenticated tarball omits ${relative}.`);
  const installed = readBoundedRegularFile(installedPath, `${pkg.name} installed ${relative}`);
  if (!Buffer.from(entry.data).equals(installed)) {
    throw new Error(`${pkg.name} installed ${relative} differs from authenticated tarball bytes.`);
  }
}

function assertBuildSuccessReport(preset, outDir, stdout) {
  const summaries = String(stdout)
    .split(/\r?\n/u)
    .filter((line) => line.startsWith('SUMMARY '));
  const serverOutDir = presetOutputRoot(preset, outDir);
  if (
    summaries.length !== 1 ||
    summaries[0] !==
      `SUMMARY preset=${preset} outDir=${JSON.stringify(outDir)} serverOutDir=${JSON.stringify(serverOutDir)}`
  ) {
    throw new Error(`Packed ${preset} build returned a wrong or malformed preset summary.`);
  }
  if (!/^kovo-build\/v1\r?$/mu.test(String(stdout))) {
    throw new Error(`Packed ${preset} build omitted the kovo-build/v1 success protocol.`);
  }
}

function assertNeutralBuildProof(preset, outDir, packedPackages) {
  const neutral = path.join(outDir, '.kovo');
  const meta = readJson(path.join(neutral, 'meta.json'), 'neutral metadata');
  const manifest = readJson(path.join(neutral, 'manifest.json'), 'neutral manifest');
  const graph = readJson(path.join(neutral, 'graph.json'), 'authenticated build graph');
  readBoundedRegularFile(path.join(neutral, 'server', 'handler.mjs'), 'neutral server handler');
  const proofKeys = Object.keys(graph.proof ?? {}).sort(compareUtf8);
  if (
    meta.version !== 'kovo-neutral-build/v1' ||
    meta.hasServerHandler !== true ||
    manifest.version !== 'kovo-neutral-build/v1' ||
    proofKeys.length !== GRAPH_PROOF_KEYS.length ||
    proofKeys.some((key, index) => key !== GRAPH_PROOF_KEYS[index]) ||
    graph.proof.schema !== 'kovo.graph.proof/v2' ||
    graph.proof.completion !== 'complete' ||
    graph.proof.postureProfile !== preset ||
    typeof graph.proof.appId !== 'string' ||
    graph.proof.appId.length === 0 ||
    typeof graph.proof.compilerVersion !== 'string' ||
    graph.proof.compilerVersion.length === 0 ||
    !isSha256(graph.proof.appBuildToken) ||
    !isSha256(graph.proof.configDigest) ||
    !isSha256(graph.proof.sourceSetDigest)
  ) {
    throw new Error(`Packed ${preset} output omitted its exact complete build proof.`);
  }

  const provenance = graph.provenance;
  if (
    provenance?.schema !== 'kovo.artifact.provenance/v1' ||
    !Array.isArray(provenance.frameworkPackages)
  ) {
    throw new Error(`Packed ${preset} graph omitted framework package provenance.`);
  }
  const seen = new Set();
  let previous = '';
  for (const entry of provenance.frameworkPackages) {
    const identity =
      typeof entry?.name === 'string' && typeof entry?.version === 'string'
        ? `${entry.name}\0${entry.version}`
        : '';
    if (identity.length === 0 || identity <= previous || seen.has(entry.name)) {
      throw new Error(`Packed ${preset} graph package provenance is malformed or unsorted.`);
    }
    if (packedPackages.get(entry.name)?.version !== entry.version) {
      throw new Error(
        `Packed ${preset} graph package ${entry.name}@${entry.version} is not authenticated.`,
      );
    }
    previous = identity;
    seen.add(entry.name);
  }
  for (const required of REQUIRED_GRAPH_PACKAGES) {
    if (!seen.has(required)) {
      throw new Error(`Packed ${preset} graph package provenance omits ${required}.`);
    }
  }
}

function assertNodeOutput(outDir) {
  const root = presetOutputRoot('node', outDir);
  const serverEntry = readBoundedRegularFile(path.join(root, 'server.mjs'), 'Node server entry');
  const adapter = readBoundedRegularFile(path.join(root, 'node-adapter.mjs'), 'Node adapter');
  readBoundedRegularFile(path.join(root, 'server', 'handler.mjs'), 'Node bundled handler');
  assertIntegrityManifest(root, {
    'node-adapter.mjs': adapter,
    'server.mjs': serverEntry,
  });
  const dockerfile = readBoundedRegularFile(
    path.join(root, 'Dockerfile'),
    'Node Dockerfile',
  ).toString('utf8');
  const runtimePackage = readJson(path.join(root, 'package.json'), 'Node runtime package');
  if (
    !dockerfile.includes('FROM node:24-alpine@sha256:') ||
    !dockerfile.includes('ENV NODE_ENV=production') ||
    !dockerfile.includes('USER node') ||
    !dockerfile.includes('--ignore-scripts') ||
    !dockerfile.includes('CMD ["node", "server.mjs"]') ||
    runtimePackage.type !== 'module' ||
    runtimePackage.scripts?.start !== 'NODE_ENV=production node server.mjs' ||
    runtimePackage.devDependencies !== undefined ||
    Object.keys(runtimePackage.dependencies ?? {}).length === 0 ||
    JSON.stringify(runtimePackage).includes('workspace:')
  ) {
    throw new Error('Packed Node output omitted its locked non-root production runtime posture.');
  }
}

function assertVercelOutput(outDir) {
  const root = presetOutputRoot('vercel', outDir);
  const config = readJson(path.join(root, 'config.json'), 'Vercel Build Output configuration');
  const functionRoot = path.join(root, 'functions', 'kovo.func');
  const functionConfig = readJson(
    path.join(functionRoot, '.vc-config.json'),
    'Vercel function configuration',
  );
  const functionEntry = readBoundedRegularFile(
    path.join(functionRoot, 'index.cjs'),
    'Vercel function entry',
  );
  const adapter = readBoundedRegularFile(
    path.join(functionRoot, 'node-adapter.mjs'),
    'Vercel Node adapter',
  );
  readBoundedRegularFile(path.join(functionRoot, 'handler.mjs'), 'Vercel bundled handler');
  assertIntegrityManifest(functionRoot, {
    'index.cjs': functionEntry,
    'node-adapter.mjs': adapter,
  });

  const ingressRoot = path.join(root, 'functions', 'kovo-ingress.func');
  const ingressConfig = readJson(
    path.join(ingressRoot, '.vc-config.json'),
    'Vercel ingress configuration',
  );
  const ingressEntry = readBoundedRegularFile(
    path.join(ingressRoot, 'index.js'),
    'Vercel ingress entry',
  );
  assertIntegrityManifest(ingressRoot, { 'index.js': ingressEntry });

  const clientRoute = config.routes?.find((route) => route?.src === '/c/(.*)');
  const documentRoute = config.routes?.find(
    (route) => route?.src === '/(.*)' && route?.headers?.['x-frame-options'] !== undefined,
  );
  if (
    config.version !== 3 ||
    !Array.isArray(config.routes) ||
    !config.routes.some((route) => route?.handle === 'filesystem') ||
    !config.routes.some((route) => route?.dest === '/kovo' && route?.src === '/(.*)') ||
    clientRoute?.headers?.['cache-control'] !== 'public, max-age=31536000, immutable' ||
    clientRoute.headers['cross-origin-resource-policy'] !== 'same-origin' ||
    clientRoute.headers['x-content-type-options'] !== 'nosniff' ||
    documentRoute?.headers?.['x-frame-options'] !== 'DENY' ||
    documentRoute.headers['x-content-type-options'] !== 'nosniff' ||
    functionConfig.handler !== 'index.cjs' ||
    functionConfig.launcherType !== 'Nodejs' ||
    functionConfig.runtime !== 'nodejs22.x' ||
    functionConfig.shouldAddHelpers !== true ||
    ingressConfig.entrypoint !== 'index.js' ||
    ingressConfig.runtime !== 'edge'
  ) {
    throw new Error('Packed Vercel output violates Build Output API v3 production posture.');
  }
}

function assertCloudflareOutput(outDir) {
  const root = presetOutputRoot('cloudflare', outDir);
  const worker = readBoundedRegularFile(path.join(root, 'worker.mjs'), 'Cloudflare Worker entry');
  const handler = readBoundedRegularFile(
    path.join(root, 'server', 'handler.mjs'),
    'Cloudflare bundled handler',
  ).toString('utf8');
  const wrangler = readBoundedRegularFile(
    path.join(root, 'wrangler.toml'),
    'Cloudflare Wrangler configuration',
  ).toString('utf8');
  assertIntegrityManifest(root, { 'worker.mjs': worker });
  if (
    !worker.toString('utf8').includes("await import('./server/handler.mjs')") ||
    !wrangler.includes('main = "./worker.mjs"') ||
    !wrangler.includes('compatibility_flags = ["nodejs_compat"]') ||
    !wrangler.includes('directory = "./client"') ||
    !wrangler.includes('binding = "ASSETS"') ||
    !wrangler.includes('run_worker_first = true') ||
    /\b(?:node:dgram|node:vm|readFileSync|pgsql-ast-parser|kovo-managed-sql-parser)\b/u.test(
      handler,
    )
  ) {
    throw new Error('Packed Cloudflare output violates its Workers production posture.');
  }
}

function assertIntegrityManifest(root, expectedFiles) {
  const integrity = readJson(
    path.join(root, 'kovo-artifact-integrity.json'),
    'artifact integrity manifest',
  );
  const expectedNames = Object.keys(expectedFiles).sort(compareUtf8);
  const actualNames = Object.keys(integrity.files ?? {}).sort(compareUtf8);
  if (
    integrity.algorithm !== 'sha256' ||
    JSON.stringify(actualNames) !== JSON.stringify(expectedNames)
  ) {
    throw new Error('Packed preset emitted a malformed artifact-integrity manifest.');
  }
  for (const name of expectedNames) {
    if (integrity.files[name] !== sha256Hex(expectedFiles[name])) {
      throw new Error(`Packed preset artifact-integrity digest does not match ${name}.`);
    }
  }
}

function assertNoForeignPresetOutput(preset, outDir) {
  const foreign = SUPPORTED_PRESETS.filter((candidate) => candidate !== preset)
    .map((candidate) => presetOutputRoot(candidate, outDir))
    .filter(existsSync);
  if (foreign.length > 0) {
    throw new Error(`Packed ${preset} build retained output for a different preset.`);
  }
}

function assertProductionArtifactCensus(root, preset) {
  let files = 0;
  let bytes = 0;
  walkRegularFiles(root, (file, relative, stat) => {
    files += 1;
    bytes += stat.size;
    if (
      files > MAX_ARTIFACT_FILES ||
      bytes > MAX_ARTIFACT_TREE_BYTES ||
      stat.size > MAX_ARTIFACT_FILE_BYTES
    ) {
      throw new Error(`Packed ${preset} output exceeds its bounded artifact census.`);
    }
    const segments = relative.split('/');
    if (segments.includes('__kovo') || segments.includes('.vite')) {
      throw new Error(`Packed ${preset} output contains development-only path ${relative}.`);
    }
    if (!TEXT_ARTIFACT_PATTERN.test(relative)) return;
    const source = readFileSync(file).toString('utf8');
    if (source.includes('\0')) {
      throw new Error(`Packed ${preset} text artifact contains NUL: ${relative}.`);
    }
    for (const forbidden of DEVELOPMENT_ARTIFACT_PATTERNS) {
      if (forbidden.pattern.test(source)) {
        throw new Error(`Packed ${preset} output contains ${forbidden.label} in ${relative}.`);
      }
    }
  });
  if (files === 0) throw new Error(`Packed ${preset} output contains no deployable files.`);
}

function walkRegularFiles(root, visit, relativeRoot = '') {
  for (const entry of readdirSync(root, { withFileTypes: true }).sort((left, right) =>
    compareUtf8(left.name, right.name),
  )) {
    const file = path.join(root, entry.name);
    const relative = relativeRoot ? `${relativeRoot}/${entry.name}` : entry.name;
    const stat = lstatSync(file);
    if (stat.isSymbolicLink()) throw new Error(`Inspected tree contains symlink ${relative}.`);
    if (stat.isDirectory()) {
      walkRegularFiles(file, visit, relative);
      continue;
    }
    if (!stat.isFile()) throw new Error(`Inspected tree contains non-regular entry ${relative}.`);
    visit(file, relative, stat);
  }
}

function presetOutputRoot(preset, outDir) {
  assertSupportedPreset(preset);
  if (preset === 'node') return path.join(outDir, 'server');
  if (preset === 'vercel') return path.join(outDir, '.vercel', 'output');
  return path.join(outDir, 'cloudflare');
}

function assertSupportedPreset(preset) {
  if (!SUPPORTED_PRESETS.includes(preset)) {
    throw new TypeError(`Unsupported packed deployment preset ${String(preset)}.`);
  }
}

function readJson(file, label) {
  let value;
  try {
    value = JSON.parse(readBoundedRegularFile(file, label).toString('utf8'));
  } catch (error) {
    throw new Error(
      `${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return value;
}

function readBoundedRegularFile(file, label) {
  const stat = lstatSync(file);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.size < 1 ||
    stat.size > MAX_ARTIFACT_FILE_BYTES
  ) {
    throw new Error(`${label} must be one bounded regular non-symlink file.`);
  }
  return readFileSync(file);
}

function realDirectory(value, label) {
  const resolved = realpathSync(path.resolve(value));
  const stat = lstatSync(resolved);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`${label} must be a real non-symlink directory.`);
  }
  return resolved;
}

function runCommand(command, { cwd, environment, label, timeoutMs }) {
  const result = spawnSync(command[0], command.slice(1), {
    cwd,
    encoding: 'utf8',
    env: environment,
    maxBuffer: MAX_COMMAND_OUTPUT_BYTES,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: timeoutMs,
  });
  if (result.error || result.signal !== null || result.status !== 0) {
    throw new Error(
      `Packed preset consumer ${label} failed: ${
        result.error?.message ??
        [
          result.stderr?.trim(),
          result.stdout?.trim(),
          result.signal,
          `exit ${String(result.status)}`,
        ]
          .filter(Boolean)
          .join('\n')
      }`,
    );
  }
  return Object.freeze({
    stderr: result.stderr ?? '',
    stdout: result.stdout ?? '',
  });
}

function isSha256(value) {
  return typeof value === 'string' && /^sha256:[0-9a-f]{64}$/u.test(value);
}

function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex');
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left), Buffer.from(right));
}

if (isMainEntry(import.meta.url)) await runGate(checkPackedPresetConsumers);
