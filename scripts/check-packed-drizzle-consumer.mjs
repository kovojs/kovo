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

const DRIZZLE_PACKAGE = '@kovojs/drizzle';
const CORE_PACKAGE = '@kovojs/core';
const DRIZZLE_ORM_PACKAGE = 'drizzle-orm';
const REVIEWED_DRIZZLE_PEER_RANGE = '>=1.0.0-rc.4 <2';
const REVIEWED_DRIZZLE_FIXTURE = '1.0.0-rc.4';
const REQUIRED_EXPORT_TARGETS = Object.freeze({
  '.': Object.freeze({
    default: './dist/runtime.mjs',
    types: './dist/runtime.d.mts',
  }),
  './internal/derive': Object.freeze({
    default: './dist/derive.mjs',
    types: './dist/derive.d.mts',
  }),
  './internal/derive-codegen': Object.freeze({
    default: './dist/derive-codegen.mjs',
    types: './dist/derive-codegen.d.mts',
  }),
  './internal/runtime-metadata': Object.freeze({
    default: './dist/runtime-metadata-internal.mjs',
    types: './dist/runtime-metadata-internal.d.mts',
  }),
  './internal/static': Object.freeze({
    default: './dist/static.mjs',
    types: './dist/static.d.mts',
  }),
});
const ROOT_EXPORTS = Object.freeze([
  'CasConflict',
  'CasResult',
  'CasSuccess',
  'DrizzleUpdateResult',
  'KovoAnalyzerFunctionSummary',
  'KovoAnalyzerPrivateScopeKind',
  'KovoColumnRef',
  'KovoConcurrencyColumnAnnotation',
  'KovoConfidentialAtRestColumnAnnotation',
  'KovoDomainRef',
  'KovoDomainTableAnnotation',
  'KovoFanAnnotation',
  'KovoGovernedColumnAnnotation',
  'KovoOwnerViaAnnotation',
  'KovoParameterizedSql',
  'KovoSecretColumnAnnotation',
  'KovoSqlIdentifier',
  'KovoSqlKeyword',
  'KovoStaticSql',
  'KovoTableAnnotation',
  'KovoTableExtraConfig',
  'KovoTrustedSql',
  'KovoViewAnnotation',
  'KovoViewExtraConfig',
  'KovoViewExtraConfigAnnotation',
  'compareAndSet',
  'kovo',
  'kovoAnalyzerSummary',
  'sql',
  'staticSql',
  'trustedSql',
]);
const INTERNAL_RUNTIME_METADATA_EXPORTS = Object.freeze([
  'KovoRuntimeAuthorizationClassification',
  'KovoRuntimeDbColumnSource',
  'KovoRuntimeDbMetadata',
  'KovoRuntimeDbTable',
  'KovoRuntimeKeySource',
  'KovoRuntimeOwnerSource',
  'KovoRuntimeOwnerViaSource',
  'KovoRuntimeTableSecurityManifest',
  'KovoRuntimeTableSecurityManifestAuthzPolicy',
  'KovoRuntimeTableSecurityManifestColumn',
  'KovoRuntimeTableSecurityManifestKey',
  'KovoRuntimeTableSecurityManifestOwner',
  'KovoRuntimeTableSecurityManifestOwnerVia',
  'KovoRuntimeTableSecurityManifestTable',
  'extractCompilerBoundKovoRuntimeDbMetadata',
  'extractKovoRuntimeDbMetadata',
  'isKovoRuntimeMetadataCollection',
]);

/**
 * Verify the installed tarball preserves the reviewed human/internal topology and peer contract.
 */
export function assertPackedDrizzleManifest(manifest) {
  if (manifest?.name !== DRIZZLE_PACKAGE || typeof manifest.version !== 'string') {
    throw new Error('Packed Drizzle manifest has the wrong package identity');
  }
  const actualSubpaths = Object.keys(manifest.exports ?? {}).sort(compareStrings);
  const expectedSubpaths = Object.keys(REQUIRED_EXPORT_TARGETS).sort(compareStrings);
  if (JSON.stringify(actualSubpaths) !== JSON.stringify(expectedSubpaths)) {
    throw new Error(`Packed Drizzle export topology drifted: ${JSON.stringify(actualSubpaths)}`);
  }
  for (const [subpath, expected] of Object.entries(REQUIRED_EXPORT_TARGETS)) {
    const actual = manifest.exports[subpath];
    if (actual?.types !== expected.types || actual?.default !== expected.default) {
      throw new Error(`Packed Drizzle ${subpath} does not resolve reviewed built output`);
    }
  }
  if (
    manifest.dependencies?.[CORE_PACKAGE] !== manifest.version ||
    manifest.peerDependencies?.[DRIZZLE_ORM_PACKAGE] !== REVIEWED_DRIZZLE_PEER_RANGE ||
    manifest.devDependencies?.[DRIZZLE_ORM_PACKAGE] !== REVIEWED_DRIZZLE_FIXTURE
  ) {
    throw new Error(
      'Packed Drizzle dependency or peer fixture drifted from the reviewed compatibility boundary',
    );
  }
  for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
    for (const [name, version] of Object.entries(manifest[field] ?? {})) {
      if (typeof version !== 'string' || version.startsWith('workspace:')) {
        throw new Error(`Packed Drizzle ${field}.${name} is not installable`);
      }
    }
  }
}

/**
 * Return every executable Drizzle peer fixture ratified by this package manifest.
 *
 * The peer range is the compatibility claim. The exact dev dependency is the finite fixture
 * actually exercised by the repository. There is currently one fixture, and it is also the
 * inclusive lower bound; Drizzle 0.45.x is deliberately outside the adapter's peer contract.
 */
export function packedDrizzlePeerFixtures(manifest) {
  assertPackedDrizzleManifest(manifest);
  return Object.freeze([
    Object.freeze({
      id: 'minimum-and-development',
      version: manifest.devDependencies[DRIZZLE_ORM_PACKAGE],
    }),
  ]);
}

export function packedDrizzleDeclarationExports(source, fileName = 'consumer.d.mts') {
  const sourceFile = parseDeclaration(source, fileName);
  const names = [];
  for (const statement of sourceFile.statements) {
    if (
      ts.isExportDeclaration(statement) &&
      statement.exportClause &&
      ts.isNamedExports(statement.exportClause)
    ) {
      for (const element of statement.exportClause.elements) names.push(element.name.text);
      continue;
    }
    if (!hasExportModifier(statement)) continue;
    if (
      ts.isClassDeclaration(statement) ||
      ts.isEnumDeclaration(statement) ||
      ts.isFunctionDeclaration(statement) ||
      ts.isInterfaceDeclaration(statement) ||
      ts.isTypeAliasDeclaration(statement)
    ) {
      if (statement.name) names.push(statement.name.text);
      continue;
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) names.push(declaration.name.text);
      }
    }
  }
  return [...new Set(names)].sort(compareStrings);
}

export function assertPackedDrizzleDeclarations({ internalRuntimeMetadata, root }) {
  assertExactExports(
    packedDrizzleDeclarationExports(root, 'runtime.d.mts'),
    ROOT_EXPORTS,
    'human root',
  );
  assertExactExports(
    packedDrizzleDeclarationExports(internalRuntimeMetadata, 'runtime-metadata-internal.d.mts'),
    INTERNAL_RUNTIME_METADATA_EXPORTS,
    'internal runtime metadata',
  );

  const sourceFile = parseDeclaration(root, 'runtime.d.mts');
  const internalNames = new Set(INTERNAL_RUNTIME_METADATA_EXPORTS);
  const internalReferences = [];
  let exposesAny = false;
  function visit(node) {
    if (node.kind === ts.SyntaxKind.AnyKeyword) exposesAny = true;
    if (ts.isIdentifier(node) && internalNames.has(node.text)) {
      internalReferences.push(node.text);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  if (exposesAny) {
    throw new Error('Packed Drizzle human declarations expose unapproved any');
  }
  if (internalReferences.length > 0) {
    throw new Error(
      `Packed Drizzle human declarations recursively leak internal runtime metadata ${internalReferences[0]}`,
    );
  }
}

export function packedDrizzleConsumerManifest(packedPackages, packageManager, fixture) {
  const tarballs = Object.fromEntries(
    packedPackages.map((pkg) => [
      pkg.name,
      pathToFileURL(path.resolve(repoRoot, pkg.tarball)).href,
    ]),
  );
  const drizzle = packedPackages.find((pkg) => pkg.name === DRIZZLE_PACKAGE);
  const core = packedPackages.find((pkg) => pkg.name === CORE_PACKAGE);
  if (
    core?.manifest === undefined ||
    drizzle?.manifest === undefined ||
    core.manifest.version !== drizzle.manifest.version ||
    tarballs[CORE_PACKAGE] === undefined ||
    tarballs[DRIZZLE_PACKAGE] === undefined ||
    typeof packageManager !== 'string' ||
    fixture?.version !== REVIEWED_DRIZZLE_FIXTURE
  ) {
    throw new Error('Packed Drizzle consumer is missing a reviewed package or peer fixture');
  }
  return {
    dependencies: {
      [CORE_PACKAGE]: tarballs[CORE_PACKAGE],
      [DRIZZLE_PACKAGE]: tarballs[DRIZZLE_PACKAGE],
      [DRIZZLE_ORM_PACKAGE]: fixture.version,
    },
    name: `kovo-packed-drizzle-consumer-${fixture.id}`,
    packageManager,
    pnpm: { overrides: tarballs },
    private: true,
    type: 'module',
    version: '0.0.0',
  };
}

export function checkPackedDrizzleConsumer() {
  const repositoryManifest = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  const packedManifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const packedPackages = validatePackedReleaseManifest(packedManifest, releasePackages());
  const drizzle = packedPackages.find((pkg) => pkg.name === DRIZZLE_PACKAGE);
  if (drizzle === undefined) {
    throw new Error(`Packed release manifest is missing ${DRIZZLE_PACKAGE}`);
  }
  for (const pkg of packedPackages) {
    verifyPackedAttestation(pkg, path.resolve(repoRoot, pkg.tarball));
  }
  assertPackedDrizzleManifest(drizzle.manifest);
  const fixtures = packedDrizzlePeerFixtures(drizzle.manifest);

  for (const fixture of fixtures) {
    checkPackedDrizzleFixture(packedPackages, repositoryManifest.packageManager, fixture);
  }
  process.stdout.write(
    `Packed Drizzle consumer passed (31 human declarations, 17 internal metadata declarations, ${fixtures.length} explicit peer fixture, Postgres + SQLite typed annotations, managed SQL witnesses).\n`,
  );
}

function checkPackedDrizzleFixture(packedPackages, packageManager, fixture) {
  const consumerRoot = mkdtempSync(path.join(os.tmpdir(), 'kovo-packed-drizzle-consumer-'));
  try {
    writeFileSync(
      path.join(consumerRoot, 'package.json'),
      `${JSON.stringify(
        packedDrizzleConsumerManifest(packedPackages, packageManager, fixture),
        null,
        2,
      )}\n`,
      'utf8',
    );
    runCommand(
      'pnpm',
      ['install', '--ignore-scripts', '--no-frozen-lockfile', '--strict-peer-dependencies'],
      consumerRoot,
      `${fixture.id} install`,
    );

    const packageRoot = path.join(consumerRoot, 'node_modules', '@kovojs', 'drizzle');
    const installedManifest = JSON.parse(
      readFileSync(path.join(packageRoot, 'package.json'), 'utf8'),
    );
    assertPackedDrizzleManifest(installedManifest);
    assertPackedDrizzleDeclarations({
      internalRuntimeMetadata: readDeclaration(
        packageRoot,
        installedManifest,
        './internal/runtime-metadata',
      ),
      root: readDeclaration(packageRoot, installedManifest, '.'),
    });
    assertPackedTypeConsumer(consumerRoot);
    assertPackedRuntimeConsumer(consumerRoot);
  } finally {
    rmSync(consumerRoot, { force: true, recursive: true });
  }
}

function readDeclaration(packageRoot, manifest, subpath) {
  const target = manifest.exports[subpath].types;
  const resolved = path.resolve(packageRoot, target);
  if (resolved === packageRoot || !resolved.startsWith(`${packageRoot}${path.sep}`)) {
    throw new Error(`Packed Drizzle ${subpath} declaration target escapes its package`);
  }
  return readFileSync(resolved, 'utf8');
}

function assertPackedTypeConsumer(consumerRoot) {
  const preamble = `import {
  kovo,
  sql,
  staticSql,
  type KovoStaticSql,
} from '@kovojs/drizzle';
import { integer as pgInteger, pgTable, text as pgText } from 'drizzle-orm/pg-core';
import {
  integer as sqliteInteger,
  sqliteTable,
  text as sqliteText,
} from 'drizzle-orm/sqlite-core';

const accounts = pgTable(
  'packed_accounts',
  {
    id: pgText('id').primaryKey(),
    ownerId: pgText('owner_id').notNull(),
  },
  kovo((columns) => ({
    domain: 'account',
    key: columns.id,
    owner: columns.ownerId,
  })),
);

const entries = pgTable(
  'packed_entries',
  {
    accountId: pgText('account_id').notNull(),
    id: pgText('id').primaryKey(),
    revision: pgInteger('revision').notNull(),
  },
  kovo((columns) => ({
    atomic: columns.revision,
    authzPolicy: sql<boolean>\`owner_id = \${'packed-user'}\`,
    domain: 'entry',
    fans: [{ domain: 'account', via: columns.accountId, when: 'update' }],
    key: columns.id,
    ownerVia: {
      fk: columns.accountId,
      parent: accounts,
      parentKey: accounts.id,
    },
    version: columns.revision,
  })),
);

const sqliteAccounts = sqliteTable(
  'packed_sqlite_accounts',
  {
    id: sqliteInteger('id').primaryKey(),
    ownerId: sqliteText('owner_id').notNull(),
  },
  kovo((columns) => ({
    domain: 'sqlite-account',
    key: columns.id,
    owner: columns.ownerId,
  })),
);

const ddl: KovoStaticSql = staticSql\`select 1\`;
void [accounts, ddl, entries, sqliteAccounts];
`;
  const positiveDiagnostics = packedTypeDiagnostics(consumerRoot, 'positive', preamble);
  if (positiveDiagnostics.length > 0) {
    throw new Error(
      `Packed Drizzle positive type consumer failed:\n${formatTypeDiagnostics(
        consumerRoot,
        positiveDiagnostics,
      )}`,
    );
  }

  const negativeSources = [
    {
      label: 'human-root runtime metadata import',
      source: `import { extractKovoRuntimeDbMetadata } from '@kovojs/drizzle';
void extractKovoRuntimeDbMetadata;
`,
    },
    {
      label: 'typo owner column',
      source: `${preamble}
pgTable(
  'packed_typo',
  { id: pgText('id').primaryKey() },
  kovo((columns) => ({
    domain: 'typo',
    owner: columns.owenrId,
  })),
);
`,
    },
    {
      label: 'wrong-table owner column',
      source: `${preamble}
pgTable(
  'packed_wrong_owner',
  { id: pgText('id').primaryKey() },
  kovo(() => ({
    domain: 'wrong-owner',
    owner: accounts.ownerId,
  })),
);
`,
    },
    {
      label: 'wrong-parent owner-via column',
      source: `${preamble}
pgTable(
  'packed_wrong_owner_via',
  {
    accountId: pgText('account_id').notNull(),
    id: pgText('id').primaryKey(),
  },
  kovo((columns) => ({
    domain: 'wrong-owner-via',
    ownerVia: {
      fk: columns.accountId,
      parent: accounts,
      parentKey: entries.id,
    },
  })),
);
`,
    },
    {
      label: 'wrong-table fan-out column',
      source: `${preamble}
sqliteTable(
  'packed_wrong_fan',
  { id: sqliteInteger('id').primaryKey() },
  kovo(() => ({
    domain: 'wrong-fan',
    fans: [{ domain: 'sqlite-account', via: sqliteAccounts.id }],
  })),
);
`,
    },
    {
      label: 'structural SQL fake',
      source: `${preamble}
const structuralSqlFake = {
  getSQL() {
    return this;
  },
};
const forgedSql: KovoStaticSql = structuralSqlFake;
void forgedSql;
`,
    },
  ];
  for (let index = 0; index < negativeSources.length; index += 1) {
    const negative = negativeSources[index];
    const diagnostics = packedTypeDiagnostics(consumerRoot, `negative-${index}`, negative.source);
    if (diagnostics.length === 0) {
      throw new Error(`Packed Drizzle type consumer accepted ${negative.label}`);
    }
  }
}

function packedTypeDiagnostics(consumerRoot, fixture, source) {
  const sourcePath = path.join(consumerRoot, `consumer-${fixture}.ts`);
  writeFileSync(sourcePath, source, 'utf8');
  const program = ts.createProgram([sourcePath], {
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    noEmit: true,
    skipLibCheck: false,
    strict: true,
    target: ts.ScriptTarget.ES2022,
  });
  return ts
    .getPreEmitDiagnostics(program)
    .filter((diagnostic) => !isThirdPartyDeclarationDiagnostic(diagnostic));
}

function formatTypeDiagnostics(consumerRoot, diagnostics) {
  return ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: (fileName) => fileName,
    getCurrentDirectory: () => consumerRoot,
    getNewLine: () => '\n',
  });
}

function assertPackedRuntimeConsumer(consumerRoot) {
  const source = `import { validateManagedSqlStatement } from '@kovojs/core/internal/sql-safety';
import { sql as nativeDrizzleSql } from 'drizzle-orm';
import { sql, staticSql } from '@kovojs/drizzle';

const parameterized = sql\`select * from products where id = \${'p1'}\`;
const literal = staticSql\`select 1\`;
const identifier = sql.identifier('products', { allow: ['products'] });
const keyword = sql.allow('asc', ['asc', 'desc']);
for (const statement of [parameterized, literal, identifier, keyword]) {
  if (!validateManagedSqlStatement(statement).ok) {
    throw new Error('Kovo SQL constructor did not mint a managed witness');
  }
}
const structuralFake = { getSQL() { return this; }, queryChunks: [] };
if (validateManagedSqlStatement(structuralFake).ok) {
  throw new Error('structural SQL fake crossed the managed witness boundary');
}
if (validateManagedSqlStatement(nativeDrizzleSql.raw('select 1')).ok) {
  throw new Error('unbranded native Drizzle SQL crossed the managed witness boundary');
}
process.stdout.write('packed-drizzle-runtime/v1 OK\\n');
`;
  const entry = path.join(consumerRoot, 'runtime.mjs');
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
    result.stdout !== 'packed-drizzle-runtime/v1 OK\n'
  ) {
    throw new Error(
      `Packed Drizzle runtime consumer failed: ${
        result.error?.message ?? `${result.stderr}${result.stdout}`
      }`,
    );
  }
}

function parseDeclaration(source, fileName) {
  return ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

function hasExportModifier(node) {
  return (
    ts.canHaveModifiers(node) &&
    ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
  );
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
    throw new Error(`Packed Drizzle ${label} drifted: ${JSON.stringify(actual)}`);
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
      `Packed Drizzle consumer ${label} failed: ${
        result.error?.message ?? `${result.stderr}${result.stdout}`
      }`,
    );
  }
}

function compareStrings(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

if (isMainEntry(import.meta.url)) await runGate(checkPackedDrizzleConsumer);
