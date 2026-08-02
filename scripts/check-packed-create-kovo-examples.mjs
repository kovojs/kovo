#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { materializePackedPackage, packageSetIdentity } from './golden-journey/packed-app.mjs';
import {
  loadAuthenticatedPackedConsumerInputs,
  materializeAuthenticatedTarballSet,
  rewriteScaffoldDependenciesToPackedTarballs,
  snapshotAuthenticatedTarballBytes,
} from './lib/authenticated-packed-consumer.mjs';
import { isMainEntry, runGate } from './lib/cli-entry.mjs';
import { repoRoot } from './release-packages.mjs';

export { snapshotAuthenticatedTarballBytes };

export const PACKED_CREATE_KOVO_EXAMPLES_SCHEMA = 'kovo.packed-create-kovo-examples/v1';
export const PACKED_CREATE_KOVO_EXAMPLE_NAMES = Object.freeze(['crm', 'commerce']);

const DEFAULT_PACKED_MANIFEST = path.join(repoRoot, '.release', 'packed-packages.json');
const COMMAND_TIMEOUT_MS = 10 * 60_000;
const MAX_COMMAND_OUTPUT_BYTES = 32 * 1024;
const RETAINED_CONFIG_FRAGMENT = `preset: node({
    retention: {
      hours: 24,
      immutableClientModules: 'retained',
      priorTokenQueryReads: 'retained',
    },
  })`;

export function parsePackedCreateKovoExamplesArgs(argv) {
  let packedManifest = DEFAULT_PACKED_MANIFEST;
  let sawPackedManifest = false;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token !== '--packed-manifest') {
      throw new Error(`Unknown packed create-kovo examples argument ${JSON.stringify(token)}.`);
    }
    if (sawPackedManifest) {
      throw new Error('--packed-manifest may be provided only once.');
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('-')) {
      throw new Error('--packed-manifest requires a value.');
    }
    packedManifest = path.resolve(repoRoot, value);
    sawPackedManifest = true;
    index += 1;
  }
  return Object.freeze({ packedManifest });
}

/**
 * Authenticate one existing release manifest and snapshot every exact tarball byte sequence.
 *
 * The manifest is read before and after authentication/snapshotting so a concurrent replacement
 * cannot silently bind the creator to one package set and the generated consumers to another.
 * No pack command or workspace package source participates in this path.
 */
export function loadPackedCreateKovoExampleInputs(packedManifest) {
  return loadAuthenticatedPackedConsumerInputs(packedManifest);
}

export function assertExampleScaffoldReleaseVersions(appRoot, packedPackages, example) {
  const manifest = readExampleManifest(appRoot);
  if (manifest.name !== `packed-${example}`) {
    throw new Error(`${example} packed scaffold has the wrong package name`);
  }
  const expectedScripts = {
    build: 'kovo build ./src/scaffold-app.tsx',
    test: 'vitest --run --config vitest.config.ts',
    typecheck: 'tsc --noEmit',
  };
  for (const [name, value] of Object.entries(expectedScripts)) {
    if (manifest.scripts?.[name] !== value) {
      throw new Error(`${example} packed scaffold script ${name} drifted`);
    }
  }
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    for (const [name, version] of Object.entries(manifest[field] ?? {})) {
      if (!name.startsWith('@kovojs/')) continue;
      const pkg = packedPackages.get(name);
      if (pkg === undefined || version !== pkg.version) {
        throw new Error(
          `${example} packed creator emitted ${name}=${String(version)} outside its manifest set`,
        );
      }
    }
  }
}

export function assertExampleUsesAuthenticatedTarballs(appRoot, packedPackages, example) {
  const manifest = readExampleManifest(appRoot);
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    for (const [name, specifier] of Object.entries(manifest[field] ?? {})) {
      if (typeof specifier !== 'string' || specifier.startsWith('workspace:')) {
        throw new Error(`${example} ${field}.${name} is not an installable packed specifier`);
      }
      if (!name.startsWith('@kovojs/')) continue;
      const pkg = packedPackages.get(name);
      const expected = pkg === undefined ? undefined : pathToFileURL(pkg.tarballPath).href;
      if (specifier !== expected) {
        throw new Error(`${example} ${field}.${name} is not bound to the authenticated tarball`);
      }
    }
  }
  for (const [name, pkg] of packedPackages) {
    if (!name.startsWith('@kovojs/')) continue;
    if (manifest.pnpm?.overrides?.[name] !== pathToFileURL(pkg.tarballPath).href) {
      throw new Error(`${example} pnpm override for ${name} is not manifest-bound`);
    }
  }
}

export function assertRetainedExampleBuildPosture(appRoot, example) {
  const config = readFileSync(path.join(appRoot, 'kovo.config.ts'), 'utf8');
  if (
    !config.includes(RETAINED_CONFIG_FRAGMENT) ||
    !config.includes('SPEC §14: this declaration is a deployment assertion')
  ) {
    throw new Error(`${example} packed scaffold does not declare the reviewed retained posture`);
  }
}

export function packedExampleVerificationCommands(storeRoot) {
  return Object.freeze([
    Object.freeze({
      command: Object.freeze([
        'pnpm',
        'install',
        '--ignore-workspace',
        '--no-frozen-lockfile',
        '--ignore-scripts',
        '--strict-peer-dependencies',
        '--store-dir',
        storeRoot,
      ]),
      phase: 'install',
    }),
    Object.freeze({
      command: Object.freeze(['pnpm', 'exec', 'kovo', 'check', 'lifecycle']),
      phase: 'lifecycle',
    }),
    Object.freeze({ command: Object.freeze(['pnpm', 'rebuild']), phase: 'rebuild' }),
    Object.freeze({
      command: Object.freeze(['pnpm', 'exec', 'tsc', '--noEmit']),
      phase: 'typecheck',
    }),
    Object.freeze({
      // Bare `kovo check` owns the default src/app.tsx journey. These named examples use their
      // authenticated scaffold entry, so exercise the documented explicit current-source form.
      command: Object.freeze(['pnpm', 'exec', 'kovo', 'check', 'source', './src/scaffold-app.tsx']),
      phase: 'check',
    }),
    Object.freeze({
      command: Object.freeze(['pnpm', 'exec', 'kovo', 'build', './src/scaffold-app.tsx']),
      phase: 'build',
    }),
    Object.freeze({
      // The generated test is allowed to consume only the graph produced by the successful build.
      command: Object.freeze(['pnpm', 'exec', 'vitest', '--run', '--config', 'vitest.config.ts']),
      phase: 'test',
    }),
  ]);
}

export function runPackedCreateKovoExamples({
  commandRunner = runPackedExampleCommand,
  log = (line) => process.stderr.write(`${line}\n`),
  packedManifest = DEFAULT_PACKED_MANIFEST,
  temporaryParent = os.tmpdir(),
} = {}) {
  const authenticated = loadPackedCreateKovoExampleInputs(packedManifest);
  const temporaryRoot = mkdtempSync(path.join(temporaryParent, 'kovo-packed-create-examples-'));
  try {
    const packedPackages = materializeAuthenticatedTarballSet(
      authenticated.packages,
      path.join(temporaryRoot, 'tarballs'),
    );
    const creatorRoot = path.join(temporaryRoot, 'creator');
    const createKovo = requirePackedPackage(packedPackages, 'create-kovo');
    const core = requirePackedPackage(packedPackages, '@kovojs/core');
    materializePackedPackage(createKovo, path.join(creatorRoot, 'node_modules/create-kovo'));
    materializePackedPackage(core, path.join(creatorRoot, 'node_modules/@kovojs/core'));
    const creatorRelative =
      typeof createKovo.manifest?.bin === 'string'
        ? createKovo.manifest.bin
        : createKovo.manifest?.bin?.['create-kovo'];
    if (creatorRelative !== './dist/index.mjs') {
      throw new Error('authenticated create-kovo manifest does not expose ./dist/index.mjs');
    }
    const creator = path.join(creatorRoot, 'node_modules/create-kovo/dist/index.mjs');
    if (!existsSync(creator)) {
      throw new Error('authenticated create-kovo tarball is missing its declared binary');
    }

    const examples = [];
    for (const example of PACKED_CREATE_KOVO_EXAMPLE_NAMES) {
      const appRoot = path.join(temporaryRoot, example, 'app');
      const phases = [];
      const create = [
        process.execPath,
        creator,
        appRoot,
        '--name',
        `packed-${example}`,
        '--disable-git',
        '--example',
        example,
        '--retention',
        'retained-24h',
      ];
      phases.push(
        runObservedCommand(commandRunner, create, {
          cwd: temporaryRoot,
          label: example,
          log,
          phase: 'create',
        }),
      );
      assertExampleScaffoldReleaseVersions(appRoot, packedPackages, example);
      assertRetainedExampleBuildPosture(appRoot, example);
      rewriteScaffoldDependenciesToPackedTarballs(appRoot, packedPackages);
      assertExampleUsesAuthenticatedTarballs(appRoot, packedPackages, example);

      const storeRoot = path.join(temporaryRoot, 'pnpm-store');
      for (const step of packedExampleVerificationCommands(storeRoot)) {
        phases.push(
          runObservedCommand(commandRunner, step.command, {
            cwd: appRoot,
            label: example,
            log,
            phase: step.phase,
          }),
        );
        if (step.phase === 'install') {
          assertInstalledDirectPackages(appRoot, packedPackages, example);
        }
      }
      examples.push(
        Object.freeze({
          name: example,
          pass: true,
          phases,
          retention: Object.freeze({
            hours: 24,
            immutableClientModules: 'retained',
            priorTokenQueryReads: 'retained',
          }),
        }),
      );
    }
    return Object.freeze({
      schema: PACKED_CREATE_KOVO_EXAMPLES_SCHEMA,
      manifestSha256: authenticated.manifestSha256,
      packageSet: packageSetIdentity(packedPackages),
      examples,
      pass: true,
    });
  } finally {
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
}

export function runPackedExampleCommand(command, { cwd, env = process.env, phase }) {
  const [file, ...args] = command;
  const started = Date.now();
  const result = spawnSync(file, args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...env,
      CI: '1',
      npm_config_audit: 'false',
      npm_config_fund: 'false',
    },
    killSignal: 'SIGKILL',
    maxBuffer: 128 * 1024 * 1024,
    timeout: COMMAND_TIMEOUT_MS,
  });
  const durationMs = Date.now() - started;
  if (result.error || result.signal || result.status !== 0) {
    throw new Error(
      [
        `${phase} failed: exit=${String(result.status)} signal=${String(result.signal)}`,
        result.error instanceof Error ? result.error.message : '',
        boundedOutput(result.stderr),
        boundedOutput(result.stdout),
      ]
        .filter(Boolean)
        .join('\n'),
    );
  }
  return Object.freeze({ durationMs, status: 0 });
}

function runObservedCommand(commandRunner, command, { cwd, label, log, phase }) {
  log(`[packed-create-kovo-examples] ${label}:${phase}`);
  const result = commandRunner(command, { cwd, phase });
  if (result?.status !== 0 || !Number.isFinite(result?.durationMs) || result.durationMs < 0) {
    throw new Error(`${label}:${phase} command runner returned invalid success evidence`);
  }
  return Object.freeze({
    durationMs: result.durationMs,
    name: phase,
    status: 0,
  });
}

function assertInstalledDirectPackages(appRoot, packedPackages, example) {
  const manifest = readExampleManifest(appRoot);
  for (const field of ['dependencies', 'devDependencies']) {
    for (const name of Object.keys(manifest[field] ?? {})) {
      if (!name.startsWith('@kovojs/')) continue;
      const pkg = requirePackedPackage(packedPackages, name);
      const installedManifestPath = path.join(appRoot, 'node_modules', name, 'package.json');
      const installedRoot = realpathSync(path.dirname(installedManifestPath));
      if (isWithin(repoRoot, installedRoot)) {
        throw new Error(`${example} installed ${name} from workspace source`);
      }
      const installedManifest = JSON.parse(readFileSync(installedManifestPath, 'utf8'));
      if (JSON.stringify(installedManifest) !== JSON.stringify(pkg.manifest)) {
        throw new Error(`${example} installed ${name} outside the authenticated packed manifest`);
      }
    }
  }
  const lockfile = readFileSync(path.join(appRoot, 'pnpm-lock.yaml'), 'utf8');
  if (/(?:^|[\s'"])workspace:|(?:^|[\s'"])link:/mu.test(lockfile)) {
    throw new Error(`${example} packed install resolved workspace or linked source`);
  }
}

function requirePackedPackage(packages, name) {
  const pkg = packages.get(name);
  if (
    pkg?.name !== name ||
    typeof pkg.version !== 'string' ||
    typeof pkg.tarballPath !== 'string' ||
    !Array.isArray(pkg.entries)
  ) {
    throw new Error(`packed create-kovo examples are missing authenticated ${name}`);
  }
  return pkg;
}

function readExampleManifest(appRoot) {
  const manifest = JSON.parse(readFileSync(path.join(appRoot, 'package.json'), 'utf8'));
  if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error('packed create-kovo example package.json must be an object');
  }
  return manifest;
}

function isWithin(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return (
    relative === '' ||
    (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
}

function boundedOutput(value) {
  const bytes = Buffer.from(String(value ?? ''));
  if (bytes.byteLength <= MAX_COMMAND_OUTPUT_BYTES) return bytes.toString('utf8').trim();
  return `${bytes.subarray(0, MAX_COMMAND_OUTPUT_BYTES).toString('utf8')}\n[TRUNCATED]`;
}

export function checkPackedCreateKovoExamples(argv = process.argv.slice(2)) {
  const options = parsePackedCreateKovoExamplesArgs(argv);
  const report = runPackedCreateKovoExamples(options);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  return report.pass;
}

if (isMainEntry(import.meta.url)) await runGate(checkPackedCreateKovoExamples);
