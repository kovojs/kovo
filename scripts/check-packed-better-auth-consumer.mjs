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

const BETTER_AUTH_PACKAGE = '@kovojs/better-auth';
const SERVER_PACKAGE = '@kovojs/server';
const ROOT_EXPORTS = Object.freeze([
  'BetterAuthAppBindings',
  'BetterAuthAppBindingsOptions',
  'BetterAuthAppCredentialResult',
  'BetterAuthAppRequest',
  'BetterAuthAppSignInMutation',
  'BetterAuthAppSignOutMutation',
  'BetterAuthCsrfRequestLike',
  'BetterAuthEnvironmentCsrfOptions',
  'BetterAuthMountAdapter',
  'BetterAuthPasswordResetMailDoor',
  'BetterAuthPasswordResetMailMessage',
  'BetterAuthPasswordResetMailSender',
  'BetterAuthPasswordResetOptions',
  'BetterAuthRoleRequest',
  'BetterAuthRoleSession',
  'BetterAuthRoleUser',
  'BetterAuthSafeField',
  'BetterAuthSanitizedRecord',
  'BetterAuthSanitizedSessionPayload',
  'BetterAuthSanitizedValue',
  'BetterAuthSessionMapper',
  'authed',
  'betterAuthCsrfFromEnvironment',
  'betterAuthPasswordResetMailDoor',
  'mount',
  'role',
]);
const POSTGRES_HUMAN_EXPORTS = Object.freeze(['createBetterAuthPostgresAppBindings']);
const SQLITE_HUMAN_EXPORTS = Object.freeze(['createBetterAuthSqliteAppBindings']);
const NEUTRAL_GENERATED_EXPORTS = Object.freeze([
  'BetterAuthBindings',
  'BetterAuthBindingsOptions',
  'BetterAuthDevelopmentSeed',
  'BetterAuthEnvironmentBindingsOptions',
  'BetterAuthGeneratedCredentialResult',
  'BetterAuthGeneratedPasswordResetMutation',
  'BetterAuthGeneratedRequest',
  'BetterAuthGeneratedSignInMutation',
  'BetterAuthGeneratedSignOutMutation',
]);
const POSTGRES_GENERATED_EXPORTS = Object.freeze([
  'BetterAuthPostgresBindings',
  'BetterAuthPostgresBindingsOptions',
  'BetterAuthPostgresEnvironmentBindingsOptions',
  'BetterAuthPostgresSecret',
  'betterAuthPostgresSecret',
  'createBetterAuthPostgresBindings',
  'createBetterAuthPostgresBindingsFromEnvironment',
]);
const SQLITE_GENERATED_EXPORTS = Object.freeze([
  'BetterAuthSqliteBindings',
  'BetterAuthSqliteBindingsOptions',
  'BetterAuthSqliteDevelopmentSeed',
  'BetterAuthSqliteEnvironmentBindingsOptions',
  'BetterAuthSqliteSecret',
  'betterAuthSqliteSecret',
  'createBetterAuthSqliteBindings',
  'createBetterAuthSqliteBindingsFromEnvironment',
]);
const ROOT_RUNTIME_EXPORTS = Object.freeze([
  'authed',
  'betterAuthCsrfFromEnvironment',
  'betterAuthPasswordResetMailDoor',
  'mount',
  'role',
]);
const REQUIRED_EXPORT_TARGETS = Object.freeze({
  '.': Object.freeze({ default: './dist/index.mjs', types: './dist/index.d.mts' }),
  './postgres': Object.freeze({
    default: './dist/public-postgres.mjs',
    types: './dist/public-postgres.d.mts',
  }),
  './sqlite': Object.freeze({
    default: './dist/public-sqlite.mjs',
    types: './dist/public-sqlite.d.mts',
  }),
  './generated': Object.freeze({
    default: './dist/generated.mjs',
    types: './dist/generated.d.mts',
  }),
  './generated/postgres': Object.freeze({
    default: './dist/generated-postgres.mjs',
    types: './dist/generated-postgres.d.mts',
  }),
  './generated/sqlite': Object.freeze({
    default: './dist/generated-sqlite.mjs',
    types: './dist/generated-sqlite.d.mts',
  }),
});

export function assertPackedBetterAuthManifest(manifest) {
  if (manifest?.name !== BETTER_AUTH_PACKAGE || typeof manifest.version !== 'string') {
    throw new Error('Packed Better Auth manifest has the wrong package identity');
  }
  for (const [subpath, expected] of Object.entries(REQUIRED_EXPORT_TARGETS)) {
    const actual = manifest.exports?.[subpath];
    if (actual?.types !== expected.types || actual?.default !== expected.default) {
      throw new Error(`Packed Better Auth ${subpath} does not resolve built output`);
    }
  }
  if (
    manifest.dependencies?.['better-auth'] !== '1.6.22' ||
    manifest.dependencies?.['drizzle-orm'] !== '0.45.2' ||
    manifest.peerDependencies?.['better-auth'] !== undefined ||
    manifest.dependencies?.[SERVER_PACKAGE] !== undefined ||
    manifest.peerDependencies?.[SERVER_PACKAGE] !== manifest.version
  ) {
    throw new Error('Packed Better Auth dependencies drifted from the reviewed adapter boundary');
  }
}

export function packedBetterAuthDeclarationExports(source, fileName = 'consumer.d.mts') {
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

export function assertPackedBetterAuthDeclarations({
  humanPostgres,
  humanSqlite,
  neutral,
  postgres,
  root,
  sqlite,
}) {
  const neutralExports = packedBetterAuthDeclarationExports(neutral, 'generated.d.mts');
  assertExactExports(
    packedBetterAuthDeclarationExports(root, 'index.d.mts'),
    ROOT_EXPORTS,
    'human root',
  );
  assertExactExports(
    packedBetterAuthDeclarationExports(humanPostgres, 'public-postgres.d.mts'),
    POSTGRES_HUMAN_EXPORTS,
    'human Postgres contract',
  );
  assertExactExports(
    packedBetterAuthDeclarationExports(humanSqlite, 'public-sqlite.d.mts'),
    SQLITE_HUMAN_EXPORTS,
    'human SQLite contract',
  );
  assertExactExports(neutralExports, NEUTRAL_GENERATED_EXPORTS, 'neutral generated contract');
  assertExactExports(
    packedBetterAuthDeclarationExports(postgres, 'generated-postgres.d.mts'),
    POSTGRES_GENERATED_EXPORTS,
    'Postgres generated contract',
  );
  assertExactExports(
    packedBetterAuthDeclarationExports(sqlite, 'generated-sqlite.d.mts'),
    SQLITE_GENERATED_EXPORTS,
    'SQLite generated contract',
  );
  for (const moved of [...POSTGRES_GENERATED_EXPORTS, ...SQLITE_GENERATED_EXPORTS]) {
    if (ROOT_EXPORTS.includes(moved)) {
      throw new Error(`Packed Better Auth root duplicates generated export ${moved}`);
    }
    if (neutralExports.includes(moved)) {
      throw new Error(`Packed Better Auth neutral ABI duplicates backend export ${moved}`);
    }
  }
}

export function packedBetterAuthConsumerManifest(packedPackages, packageManager, nodeTypesVersion) {
  const tarballs = Object.fromEntries(
    packedPackages.map((pkg) => [
      pkg.name,
      pathToFileURL(path.resolve(repoRoot, pkg.tarball)).href,
    ]),
  );
  const betterAuth = packedPackages.find((pkg) => pkg.name === BETTER_AUTH_PACKAGE);
  const server = packedPackages.find((pkg) => pkg.name === SERVER_PACKAGE);
  if (
    !betterAuth?.manifest ||
    !server?.manifest ||
    !tarballs[BETTER_AUTH_PACKAGE] ||
    !tarballs[SERVER_PACKAGE]
  ) {
    throw new Error('Packed release manifest is missing Better Auth or server');
  }
  const requiredServerPeers = Object.fromEntries(
    Object.entries(server.manifest.peerDependencies ?? {}).filter(
      ([name]) => server.manifest.peerDependenciesMeta?.[name]?.optional !== true,
    ),
  );
  const serverUsesPg =
    typeof server.manifest.dependencies?.pg === 'string' ||
    typeof server.manifest.peerDependencies?.pg === 'string';
  const serverTypeDependencies =
    !serverUsesPg || typeof server.manifest.devDependencies?.['@types/pg'] !== 'string'
      ? {}
      : { '@types/pg': server.manifest.devDependencies['@types/pg'] };
  const sqliteRuntimeDependencies =
    typeof server.manifest.peerDependencies?.['better-sqlite3'] !== 'string'
      ? {}
      : {
          ...(typeof server.manifest.devDependencies?.['@types/better-sqlite3'] === 'string'
            ? {
                '@types/better-sqlite3': server.manifest.devDependencies['@types/better-sqlite3'],
              }
            : {}),
          'better-sqlite3': server.manifest.peerDependencies['better-sqlite3'],
        };
  return {
    dependencies: {
      [BETTER_AUTH_PACKAGE]: tarballs[BETTER_AUTH_PACKAGE],
      [SERVER_PACKAGE]: tarballs[SERVER_PACKAGE],
      '@types/node': nodeTypesVersion,
      ...serverTypeDependencies,
      ...sqliteRuntimeDependencies,
      ...requiredServerPeers,
    },
    name: 'kovo-packed-better-auth-consumer',
    packageManager,
    pnpm: {
      onlyBuiltDependencies: ['better-sqlite3'],
      overrides: tarballs,
    },
    private: true,
    type: 'module',
    version: '0.0.0',
  };
}

export function checkPackedBetterAuthConsumer() {
  const repositoryManifest = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  const packedManifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const packedPackages = validatePackedReleaseManifest(packedManifest, releasePackages());
  const betterAuth = packedPackages.find((pkg) => pkg.name === BETTER_AUTH_PACKAGE);
  if (!betterAuth) throw new Error(`Packed release manifest is missing ${BETTER_AUTH_PACKAGE}`);
  for (const pkg of packedPackages)
    verifyPackedAttestation(pkg, path.resolve(repoRoot, pkg.tarball));
  assertPackedBetterAuthManifest(betterAuth.manifest);

  const consumerRoot = mkdtempSync(path.join(os.tmpdir(), 'kovo-packed-better-auth-consumer-'));
  try {
    writeFileSync(
      path.join(consumerRoot, 'package.json'),
      `${JSON.stringify(
        packedBetterAuthConsumerManifest(
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
    runCommand('pnpm', ['rebuild', 'better-sqlite3'], consumerRoot, 'SQLite native rebuild');

    const packageRoot = path.join(consumerRoot, 'node_modules', '@kovojs', 'better-auth');
    const installedManifest = JSON.parse(
      readFileSync(path.join(packageRoot, 'package.json'), 'utf8'),
    );
    assertPackedBetterAuthManifest(installedManifest);
    assertPackedBetterAuthDeclarations({
      humanPostgres: readDeclaration(packageRoot, installedManifest, './postgres'),
      humanSqlite: readDeclaration(packageRoot, installedManifest, './sqlite'),
      neutral: readDeclaration(packageRoot, installedManifest, './generated'),
      postgres: readDeclaration(packageRoot, installedManifest, './generated/postgres'),
      root: readDeclaration(packageRoot, installedManifest, '.'),
      sqlite: readDeclaration(packageRoot, installedManifest, './generated/sqlite'),
    });
    assertPackedTypeConsumer(consumerRoot);
    assertPackedRuntimeConsumer(consumerRoot, 'postgres');
    assertPackedRuntimeConsumer(consumerRoot, 'sqlite');
    process.stdout.write(
      'Packed Better Auth consumer passed (28 human declarations, neutral generated types, isolated backend runtimes).\n',
    );
  } finally {
    rmSync(consumerRoot, { force: true, recursive: true });
  }
}

function readDeclaration(packageRoot, manifest, subpath) {
  const target = manifest.exports[subpath].types;
  const resolved = path.resolve(packageRoot, target);
  if (resolved === packageRoot || !resolved.startsWith(`${packageRoot}${path.sep}`)) {
    throw new Error(`Packed Better Auth ${subpath} declaration target escapes its package`);
  }
  return readFileSync(resolved, 'utf8');
}

function assertPackedTypeConsumer(consumerRoot) {
  const sourcePath = path.join(consumerRoot, 'consumer.ts');
  writeFileSync(
    sourcePath,
    `import type {
  BetterAuthBindings,
  BetterAuthDevelopmentSeed,
  BetterAuthGeneratedRequest,
} from '@kovojs/better-auth/generated';
import type {
  BetterAuthPostgresBindings,
} from '@kovojs/better-auth/generated/postgres';
import {
  createBetterAuthPostgresBindingsFromEnvironment,
} from '@kovojs/better-auth/generated/postgres';
import {
  createBetterAuthPostgresAppBindings,
} from '@kovojs/better-auth/postgres';
import type {
  BetterAuthSqliteBindings,
} from '@kovojs/better-auth/generated/sqlite';
import {
  createBetterAuthSqliteBindingsFromEnvironment,
} from '@kovojs/better-auth/generated/sqlite';
import {
  createBetterAuthSqliteAppBindings,
} from '@kovojs/better-auth/sqlite';
import { authed, mount, role } from '@kovojs/better-auth';

// @ts-expect-error generated backend construction is absent from the human root.
import { createBetterAuthPostgresBindings } from '@kovojs/better-auth';
// @ts-expect-error app-runtime binding is isolated on the Postgres human subpath.
import { createBetterAuthPostgresAppBindings as leakedPostgresAppBindings } from '@kovojs/better-auth';
// @ts-expect-error app-runtime binding is isolated on the SQLite human subpath.
import { createBetterAuthSqliteAppBindings as leakedSqliteAppBindings } from '@kovojs/better-auth';
// @ts-expect-error internal request carriers are absent from the human root.
import type { BetterAuthBindingRequest } from '@kovojs/better-auth';

interface RequestShape extends BetterAuthGeneratedRequest {
  session?: { id: string } | null;
}
interface SessionShape { id: string }
declare const neutral: BetterAuthBindings<RequestShape, SessionShape>;
const postgres: BetterAuthPostgresBindings<RequestShape, SessionShape> = neutral;
const sqlite: BetterAuthSqliteBindings<RequestShape, SessionShape> = neutral;
const seed: BetterAuthDevelopmentSeed = { email: 'demo@example.test', name: 'Demo' };
void [
  authed<RequestShape>(),
  role('admin'),
  mount('/api/auth', neutral.mountAdapter),
  postgres,
  sqlite,
  seed,
  createBetterAuthPostgresBindings,
  createBetterAuthPostgresBindingsFromEnvironment,
  createBetterAuthPostgresAppBindings,
  createBetterAuthSqliteBindingsFromEnvironment,
  createBetterAuthSqliteAppBindings,
  leakedPostgresAppBindings,
  leakedSqliteAppBindings,
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
    target: ts.ScriptTarget.ES2024,
    types: ['node'],
  });
  const diagnostics = ts
    .getPreEmitDiagnostics(program)
    .filter((diagnostic) => !isThirdPartyDeclarationDiagnostic(diagnostic));
  if (diagnostics.length > 0) {
    throw new Error(
      `Packed Better Auth type consumer failed:\n${ts.formatDiagnosticsWithColorAndContext(
        diagnostics,
        {
          getCanonicalFileName: (fileName) => fileName,
          getCurrentDirectory: () => consumerRoot,
          getNewLine: () => '\n',
        },
      )}`,
    );
  }
}

function assertPackedRuntimeConsumer(consumerRoot, backend) {
  const isPostgres = backend === 'postgres';
  const humanExpected = [
    isPostgres ? 'createBetterAuthPostgresAppBindings' : 'createBetterAuthSqliteAppBindings',
  ];
  const expected = isPostgres
    ? [
        'betterAuthPostgresSecret',
        'createBetterAuthPostgresBindings',
        'createBetterAuthPostgresBindingsFromEnvironment',
      ]
    : [
        'betterAuthSqliteSecret',
        'createBetterAuthSqliteBindings',
        'createBetterAuthSqliteBindingsFromEnvironment',
      ];
  const secret = isPostgres ? 'betterAuthPostgresSecret' : 'betterAuthSqliteSecret';
  const source = `await import('@kovojs/server/${backend}');
await import('@kovojs/server/runtime-bootstrap');
const root = await import('@kovojs/better-auth');
const humanBackend = await import('@kovojs/better-auth/${backend}');
const neutral = await import('@kovojs/better-auth/generated');
const backend = await import('@kovojs/better-auth/generated/${backend}');
if (JSON.stringify(Object.keys(root).sort()) !== ${JSON.stringify(
    JSON.stringify([...ROOT_RUNTIME_EXPORTS]),
  )}) throw new Error('human root runtime drifted');
if (JSON.stringify(Object.keys(humanBackend).sort()) !== ${JSON.stringify(
    JSON.stringify(humanExpected),
  )}) throw new Error('human ${backend} runtime drifted');
if (Object.keys(neutral).length !== 0) throw new Error('neutral generated entry is not type-only');
if (JSON.stringify(Object.keys(backend).sort()) !== ${JSON.stringify(
    JSON.stringify(expected),
  )}) throw new Error('generated ${backend} runtime drifted');
let weakRefused = false;
try { backend.${secret}('too-short'); } catch (error) {
  weakRefused = error instanceof TypeError && error.message.includes('at least 32 characters');
}
if (!weakRefused) throw new Error('generated ${backend} secret floor failed');
process.stdout.write('packed-better-auth-${backend}/v1 OK\\n');
`;
  const entry = path.join(consumerRoot, `runtime-${backend}.mjs`);
  writeFileSync(entry, source, 'utf8');
  const result = spawnSync(process.execPath, [entry], {
    cwd: consumerRoot,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
    timeout: 30_000,
  });
  if (
    result.error ||
    result.signal !== null ||
    result.status !== 0 ||
    result.stderr !== '' ||
    result.stdout !== `packed-better-auth-${backend}/v1 OK\n`
  ) {
    throw new Error(
      `Packed Better Auth ${backend} runtime failed: ${result.error?.message ?? result.stderr}`,
    );
  }
}

function isThirdPartyDeclarationDiagnostic(diagnostic) {
  const sourceFile = diagnostic.file;
  if (!sourceFile?.isDeclarationFile) return false;
  const normalized = sourceFile.fileName.replaceAll(path.sep, '/');
  return normalized.includes('/node_modules/') && !normalized.includes('/node_modules/@kovojs/');
}

function assertExactExports(actual, expected, label) {
  const sortedExpected = [...expected].sort(compareStrings);
  if (JSON.stringify(actual) !== JSON.stringify(sortedExpected)) {
    throw new Error(`Packed Better Auth ${label} drifted: ${JSON.stringify(actual)}`);
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
    throw new Error(
      `Packed Better Auth consumer ${label} failed: ${
        result.error?.message ?? `${result.stderr}${result.stdout}`
      }`,
    );
  }
}

function compareStrings(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

if (isMainEntry(import.meta.url)) await runGate(checkPackedBetterAuthConsumer);
