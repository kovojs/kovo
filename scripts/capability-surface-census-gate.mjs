#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';

import { isMainEntry, runGate } from './lib/cli-entry.mjs';
import { repoRoot as findRepoRoot } from './lib/repo-root.mjs';

export const capabilitySurfaceCensusSchema = 'kovo-capability-surface-census/v2';
export const repoRoot = findRepoRoot();
export const capabilitySurfaceCensusManifestPath =
  'scripts/capability-surface-census.manifest.json';

const defaultCanonicalSymbols = {
  systemDbDeclarations: [
    { file: 'packages/server/src/postgres-runtime.ts', owner: 'KovoPostgresAppRuntimeDb' },
    { file: 'packages/server/src/sqlite.ts', owner: 'KovoSqliteAppRuntime' },
  ],
  witnessFactories: [
    {
      exportName: 'createWitnessWeakMap',
      file: 'packages/server/src/security-witness-intrinsics.ts',
    },
  ],
};

const requiredPublicSurfaceIds = [
  'better-auth-mount-adapter',
  'generated-postgres-auth-adapter',
  'generated-sqlite-auth-adapter',
  'generated-postgres-readonly-db',
  'generated-postgres-request-db-provider',
  'server-system-db-capability',
  'managed-sql-statement-identity',
  'postgres-role-topology',
  'storage-download-signer',
  'webhook-transaction-db',
  'principal-posture',
];

const requiredPublicSurfaceFields = [
  'id',
  'kind',
  'authority',
  'mint',
  'publicStatus',
  'allowedConsumers',
  'buildDiagnostic',
  'evidence',
];

const requiredRequestDeadlineEffectDoorIds = [
  'server.egress-fetch',
  'server.db-provider',
  'server.mutation-transaction',
  'server.deferred-region',
  'server.response-stream-flush',
  'server.node-response-transport',
];
const requestDeadlineConsumers = new Set([
  'assertCurrentRequestDeadlineActive',
  'awaitWithCurrentRequestDeadline',
  'bindRequestDeadlineResponseTransport',
  'composeCurrentRequestDeadlineSignal',
  'onCurrentRequestDeadline',
  'RequestDeadlineAdmission.signal',
]);
const requiredPrincipalEpochCredentialDoorIds = [
  'capability-url.mint',
  'capability-url.verify',
  'mutation-replay-receipt.mint',
  'mutation-replay-receipt.release',
  'mutation-replay-receipt.handler-admission',
  'mutation-replay-receipt.transaction-complete',
  'mutation-replay-receipt.settlement',
  'continuation.in-frame',
];

/**
 * Resolve the exact framework mint APIs through the TypeScript checker and return every call site.
 * Same-named local functions and object methods do not share the canonical declaration symbol and
 * therefore cannot enter the census (SPEC §2 and §6.6; C13).
 */
export function discoverCapabilityMintSites({
  canonicalSymbols = defaultCanonicalSymbols,
  rootDir = repoRoot,
  sources,
} = {}) {
  const context = createProgramContext({ rootDir, sources });
  const checker = context.program.getTypeChecker();
  const canonicalTargets = canonicalTargetSymbols({ canonicalSymbols, checker, context });
  const discovered = [];

  for (const sourceFile of context.scannedSourceFiles()) {
    visit(sourceFile);

    function visit(node) {
      if (ts.isCallExpression(node)) {
        const callee = callIdentityNode(node.expression);
        const symbol =
          callee === undefined
            ? undefined
            : resolveAlias(checker, checker.getSymbolAtLocation(callee));
        const target =
          symbol === undefined ? undefined : resolvedCanonicalTarget(symbol, canonicalTargets);
        if (target !== undefined) {
          const file = context.logicalFileName(sourceFile.fileName);
          discovered.push({
            api: target.api,
            file,
            id: `${file}#${stableCallSiteOwner(node, sourceFile)}`,
            position: node.getStart(sourceFile),
            symbol: target.identity,
          });
        }
      }
      ts.forEachChild(node, visit);
    }
  }

  discovered.sort((left, right) =>
    left.file === right.file ? left.position - right.position : left.file.localeCompare(right.file),
  );
  const occurrences = new Map();
  return discovered.map(({ position: _position, ...site }) => {
    const count = (occurrences.get(site.id) ?? 0) + 1;
    occurrences.set(site.id, count);
    return count === 1 ? site : { ...site, id: `${site.id}~${count}` };
  });
}

/** Validate an exact, closed classification for every currently discovered mint/registry site. */
export function evaluateCapabilitySurfaceCensus({ discovered, manifest }) {
  const findings = [];
  if (!isRecord(manifest) || manifest.schema !== capabilitySurfaceCensusSchema) {
    findings.push(`capability census schema must be ${capabilitySurfaceCensusSchema}`);
  }
  const rows = Array.isArray(manifest?.mintSites)
    ? manifest.mintSites
    : Array.isArray(manifest?.rows)
      ? manifest.rows
      : [];
  if (!Array.isArray(manifest?.mintSites) && !Array.isArray(manifest?.rows)) {
    findings.push('capability census mint sites must be an array');
  }
  const discoveredById = new Map(discovered.map((site) => [site.id, site]));
  const seen = new Set();
  let internalRegistries = 0;
  let mints = 0;

  for (const row of rows) {
    if (!isRecord(row) || typeof row.id !== 'string') {
      findings.push('capability census row must be an object with a string id');
      continue;
    }
    if (seen.has(row.id)) findings.push(`${row.id}: duplicate capability census row`);
    seen.add(row.id);
    const site = discoveredById.get(row.id);
    if (site === undefined) {
      findings.push(`stale capability census row ${row.id}`);
    } else if (row.api !== site.api || row.file !== site.file || row.symbol !== site.symbol) {
      findings.push(`${row.id}: census identity differs from the resolved TypeScript symbol site`);
    }
    if (row.classification === 'mint') {
      mints += 1;
    } else if (row.classification === 'internal-registry') {
      internalRegistries += 1;
    } else {
      findings.push(`${row.id}: classification must be mint or internal-registry`);
    }
    if (!substantive(row.reason)) {
      findings.push(`${row.id}: classification requires a substantive reviewed reason`);
    }
  }

  for (const site of discovered) {
    if (!seen.has(site.id)) findings.push(`missing capability census row ${site.id}`);
  }
  const summary = { internalRegistries, mints, sites: discovered.length };
  if (isRecord(manifest?.summary) && canonicalJson(manifest.summary) !== canonicalJson(summary)) {
    findings.push('capability census summary is stale');
  }
  return { findings, ok: findings.length === 0, summary };
}

/** Preserve reviewed decisions while leaving every newly discovered site fail-closed. */
export function generatedCapabilitySurfaceCensus({ discovered, existing }) {
  const priorRows = Array.isArray(existing?.mintSites)
    ? existing.mintSites
    : existing?.schema === capabilitySurfaceCensusSchema && Array.isArray(existing?.rows)
      ? existing.rows
      : [];
  const priorById = new Map(
    priorRows
      .filter((row) => isRecord(row) && typeof row.id === 'string')
      .map((row) => [row.id, row]),
  );
  const mintSites = discovered.map((site) => {
    const prior = priorById.get(site.id);
    return {
      ...site,
      classification: prior?.classification ?? 'unclassified',
      reason: prior?.reason ?? null,
    };
  });
  return {
    schema: capabilitySurfaceCensusSchema,
    summary: {
      internalRegistries: mintSites.filter((row) => row.classification === 'internal-registry')
        .length,
      mints: mintSites.filter((row) => row.classification === 'mint').length,
      sites: mintSites.length,
    },
    // These reviewed public surfaces remain the threat-matrix denominator; `mintSites` is the
    // independently derived symbol census replacing the former regex pins.
    rows: Array.isArray(existing?.rows) ? existing.rows : [],
    requestDeadlineEffectDoors: Array.isArray(existing?.requestDeadlineEffectDoors)
      ? existing.requestDeadlineEffectDoors
      : [],
    principalEpochCredentialDoors: Array.isArray(existing?.principalEpochCredentialDoors)
      ? existing.principalEpochCredentialDoors
      : [],
    mintSites,
  };
}

/** Validate the finite Kovo-owned effect-door denominator against exact deadline imports. */
export function evaluateRequestDeadlineEffectDoors({
  requiredIds = requiredRequestDeadlineEffectDoorIds,
  rows,
  sources,
}) {
  const findings = [];
  if (!Array.isArray(rows)) {
    return {
      findings: ['requestDeadlineEffectDoors must be an array'],
      ok: false,
      summary: { effectDoors: 0 },
    };
  }
  if (!(sources instanceof Map)) {
    return {
      findings: ['requestDeadlineEffectDoors require an exact source map'],
      ok: false,
      summary: { effectDoors: rows.length },
    };
  }

  const required = new Set(requiredIds);
  const seen = new Set();
  for (const row of rows) {
    if (
      !isRecord(row) ||
      typeof row.id !== 'string' ||
      typeof row.path !== 'string' ||
      typeof row.owner !== 'string' ||
      !Array.isArray(row.consumes)
    ) {
      findings.push('request deadline effect-door row is malformed');
      continue;
    }
    if (seen.has(row.id)) findings.push(`${row.id}: duplicate request deadline effect door`);
    seen.add(row.id);
    if (!required.has(row.id)) findings.push(`${row.id}: stale request deadline effect door`);
    if (!substantive(row.purpose) || !substantive(row.evidence)) {
      findings.push(`${row.id}: request deadline effect door needs purpose and evidence`);
    }
    if (
      row.consumes.length === 0 ||
      row.consumes.some((name) => !requestDeadlineConsumers.has(name))
    ) {
      findings.push(`${row.id}: request deadline consumers are missing or unsupported`);
      continue;
    }
    const sourceText = sources.get(row.path);
    if (typeof sourceText !== 'string') {
      findings.push(`${row.id}: missing effect-door source ${row.path}`);
      continue;
    }
    const sourceFile = ts.createSourceFile(
      row.path,
      sourceText,
      ts.ScriptTarget.Latest,
      true,
      row.path.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const owner = requestDeadlineOwner(sourceFile, row.owner);
    if (owner === undefined) {
      findings.push(`${row.id}: missing effect-door owner ${row.owner}`);
      continue;
    }
    const imports = requestDeadlineImportBindings(sourceFile, row.path);
    const called = importedDeadlineCalls(owner, imports);
    for (const consumer of row.consumes) {
      const consumed =
        consumer === 'RequestDeadlineAdmission.signal'
          ? ownerConsumesDeadlineAdmissionSignal(owner, sourceFile)
          : called.has(consumer);
      if (!consumed) {
        findings.push(`${row.id}: ${row.owner} does not consume ${consumer} from request-deadline`);
      }
    }
  }
  for (const id of required) {
    if (!seen.has(id)) findings.push(`${id}: missing required request deadline effect door`);
  }
  return {
    findings,
    ok: findings.length === 0,
    summary: { effectDoors: rows.length },
  };
}

/** Validate the exact durable credential mint/verify denominator against canonical epoch doors. */
export function evaluatePrincipalEpochCredentialDoors({
  canonicalModule,
  requiredIds = requiredPrincipalEpochCredentialDoorIds,
  rows,
  sources,
}) {
  const findings = [];
  const summary = { inapplicable: 0, mint: 0, verify: 0 };
  if (!Array.isArray(rows)) {
    return {
      findings: ['principalEpochCredentialDoors must be an array'],
      ok: false,
      summary,
    };
  }
  if (!(sources instanceof Map) || typeof canonicalModule !== 'string') {
    return {
      findings: ['principalEpochCredentialDoors require an exact source map and canonical module'],
      ok: false,
      summary,
    };
  }
  const required = new Set(requiredIds);
  const seen = new Set();
  for (const row of rows) {
    if (
      !isRecord(row) ||
      typeof row.id !== 'string' ||
      typeof row.path !== 'string' ||
      typeof row.owner !== 'string' ||
      typeof row.credential !== 'string'
    ) {
      findings.push('principal epoch credential-door row is malformed');
      continue;
    }
    if (seen.has(row.id)) findings.push(`${row.id}: duplicate principal epoch credential door`);
    seen.add(row.id);
    if (!required.has(row.id)) findings.push(`${row.id}: stale principal epoch credential door`);
    if (!substantive(row.reason)) {
      findings.push(`${row.id}: principal epoch credential door needs a substantive reason`);
    }
    if (row.phase !== 'mint' && row.phase !== 'verify' && row.phase !== 'inapplicable') {
      findings.push(`${row.id}: phase must be mint, verify, or inapplicable`);
      continue;
    }
    summary[row.phase] += 1;
    const sourceText = sources.get(row.path);
    if (typeof sourceText !== 'string') {
      findings.push(`${row.id}: missing credential-door source ${row.path}`);
      continue;
    }
    const sourceFile = ts.createSourceFile(
      row.path,
      sourceText,
      ts.ScriptTarget.Latest,
      true,
      row.path.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const owner = requestDeadlineOwner(sourceFile, row.owner);
    if (owner === undefined) {
      findings.push(`${row.id}: missing credential-door owner ${row.owner}`);
      continue;
    }
    if (row.phase === 'inapplicable') {
      if (row.consumes !== undefined) {
        findings.push(`${row.id}: inapplicable continuation must not claim an epoch consumer`);
      }
      continue;
    }
    const allowedConsumers =
      row.phase === 'mint'
        ? new Set(['currentPrincipalEpoch'])
        : new Set(['assertPrincipalEpochFresh', 'assertPrincipalEpochFreshForRequest']);
    if (!allowedConsumers.has(row.consumes)) {
      findings.push(
        `${row.id}: ${row.phase} consumes must be one of ${[...allowedConsumers].join(', ')}`,
      );
      continue;
    }
    const imports = principalEpochImportBindings(sourceFile, row.path, canonicalModule);
    const called = importedDeadlineCalls(owner, imports);
    if (!called.has(row.consumes)) {
      findings.push(
        `${row.id}: ${row.owner} does not consume ${row.consumes} from principal-epoch`,
      );
    }
  }
  for (const id of required) {
    if (!seen.has(id)) findings.push(`${id}: missing required principal epoch credential door`);
  }
  return { findings, ok: findings.length === 0, summary };
}

export function evaluatePublicCapabilitySurfaces(manifest) {
  const findings = [];
  const rows = Array.isArray(manifest?.rows) ? manifest.rows : [];
  const byId = new Map();
  for (const row of rows) {
    if (!isRecord(row)) {
      findings.push('public capability surface row must be an object');
      continue;
    }
    const label = typeof row.id === 'string' && row.id.length > 0 ? row.id : '<unknown>';
    if (byId.has(label)) findings.push(`${label}: duplicate public capability surface row`);
    byId.set(label, row);
    for (const field of requiredPublicSurfaceFields) {
      if (!(field in row)) findings.push(`${label}: missing ${field}`);
    }
    if (!Array.isArray(row.allowedConsumers) || row.allowedConsumers.length === 0) {
      findings.push(`${label}: allowedConsumers must be a non-empty array`);
    }
  }
  for (const id of requiredPublicSurfaceIds) {
    if (!byId.has(id)) findings.push(`${id}: missing required public capability surface row`);
  }
  return findings;
}

/**
 * Preserve the old gate's closed boundary verdicts with structural AST facts. This deliberately
 * carries no text-pattern classifier: the symbol census owns mint discovery, while these exact
 * first-party wiring checks retain the prior C13 rejects during cutover.
 */
export function evaluateCapabilityBoundaryPosture({
  readText = (file) => readFileSync(path.join(repoRoot, file), 'utf8'),
} = {}) {
  const findings = [];
  const files = {
    betterAuthPostgres: 'packages/better-auth/src/postgres.ts',
    betterAuthSqlite: 'packages/better-auth/src/sqlite.ts',
    postgresAuth: 'packages/create-kovo/templates/src/auth.ts',
    postgresCapability: 'packages/server/src/internal/postgres-capability.ts',
    postgresRuntime: 'packages/create-kovo/templates/src/_kovo/app-runtime-db.ts',
    serverRoot: 'packages/server/src/index.ts',
    soundSubset: 'packages/create-kovo/templates/scripts/check-sound-subset.mjs',
    sqlSafeHandle: 'packages/server/src/sql-safe-handle.ts',
    sqliteAuth: 'packages/create-kovo/templates/src/auth.sqlite.ts',
    sqliteCapability: 'packages/server/src/internal/sqlite-capability.ts',
    sqliteRuntime: 'packages/create-kovo/templates/src/_kovo/app-runtime-db.sqlite.ts',
  };
  const sourceFiles = {};
  for (const [key, file] of Object.entries(files)) {
    try {
      sourceFiles[key] = ts.createSourceFile(
        file,
        readText(file),
        ts.ScriptTarget.Latest,
        true,
        file.endsWith('.mjs') ? ts.ScriptKind.JS : ts.ScriptKind.TS,
      );
    } catch {
      findings.push(`missing capability posture source ${file}`);
    }
  }
  if (findings.length > 0) return findings;

  const postgresRuntime = sourceFiles.postgresRuntime;
  const sqliteRuntime = sourceFiles.sqliteRuntime;
  const postgresAuth = sourceFiles.postgresAuth;
  const sqliteAuth = sourceFiles.sqliteAuth;
  const betterAuthPostgres = sourceFiles.betterAuthPostgres;
  const betterAuthSqlite = sourceFiles.betterAuthSqlite;
  const serverRoot = sourceFiles.serverRoot;
  const postgresCapability = sourceFiles.postgresCapability;
  const sqliteCapability = sourceFiles.sqliteCapability;
  const soundSubset = sourceFiles.soundSubset;
  const sqlSafeHandle = sourceFiles.sqlSafeHandle;

  if (exportedValueNames(postgresRuntime).has('appRuntimeAuthDb')) {
    findings.push('generated Postgres auth DB must not be exported as a raw value');
  }
  if (
    [...exportedValueNames(postgresRuntime), ...exportedValueNames(sqliteRuntime)].some((name) =>
      name.toLowerCase().includes('systemdb'),
    )
  ) {
    findings.push('generated templates must not export raw systemDb capabilities');
  }
  requireFact(
    findings,
    hasVariableCall(postgresRuntime, 'authSystemDb', 'systemDb'),
    'generated Postgres runtime must mint a module-private opaque auth system capability',
  );
  requireFact(
    findings,
    hasVariableCall(sqliteRuntime, 'authSystemDb', 'systemDb'),
    'generated SQLite runtime must mint a module-private opaque auth system capability',
  );
  requireFact(
    findings,
    hasSystemDbAdapterUnwrap(betterAuthPostgres, 'usePostgresSystemDb', 'pg'),
    'Better Auth Postgres constructor must unwrap the system DB only at the adapter sink',
  );
  requireFact(
    findings,
    namedImports(postgresRuntime, '@kovojs/better-auth').has(
      'createBetterAuthPostgresBindingsFromEnvironment',
    ),
    'generated Postgres runtime must route environment and adapter construction through @kovojs/better-auth',
  );
  requireFact(
    findings,
    namedImports(sqliteRuntime, '@kovojs/better-auth').has(
      'createBetterAuthSqliteBindingsFromEnvironment',
    ),
    'generated SQLite runtime must route environment and adapter construction through @kovojs/better-auth',
  );
  for (const runtime of [postgresRuntime, sqliteRuntime]) {
    const forbidden = new Set([
      'betterAuth',
      'betterAuthPostgresSecret',
      'betterAuthSqliteSecret',
      'createAuthAdapter',
      'drizzleAdapter',
      'loadEnvFile',
      'usePostgresSystemDb',
      'useSqliteSystemDb',
    ]);
    if (hasAnyIdentifier(runtime, forbidden) || hasPropertyPath(runtime, ['process', 'env'])) {
      findings.push(
        'generated runtimes must not read raw environment values or construct/unwrap raw auth adapters',
      );
      break;
    }
  }
  requireFact(
    findings,
    hasBindingFactoryCall(postgresRuntime, 'createBetterAuthPostgresBindingsFromEnvironment'),
    'generated Postgres runtime must pass only its opaque capability into the sanitized binding constructor',
  );
  requireFact(
    findings,
    hasBindingFactoryCall(sqliteRuntime, 'createBetterAuthSqliteBindingsFromEnvironment'),
    'generated SQLite runtime must pass only its opaque capability into the sanitized binding constructor',
  );
  requireFact(
    findings,
    hasFrozenBindingReturn(betterAuthPostgres),
    'Better Auth Postgres constructor must return only the frozen sanitized binding record and opaque mount adapter',
  );
  requireFact(
    findings,
    hasSystemDbAdapterUnwrap(betterAuthSqlite, 'useSqliteSystemDb', 'sqlite'),
    'Better Auth SQLite constructor must unwrap the system DB only at the adapter sink',
  );
  requireFact(
    findings,
    hasFrozenBindingReturn(betterAuthSqlite),
    'Better Auth SQLite constructor must return only the frozen sanitized binding record and opaque mount adapter',
  );
  requireFact(
    findings,
    exactNamedImport(postgresAuth, './_kovo/app-runtime-db.js', [
      'appRuntimeDbReady',
      'createAppAuthBindings',
    ]),
    'Postgres auth module must import only readiness and the sanitized auth-binding factory',
  );
  requireFact(
    findings,
    exactNamedImport(sqliteAuth, './_kovo/app-runtime-db.js', [
      'appRuntimeDbReady',
      'createAppAuthBindings',
    ]),
    'SQLite auth module must import only readiness and the sanitized auth-binding factory',
  );
  const authoredForbidden = new Set([
    'appRuntimeAuthDb',
    'appRuntimeDbProvider',
    'appRuntimeReadonlyDb',
    'betterAuth',
    'createAuthAdapter',
    'drizzleAdapter',
    'loadEnvFile',
  ]);
  if (
    hasAnyIdentifier(postgresAuth, authoredForbidden) ||
    hasAnyIdentifier(sqliteAuth, authoredForbidden) ||
    hasPropertyPath(postgresAuth, ['process', 'env']) ||
    hasPropertyPath(sqliteAuth, ['process', 'env'])
  ) {
    findings.push(
      'auth modules must not import or use raw runtime DB, adapter, Better Auth, or environment capabilities',
    );
  }
  requireFact(
    findings,
    hasExactCsrfEnvironmentCall(postgresAuth) && hasExactCsrfEnvironmentCall(sqliteAuth),
    'generated auth modules must use the exact field-only reviewed CSRF environment constructor',
  );
  requireFact(
    findings,
    hasExportedPropertyValue(postgresRuntime, 'appRuntimeDbProvider', 'appDatabase', 'db'),
    'generated Postgres runtime must export only the opaque app DB provider token',
  );
  requireFact(
    findings,
    hasExportedPropertyValue(sqliteRuntime, 'appRuntimeDbProvider', 'appDatabase', 'db'),
    'generated SQLite runtime must export only the opaque app DB provider token',
  );
  if (exportedNames(serverRoot).has('usePostgresSystemDb')) {
    findings.push(
      'the public @kovojs/server root must not export the raw Postgres capability consumer',
    );
  }
  requireFact(
    findings,
    exactNamedImport(betterAuthPostgres, '@kovojs/server/internal/postgres-capability', [
      'usePostgresSystemDb',
    ]),
    'Better Auth Postgres must import the raw capability consumer only from the internal subpath',
  );
  requireFact(
    findings,
    exactNamedImport(betterAuthSqlite, '@kovojs/server/internal/sqlite-capability', [
      'useSqliteSystemDb',
    ]),
    'Better Auth SQLite must import the raw capability consumer only from the internal subpath',
  );
  requireFact(
    findings,
    hasPrivateRegistryConsumer(postgresCapability, 'postgresSystemDbValues', 'usePostgresSystemDb'),
    'the internal Postgres capability entry must own the module-private mint/consume registry',
  );
  requireFact(
    findings,
    hasPrivateRegistryConsumer(sqliteCapability, 'sqliteSystemDbValues', 'useSqliteSystemDb'),
    'the internal SQLite capability entry must own the module-private mint/consume registry',
  );
  requireFact(
    findings,
    hasSoundSubsetImportRule(soundSubset, 'src/auth.ts'),
    'sound-subset allowlist must restrict src/auth.ts to readiness and createAppAuthBindings',
  );
  requireFact(
    findings,
    hasSoundSubsetImportRule(soundSubset, 'src/auth.sqlite.ts'),
    'sound-subset allowlist must restrict src/auth.sqlite.ts to readiness and createAppAuthBindings',
  );
  requireFact(
    findings,
    hasManagedSqlSnapshotFlow(sqlSafeHandle, 'guardedSqlMethod'),
    'managed SQL direct execution must pass the frozen snapshot to the driver',
  );
  requireFact(
    findings,
    hasManagedSqlSnapshotFlow(sqlSafeHandle, 'guardedPrepareMethod'),
    'managed SQL prepare execution must pass the frozen snapshot to the driver',
  );
  if (hasOriginalManagedSqlStatementFlow(sqlSafeHandle)) {
    findings.push(
      'managed SQL execution must not pass the original mutable statement to the driver',
    );
  }
  return findings;
}

export function writeCapabilitySurfaceCensus({ rootDir = repoRoot } = {}) {
  const outputPath = path.join(rootDir, capabilitySurfaceCensusManifestPath);
  const existing = existsSync(outputPath)
    ? JSON.parse(readFileSync(outputPath, 'utf8'))
    : undefined;
  const discovered = discoverCapabilityMintSites({ rootDir });
  writeFileSync(
    outputPath,
    canonicalJson(generatedCapabilitySurfaceCensus({ discovered, existing })),
  );
}

export function main({ rootDir = repoRoot, write = process.argv.includes('--write') } = {}) {
  if (write) writeCapabilitySurfaceCensus({ rootDir });
  const manifest = JSON.parse(
    readFileSync(path.join(rootDir, capabilitySurfaceCensusManifestPath), 'utf8'),
  );
  const discovered = discoverCapabilityMintSites({ rootDir });
  const result = evaluateCapabilitySurfaceCensus({ discovered, manifest });
  const deadlineRows = Array.isArray(manifest.requestDeadlineEffectDoors)
    ? manifest.requestDeadlineEffectDoors
    : [];
  const deadlineSources = new Map();
  for (const row of deadlineRows) {
    if (!isRecord(row) || typeof row.path !== 'string' || deadlineSources.has(row.path)) continue;
    deadlineSources.set(row.path, readFileSync(path.join(rootDir, row.path), 'utf8'));
  }
  const deadlineResult = evaluateRequestDeadlineEffectDoors({
    rows: deadlineRows,
    sources: deadlineSources,
  });
  const epochRows = Array.isArray(manifest.principalEpochCredentialDoors)
    ? manifest.principalEpochCredentialDoors
    : [];
  const epochSources = new Map();
  for (const row of epochRows) {
    if (!isRecord(row) || typeof row.path !== 'string' || epochSources.has(row.path)) continue;
    epochSources.set(row.path, readFileSync(path.join(rootDir, row.path), 'utf8'));
  }
  const epochResult = evaluatePrincipalEpochCredentialDoors({
    canonicalModule: 'packages/server/src/principal-epoch.ts',
    rows: epochRows,
    sources: epochSources,
  });
  result.findings.push(
    ...deadlineResult.findings,
    ...epochResult.findings,
    ...evaluatePublicCapabilitySurfaces(manifest),
    ...evaluateCapabilityBoundaryPosture({
      readText: (file) => readFileSync(path.join(rootDir, file), 'utf8'),
    }),
  );
  result.ok = result.findings.length === 0;
  process.stdout.write(
    `capability-surface-census/v2 ${result.ok ? 'OK' : 'FAIL'} sites=${result.summary.sites} mints=${result.summary.mints} registries=${result.summary.internalRegistries} deadlineDoors=${deadlineResult.summary.effectDoors} epochDoors=${epochRows.length}\n`,
  );
  for (const finding of result.findings) process.stderr.write(`${finding}\n`);
  return result.ok;
}

function requestDeadlineOwner(sourceFile, ownerName) {
  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name?.text === ownerName) return statement;
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== ownerName) continue;
      const initializer = unwrapExpression(declaration.initializer);
      if (
        initializer !== undefined &&
        (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))
      ) {
        return initializer;
      }
    }
  }
  return undefined;
}

function requestDeadlineImportBindings(sourceFile, sourcePath) {
  const bindings = new Map();
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.importClause?.namedBindings === undefined ||
      !ts.isNamedImports(statement.importClause.namedBindings)
    ) {
      continue;
    }
    const importedPath = path.posix
      .normalize(path.posix.join(path.posix.dirname(sourcePath), statement.moduleSpecifier.text))
      .replace(/\.(?:m?js)$/u, '.ts');
    const expectedPath = path.posix.join(path.posix.dirname(sourcePath), 'request-deadline.ts');
    if (importedPath !== expectedPath) continue;
    for (const element of statement.importClause.namedBindings.elements) {
      const imported = element.propertyName?.text ?? element.name.text;
      if (requestDeadlineConsumers.has(imported)) bindings.set(element.name.text, imported);
    }
  }
  return bindings;
}

function principalEpochImportBindings(sourceFile, sourcePath, canonicalModule) {
  const bindings = new Map();
  const canonicalPath = path.posix.normalize(canonicalModule);
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      !ts.isNamedImports(statement.importClause?.namedBindings)
    ) {
      continue;
    }
    const importedPath = path.posix
      .normalize(path.posix.join(path.posix.dirname(sourcePath), statement.moduleSpecifier.text))
      .replace(/\.(?:m?js)$/u, '.ts');
    const canonicalMatches = canonicalPath.includes('/')
      ? importedPath === canonicalPath
      : path.posix.basename(importedPath) === canonicalPath;
    if (!canonicalMatches) continue;
    for (const element of statement.importClause.namedBindings.elements) {
      const imported = element.propertyName?.text ?? element.name.text;
      if (
        imported === 'currentPrincipalEpoch' ||
        imported === 'assertPrincipalEpochFresh' ||
        imported === 'assertPrincipalEpochFreshForRequest'
      ) {
        bindings.set(element.name.text, imported);
      }
    }
  }
  return bindings;
}

function importedDeadlineCalls(owner, imports) {
  const calls = new Set();
  const visitOwner = (node) => {
    if (
      node !== owner &&
      (ts.isArrowFunction(node) ||
        ts.isFunctionDeclaration(node) ||
        ts.isFunctionExpression(node) ||
        ts.isMethodDeclaration(node)) &&
      (ts.isFunctionDeclaration(node) ||
        ts.isMethodDeclaration(node) ||
        ts.isVariableDeclaration(node.parent))
    ) {
      return;
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const imported = imports.get(node.expression.text);
      if (imported !== undefined) calls.add(imported);
    }
    ts.forEachChild(node, visitOwner);
  };
  visitOwner(owner);
  return calls;
}

function ownerConsumesDeadlineAdmissionSignal(owner, sourceFile) {
  const parameterNames = new Set();
  for (const parameter of owner.parameters ?? []) {
    if (
      ts.isIdentifier(parameter.name) &&
      parameter.type?.getText(sourceFile).includes('RequestDeadlineAdmission')
    ) {
      parameterNames.add(parameter.name.text);
    }
  }
  let consumed = false;
  const visitOwner = (node) => {
    if (
      ts.isPropertyAccessExpression(node) &&
      node.name.text === 'signal' &&
      ts.isIdentifier(node.expression) &&
      parameterNames.has(node.expression.text)
    ) {
      consumed = true;
    }
    ts.forEachChild(node, visitOwner);
  };
  visitOwner(owner);
  return consumed;
}

function exportedValueNames(sourceFile) {
  const names = new Set();
  for (const statement of sourceFile.statements) {
    if (!hasModifier(statement, ts.SyntaxKind.ExportKeyword)) continue;
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) names.add(declaration.name.text);
      }
    } else if (
      (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) &&
      statement.name !== undefined
    ) {
      names.add(statement.name.text);
    }
  }
  return names;
}

function exportedNames(sourceFile) {
  const names = exportedValueNames(sourceFile);
  for (const statement of sourceFile.statements) {
    if (!ts.isExportDeclaration(statement) || !ts.isNamedExports(statement.exportClause)) continue;
    for (const element of statement.exportClause.elements) names.add(element.name.text);
  }
  return names;
}

function namedImports(sourceFile, moduleName) {
  const names = new Set();
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== moduleName ||
      !ts.isNamedImports(statement.importClause?.namedBindings)
    ) {
      continue;
    }
    for (const element of statement.importClause.namedBindings.elements) {
      names.add(element.propertyName?.text ?? element.name.text);
    }
  }
  return names;
}

function exactNamedImport(sourceFile, moduleName, expected) {
  const actual = [...namedImports(sourceFile, moduleName)].sort(compareStrings);
  return canonicalJson(actual) === canonicalJson([...expected].sort(compareStrings));
}

function hasVariableCall(sourceFile, variableName, calleeName) {
  return descendants(sourceFile).some((node) => {
    if (!ts.isVariableDeclaration(node)) return false;
    const initializer = unwrapExpression(node.initializer);
    return (
      ts.isIdentifier(node.name) &&
      node.name.text === variableName &&
      initializer !== undefined &&
      ts.isCallExpression(initializer) &&
      terminalCallName(initializer.expression) === calleeName
    );
  });
}

function hasSystemDbAdapterUnwrap(sourceFile, consumerName, provider) {
  return descendants(sourceFile).some((node) => {
    if (!ts.isCallExpression(node) || terminalCallName(node.expression) !== consumerName)
      return false;
    if (!isIdentifierText(node.arguments[0], 'systemDb')) return false;
    const callback = node.arguments[1];
    if (!callback || (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback))) {
      return false;
    }
    return descendants(callback).some(
      (inner) =>
        ts.isCallExpression(inner) &&
        terminalCallName(inner.expression) === 'drizzleAdapter' &&
        isIdentifierText(inner.arguments[0], 'db') &&
        objectPropertyString(inner.arguments[1], 'provider') === provider,
    );
  });
}

function hasBindingFactoryCall(sourceFile, factoryName) {
  const fn = namedFunction(sourceFile, 'createAppAuthBindings');
  return (
    fn !== undefined &&
    descendants(fn).some(
      (node) =>
        ts.isCallExpression(node) &&
        terminalCallName(node.expression) === factoryName &&
        objectPropertyIdentifier(node.arguments[0], 'systemDb') === 'authSystemDb',
    )
  );
}

function hasFrozenBindingReturn(sourceFile) {
  const expected = ['mountAdapter', 'seedDemoUser', 'sessionProvider', 'signIn', 'signOut'].sort(
    compareStrings,
  );
  return descendants(sourceFile).some((node) => {
    if (
      !ts.isReturnStatement(node) ||
      node.expression === undefined ||
      !ts.isCallExpression(node.expression)
    ) {
      return false;
    }
    if (terminalCallName(node.expression.expression) !== 'betterAuthFreezeOwn') return false;
    const object = unwrapExpression(node.expression.arguments[0]);
    if (!object || !ts.isObjectLiteralExpression(object)) return false;
    const actual = object.properties
      .map((property) => (property.name === undefined ? '' : propertyNameText(property.name)))
      .sort(compareStrings);
    return canonicalJson(actual) === canonicalJson(expected);
  });
}

function hasAnyIdentifier(sourceFile, names) {
  return descendants(sourceFile).some((node) => ts.isIdentifier(node) && names.has(node.text));
}

function hasPropertyPath(sourceFile, expected) {
  return descendants(sourceFile).some(
    (node) =>
      ts.isPropertyAccessExpression(node) &&
      propertyAccessPath(node)?.join('.') === expected.join('.'),
  );
}

function hasExactCsrfEnvironmentCall(sourceFile) {
  return descendants(sourceFile).some((node) => {
    if (
      !ts.isCallExpression(node) ||
      terminalCallName(node.expression) !== 'betterAuthCsrfFromEnvironment'
    ) {
      return false;
    }
    const object = unwrapExpression(node.arguments[0]);
    return (
      object !== undefined &&
      ts.isObjectLiteralExpression(object) &&
      object.properties.length === 1 &&
      objectPropertyString(object, 'field') === 'csrf'
    );
  });
}

function hasExportedPropertyValue(sourceFile, variableName, objectName, propertyName) {
  return sourceFile.statements.some((statement) => {
    if (
      !ts.isVariableStatement(statement) ||
      !hasModifier(statement, ts.SyntaxKind.ExportKeyword)
    ) {
      return false;
    }
    return statement.declarationList.declarations.some((declaration) => {
      const initializer = unwrapExpression(declaration.initializer);
      return (
        ts.isIdentifier(declaration.name) &&
        declaration.name.text === variableName &&
        initializer !== undefined &&
        ts.isPropertyAccessExpression(initializer) &&
        isIdentifierText(initializer.expression, objectName) &&
        initializer.name.text === propertyName
      );
    });
  });
}

function hasPrivateRegistryConsumer(sourceFile, registryName, consumerName) {
  const registry = sourceFile.statements.some(
    (statement) =>
      ts.isVariableStatement(statement) &&
      !hasModifier(statement, ts.SyntaxKind.ExportKeyword) &&
      statement.declarationList.declarations.some((declaration) => {
        const initializer = unwrapExpression(declaration.initializer);
        return (
          ts.isIdentifier(declaration.name) &&
          declaration.name.text === registryName &&
          initializer !== undefined &&
          ts.isCallExpression(initializer) &&
          terminalCallName(initializer.expression) === 'createWitnessWeakMap'
        );
      }),
  );
  const consumer = namedFunction(sourceFile, consumerName);
  return (
    registry &&
    consumer !== undefined &&
    descendants(consumer).some(
      (node) =>
        ts.isCallExpression(node) &&
        terminalCallName(node.expression) === 'witnessWeakMapGet' &&
        isIdentifierText(node.arguments[0], registryName),
    )
  );
}

function hasSoundSubsetImportRule(sourceFile, fileName) {
  const expected = ['appRuntimeDbReady', 'createAppAuthBindings'].sort(compareStrings);
  return descendants(sourceFile).some((node) => {
    if (!ts.isArrayLiteralExpression(node) || !isStringText(node.elements[0], fileName))
      return false;
    const set = unwrapExpression(node.elements[1]);
    if (!set || !ts.isNewExpression(set) || terminalCallName(set.expression) !== 'Set')
      return false;
    const values = unwrapExpression(set.arguments?.[0]);
    if (!values || !ts.isArrayLiteralExpression(values)) return false;
    const actual = values.elements.flatMap((element) =>
      ts.isStringLiteral(element) ? [element.text] : [],
    );
    return canonicalJson(actual.sort(compareStrings)) === canonicalJson(expected);
  });
}

function hasManagedSqlSnapshotFlow(sourceFile, functionName) {
  const fn = namedFunction(sourceFile, functionName);
  if (fn === undefined) return false;
  const nodes = descendants(fn);
  const snapshot = nodes.some((node) => {
    if (!ts.isVariableDeclaration(node)) return false;
    const initializer = unwrapExpression(node.initializer);
    return (
      isIdentifierText(node.name, 'snapshot') &&
      initializer !== undefined &&
      ts.isCallExpression(initializer) &&
      terminalCallName(initializer.expression) === 'enforceManagedSql'
    );
  });
  const dispatch = nodes.some(
    (node) =>
      ts.isCallExpression(node) &&
      terminalCallName(node.expression) === 'witnessReflectApply' &&
      isSqlSafetyArgumentCall(node.arguments[2], 'snapshot'),
  );
  return snapshot && dispatch;
}

function hasOriginalManagedSqlStatementFlow(sourceFile) {
  return descendants(sourceFile).some(
    (node) =>
      ts.isCallExpression(node) &&
      terminalCallName(node.expression) === 'witnessReflectApply' &&
      isSqlSafetyArgumentCall(node.arguments[2], 'statement'),
  );
}

function isSqlSafetyArgumentCall(node, firstArgument) {
  const expression = unwrapExpression(node);
  return (
    expression !== undefined &&
    ts.isCallExpression(expression) &&
    terminalCallName(expression.expression) === 'prependSqlSafetyArgument' &&
    isIdentifierText(expression.arguments[0], firstArgument) &&
    isIdentifierText(expression.arguments[1], 'args')
  );
}

function namedFunction(sourceFile, name) {
  return descendants(sourceFile).find(
    (node) => ts.isFunctionDeclaration(node) && node.name?.text === name,
  );
}

function objectPropertyIdentifier(node, key) {
  const object = unwrapExpression(node);
  if (!object || !ts.isObjectLiteralExpression(object)) return undefined;
  for (const property of object.properties) {
    if (!ts.isPropertyAssignment(property) || propertyNameText(property.name) !== key) continue;
    const initializer = unwrapExpression(property.initializer);
    return initializer && ts.isIdentifier(initializer) ? initializer.text : undefined;
  }
  return undefined;
}

function objectPropertyString(node, key) {
  const object = unwrapExpression(node);
  if (!object || !ts.isObjectLiteralExpression(object)) return undefined;
  for (const property of object.properties) {
    if (!ts.isPropertyAssignment(property) || propertyNameText(property.name) !== key) continue;
    const initializer = unwrapExpression(property.initializer);
    return initializer && ts.isStringLiteral(initializer) ? initializer.text : undefined;
  }
  return undefined;
}

function propertyAccessPath(node) {
  const values = [];
  let current = node;
  while (ts.isPropertyAccessExpression(current)) {
    values.unshift(current.name.text);
    current = current.expression;
  }
  if (!ts.isIdentifier(current)) return undefined;
  values.unshift(current.text);
  return values;
}

function terminalCallName(expression) {
  const unwrapped = unwrapExpression(expression);
  if (unwrapped === undefined) return undefined;
  if (ts.isIdentifier(unwrapped)) return unwrapped.text;
  if (ts.isPropertyAccessExpression(unwrapped)) return unwrapped.name.text;
  if (ts.isElementAccessExpression(unwrapped) && ts.isStringLiteral(unwrapped.argumentExpression)) {
    return unwrapped.argumentExpression.text;
  }
  return undefined;
}

function unwrapExpression(node) {
  let current = node;
  while (
    current !== undefined &&
    (ts.isAsExpression(current) ||
      ts.isParenthesizedExpression(current) ||
      ts.isSatisfiesExpression(current) ||
      ts.isTypeAssertionExpression(current))
  ) {
    current = current.expression;
  }
  return current;
}

function descendants(root) {
  const nodes = [];
  visit(root);
  return nodes;

  function visit(node) {
    nodes.push(node);
    ts.forEachChild(node, visit);
  }
}

function hasModifier(node, kind) {
  return node.modifiers?.some((modifier) => modifier.kind === kind) === true;
}

function isIdentifierText(node, value) {
  const unwrapped = unwrapExpression(node);
  return unwrapped !== undefined && ts.isIdentifier(unwrapped) && unwrapped.text === value;
}

function isStringText(node, value) {
  const unwrapped = unwrapExpression(node);
  return unwrapped !== undefined && ts.isStringLiteral(unwrapped) && unwrapped.text === value;
}

function requireFact(findings, fact, message) {
  if (!fact) findings.push(message);
}

function createProgramContext({ rootDir, sources }) {
  if (sources instanceof Map) return virtualProgramContext(sources);
  const rootNames = productionTypeScriptFiles(path.join(rootDir, 'packages'));
  const config = ts.readConfigFile(path.join(rootDir, 'tsconfig.json'), (fileName) =>
    ts.sys.readFile(fileName),
  );
  if (config.error !== undefined) throw new Error(formatDiagnostic(config.error));
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, rootDir);
  const program = ts.createProgram({
    options: { ...parsed.options, noEmit: true },
    rootNames,
  });
  const scanned = new Set(rootNames.map(normalizePath));
  return {
    logicalFileName(fileName) {
      return normalizePath(path.relative(rootDir, fileName));
    },
    program,
    scannedSourceFiles() {
      return program
        .getSourceFiles()
        .filter((sourceFile) => scanned.has(normalizePath(sourceFile.fileName)));
    },
    sourceFile(logicalName) {
      return program.getSourceFile(path.join(rootDir, logicalName));
    },
  };
}

function virtualProgramContext(sources) {
  const base = '/__kovo_capability_census__';
  const sourceByAbsoluteName = new Map(
    [...sources].map(([file, source]) => [normalizePath(path.join(base, file)), source]),
  );
  const options = {
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    noEmit: true,
    skipLibCheck: true,
    strict: true,
    target: ts.ScriptTarget.ES2024,
  };
  const host = ts.createCompilerHost(options, true);
  const systemDirectoryExists = host.directoryExists?.bind(host);
  const systemFileExists = host.fileExists.bind(host);
  const systemGetDirectories = host.getDirectories?.bind(host);
  const systemReadFile = host.readFile.bind(host);
  host.getCurrentDirectory = () => base;
  host.fileExists = (fileName) =>
    sourceByAbsoluteName.has(normalizePath(fileName)) || systemFileExists(fileName);
  host.readFile = (fileName) =>
    sourceByAbsoluteName.get(normalizePath(fileName)) ?? systemReadFile(fileName);
  host.directoryExists = (directory) => {
    const normalized = `${normalizePath(directory).replace(/\/$/u, '')}/`;
    return (
      [...sourceByAbsoluteName.keys()].some((fileName) => fileName.startsWith(normalized)) ||
      systemDirectoryExists?.(directory) === true
    );
  };
  host.getDirectories = (directory) => systemGetDirectories?.(directory) ?? [];
  host.realpath = (fileName) => normalizePath(fileName);
  host.getSourceFile = (fileName, languageVersion) => {
    const source = host.readFile(fileName);
    return source === undefined
      ? undefined
      : ts.createSourceFile(fileName, source, languageVersion, true, scriptKind(fileName));
  };
  const rootNames = [...sourceByAbsoluteName.keys()];
  const program = ts.createProgram({ host, options, rootNames });
  const scanned = new Set(rootNames);
  return {
    logicalFileName(fileName) {
      return normalizePath(path.relative(base, fileName));
    },
    program,
    scannedSourceFiles() {
      return program
        .getSourceFiles()
        .filter((sourceFile) => scanned.has(normalizePath(sourceFile.fileName)));
    },
    sourceFile(logicalName) {
      return program.getSourceFile(path.join(base, logicalName));
    },
  };
}

function canonicalTargetSymbols({ canonicalSymbols, checker, context }) {
  const bySymbol = new Map();
  const targets = [];
  for (const reference of canonicalSymbols.witnessFactories ?? []) {
    const sourceFile = context.sourceFile(reference.file);
    const declaration = sourceFile && namedTopLevelDeclaration(sourceFile, reference.exportName);
    const symbol =
      declaration && resolveAlias(checker, checker.getSymbolAtLocation(declaration.name));
    if (symbol === undefined) {
      throw new Error(
        `missing canonical witness factory ${reference.file}#${reference.exportName}`,
      );
    }
    const target = {
      api: 'createWitnessWeakMap',
      declaration,
      identity: `${reference.file}#${reference.exportName}`,
    };
    bySymbol.set(symbol, target);
    targets.push(target);
  }
  for (const reference of canonicalSymbols.systemDbDeclarations ?? []) {
    const sourceFile = context.sourceFile(reference.file);
    const declaration = sourceFile && namedTypeMember(sourceFile, reference.owner, 'systemDb');
    const symbol =
      declaration && resolveAlias(checker, checker.getSymbolAtLocation(declaration.name));
    if (symbol === undefined) {
      throw new Error(
        `missing canonical systemDb declaration ${reference.file}#${reference.owner}`,
      );
    }
    const target = {
      api: 'systemDb',
      declaration,
      identity: `${reference.file}#${reference.owner}.systemDb`,
    };
    bySymbol.set(symbol, target);
    targets.push(target);
  }
  return { bySymbol, targets };
}

function resolvedCanonicalTarget(symbol, canonicalTargets) {
  const direct = canonicalTargets.bySymbol.get(symbol);
  if (direct !== undefined) return direct;
  for (const declaration of symbol.declarations ?? []) {
    const target = canonicalTargets.targets.find(
      (candidate) =>
        candidate.declaration === declaration ||
        (candidate.declaration.getSourceFile() === declaration.getSourceFile() &&
          candidate.declaration.pos === declaration.pos &&
          candidate.declaration.end === declaration.end),
    );
    if (target !== undefined) return target;
  }
  return undefined;
}

function namedTopLevelDeclaration(sourceFile, name) {
  for (const statement of sourceFile.statements) {
    if (
      (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) &&
      statement.name?.text === name
    ) {
      return statement;
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.name.text === name) return declaration;
      }
    }
  }
  return undefined;
}

function namedTypeMember(sourceFile, ownerName, memberName) {
  for (const statement of sourceFile.statements) {
    if (
      (ts.isClassDeclaration(statement) || ts.isInterfaceDeclaration(statement)) &&
      statement.name?.text === ownerName
    ) {
      return statement.members.find(
        (member) => member.name !== undefined && propertyNameText(member.name) === memberName,
      );
    }
  }
  return undefined;
}

function stableCallSiteOwner(call, sourceFile) {
  let current = call.parent;
  while (current !== undefined && current !== sourceFile) {
    if (ts.isVariableDeclaration(current)) return bindingText(current.name, sourceFile);
    if (ts.isParameter(current)) {
      return `${lexicalOwner(current, sourceFile)}.${bindingText(current.name, sourceFile)}`;
    }
    if (ts.isPropertyAssignment(current) || ts.isPropertyDeclaration(current)) {
      return `${lexicalOwner(current, sourceFile)}.${propertyNameText(current.name)}`;
    }
    if (ts.isReturnStatement(current)) return `${lexicalOwner(current, sourceFile)}.return`;
    current = current.parent;
  }
  return `${lexicalOwner(call, sourceFile)}.call`;
}

function lexicalOwner(node, sourceFile) {
  let current = node.parent;
  while (current !== undefined && current !== sourceFile) {
    if (
      ts.isFunctionDeclaration(current) ||
      ts.isMethodDeclaration(current) ||
      ts.isGetAccessorDeclaration(current) ||
      ts.isSetAccessorDeclaration(current)
    ) {
      return current.name === undefined ? 'anonymous' : propertyNameText(current.name);
    }
    if (ts.isArrowFunction(current) || ts.isFunctionExpression(current)) {
      const parent = current.parent;
      if (ts.isVariableDeclaration(parent)) return bindingText(parent.name, sourceFile);
      if (ts.isPropertyAssignment(parent)) return propertyNameText(parent.name);
      return 'anonymous';
    }
    current = current.parent;
  }
  return 'module';
}

function bindingText(name, sourceFile) {
  return ts.isIdentifier(name) ? name.text : name.getText(sourceFile).replaceAll(/\s+/gu, '');
}

function callIdentityNode(expression) {
  if (ts.isIdentifier(expression)) return expression;
  if (ts.isPropertyAccessExpression(expression)) return expression.name;
  if (
    ts.isElementAccessExpression(expression) &&
    ts.isStringLiteral(expression.argumentExpression)
  ) {
    return expression.argumentExpression;
  }
  return undefined;
}

function resolveAlias(checker, symbol) {
  let current = symbol;
  const seen = new Set();
  while (current !== undefined && (current.flags & ts.SymbolFlags.Alias) !== 0) {
    if (seen.has(current)) return current;
    seen.add(current);
    current = checker.getAliasedSymbol(current);
  }
  return current;
}

function productionTypeScriptFiles(root) {
  const files = [];
  walk(root);
  return files.sort(compareStrings);

  function walk(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!['dist', 'node_modules'].includes(entry.name)) walk(absolute);
        continue;
      }
      if (!entry.isFile() || !/\.tsx?$/u.test(entry.name)) continue;
      if (/\.(?:test|bench)\.[cm]?tsx?$/u.test(entry.name) || entry.name.endsWith('.d.ts'))
        continue;
      files.push(absolute);
    }
  }
}

function propertyNameText(name) {
  if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name) || ts.isStringLiteral(name)) {
    return name.text;
  }
  return name.getText();
}

function scriptKind(fileName) {
  return fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
}

function formatDiagnostic(diagnostic) {
  return ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
}

function normalizePath(value) {
  return value.replaceAll('\\', '/');
}

function compareStrings(left, right) {
  return left.localeCompare(right);
}

function canonicalJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function substantive(value) {
  return typeof value === 'string' && value.trim().length >= 16;
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

if (isMainEntry(import.meta.url)) await runGate(main);
