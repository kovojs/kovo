import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../', import.meta.url));
const manifestPath = path.join(repoRoot, 'scripts/capability-surface-census.manifest.json');

const requiredRowIds = [
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

const requiredFields = [
  'id',
  'kind',
  'authority',
  'mint',
  'publicStatus',
  'allowedConsumers',
  'buildDiagnostic',
  'evidence',
];

const violations = [];
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

if (manifest.version !== 1) {
  violations.push('capability census manifest version must be 1');
}

const rows = Array.isArray(manifest.rows) ? manifest.rows : [];
const rowsById = new Map();
for (const row of rows) {
  validateRow(row);
  if (typeof row.id === 'string') {
    if (rowsById.has(row.id)) violations.push(`${row.id}: duplicate capability census row`);
    rowsById.set(row.id, row);
  }
}

for (const id of requiredRowIds) {
  if (!rowsById.has(id)) violations.push(`${id}: missing required capability census row`);
}

const postgresRuntime = readRepoFile('packages/create-kovo/templates/src/_kovo/app-runtime-db.ts');
const sqliteRuntime = readRepoFile(
  'packages/create-kovo/templates/src/_kovo/app-runtime-db.sqlite.ts',
);
const postgresAuth = readRepoFile('packages/create-kovo/templates/src/auth.ts');
const sqliteAuth = readRepoFile('packages/create-kovo/templates/src/auth.sqlite.ts');
const betterAuthPostgres = readRepoFile('packages/better-auth/src/postgres.ts');
const betterAuthSqlite = readRepoFile('packages/better-auth/src/sqlite.ts');
const serverRoot = readRepoFile('packages/server/src/index.ts');
const postgresCapability = readRepoFile('packages/server/src/internal/postgres-capability.ts');
const sqliteCapability = readRepoFile('packages/server/src/internal/sqlite-capability.ts');
const soundSubset = readRepoFile('packages/create-kovo/templates/scripts/check-sound-subset.mjs');
const sqlSafeHandle = readRepoFile('packages/server/src/sql-safe-handle.ts');

rejectPattern(
  postgresRuntime,
  /\bexport\s+const\s+appRuntimeAuthDb\b/u,
  'generated Postgres auth DB must not be exported as a raw value',
);
rejectPattern(
  `${postgresRuntime}\n${sqliteRuntime}`,
  /\bexport\s+(?:const|let|var|function)\s+\w*systemDb\w*/u,
  'generated templates must not export raw systemDb capabilities',
);
requirePattern(
  postgresRuntime,
  /\bconst\s+authSystemDb\s*=\s*appDatabase\.systemDb\(\{/u,
  'generated Postgres runtime must mint a module-private opaque auth system capability',
);
requirePattern(
  sqliteRuntime,
  /\bconst\s+authSystemDb\s*=\s*appDatabase\.systemDb\(\{/u,
  'generated SQLite runtime must mint a module-private opaque auth system capability',
);
requirePattern(
  betterAuthPostgres,
  /\busePostgresSystemDb\(systemDb,\s*\(db\)\s*=>\s*\n?\s*drizzleAdapter\(db,\s*\{\s*provider:\s*'pg',\s*schema:\s*pinnedSchema\s*\}\)\s*,?\s*\)/u,
  'Better Auth Postgres constructor must unwrap the system DB only at the adapter sink',
);
requirePattern(
  postgresRuntime,
  /import\s+\{[^}]*\bcreateBetterAuthPostgresBindingsFromEnvironment\b[^}]*\}\s+from\s+['"]@kovojs\/better-auth['"]/su,
  'generated Postgres runtime must route environment and adapter construction through @kovojs/better-auth',
);
requirePattern(
  sqliteRuntime,
  /import\s+\{[^}]*\bcreateBetterAuthSqliteBindingsFromEnvironment\b[^}]*\}\s+from\s+['"]@kovojs\/better-auth['"]/su,
  'generated SQLite runtime must route environment and adapter construction through @kovojs/better-auth',
);
rejectPattern(
  `${postgresRuntime}\n${sqliteRuntime}`,
  /\b(?:createAuthAdapter|drizzleAdapter|usePostgresSystemDb|useSqliteSystemDb|betterAuth\s*\(|process\.env|loadEnvFile|betterAuth(?:Postgres|Sqlite)Secret)\b/u,
  'generated runtimes must not read raw environment values or construct/unwrap raw auth adapters',
);
requirePattern(
  postgresRuntime,
  /\bexport\s+function\s+createAppAuthBindings\([\s\S]{0,1200}?\bcreateBetterAuthPostgresBindingsFromEnvironment<[\s\S]{0,700}?\bsystemDb:\s*authSystemDb\b/u,
  'generated Postgres runtime must pass only its opaque capability into the sanitized binding constructor',
);
requirePattern(
  sqliteRuntime,
  /\bexport\s+function\s+createAppAuthBindings\([\s\S]{0,1200}?\bcreateBetterAuthSqliteBindingsFromEnvironment<[\s\S]{0,700}?\bsystemDb:\s*authSystemDb\b/u,
  'generated SQLite runtime must pass only its opaque capability into the sanitized binding constructor',
);
requirePattern(
  betterAuthPostgres,
  /return\s+betterAuthFreezeOwn\(\s*\{\s*seedDemoUser,\s*sessionProvider,\s*signIn,\s*signOut\s*\}/u,
  'Better Auth Postgres constructor must return only the frozen sanitized binding record',
);
requirePattern(
  betterAuthSqlite,
  /\buseSqliteSystemDb\(systemDb,\s*\(db\)\s*=>\s*\n?\s*drizzleAdapter\(db,\s*\{\s*provider:\s*'sqlite',\s*schema:\s*pinnedSchema\s*\}\)\s*,?\s*\)/u,
  'Better Auth SQLite constructor must unwrap the system DB only at the adapter sink',
);
requirePattern(
  postgresAuth,
  /import\s+\{\s*appRuntimeDbReady\s*,\s*createAppAuthBindings\s*\}\s+from\s+['"]\.\/_kovo\/app-runtime-db\.js['"]/u,
  'Postgres auth module must import only readiness and the sanitized auth-binding factory',
);
requirePattern(
  sqliteAuth,
  /import\s+\{\s*appRuntimeDbReady\s*,\s*createAppAuthBindings\s*\}\s+from\s+['"]\.\/_kovo\/app-runtime-db\.js['"]/u,
  'SQLite auth module must import only readiness and the sanitized auth-binding factory',
);
rejectPattern(
  `${postgresAuth}\n${sqliteAuth}`,
  /\b(?:appRuntime(?:AuthDb|DbProvider|ReadonlyDb)|createAuthAdapter|betterAuth|drizzleAdapter|process\.env|loadEnvFile)\b/u,
  'auth modules must not import or use raw runtime DB, adapter, Better Auth, or environment capabilities',
);
requirePattern(
  `${postgresAuth}\n${sqliteAuth}`,
  /\bbetterAuthCsrfFromEnvironment\s*\(\{\s*field:\s*['"]csrf['"]\s*,?\s*\}\)/u,
  'generated auth modules must use the exact field-only reviewed CSRF environment constructor',
);
requirePattern(
  postgresRuntime,
  /\bexport\s+const\s+appRuntimeDbProvider\s*=\s*appDatabase\.db\s*;/u,
  'generated Postgres runtime must export only the opaque app DB provider token',
);
requirePattern(
  sqliteRuntime,
  /\bexport\s+const\s+appRuntimeDbProvider\s*=\s*appDatabase\.db\s*;/u,
  'generated SQLite runtime must export only the opaque app DB provider token',
);
rejectPattern(
  serverRoot,
  /\busePostgresSystemDb\b/u,
  'the public @kovojs/server root must not export the raw Postgres capability consumer',
);
requirePattern(
  betterAuthPostgres,
  /import\s+\{\s*usePostgresSystemDb\s*\}\s+from\s+['"]@kovojs\/server\/internal\/postgres-capability['"]/u,
  'Better Auth Postgres must import the raw capability consumer only from the internal subpath',
);
requirePattern(
  betterAuthSqlite,
  /import\s+\{\s*useSqliteSystemDb\s*\}\s+from\s+['"]@kovojs\/server\/internal\/sqlite-capability['"]/u,
  'Better Auth SQLite must import the raw capability consumer only from the internal subpath',
);
requirePattern(
  postgresCapability,
  /const\s+postgresSystemDbValues\s*=\s*createWitnessWeakMap<[\s\S]{0,3000}?export\s+function\s+usePostgresSystemDb<[\s\S]{0,500}?witnessWeakMapGet\(postgresSystemDbValues,\s*capability\)/u,
  'the internal Postgres capability entry must own the module-private mint/consume registry',
);
requirePattern(
  sqliteCapability,
  /const\s+sqliteSystemDbValues\s*=\s*createWitnessWeakMap<[\s\S]{0,2000}?export\s+function\s+useSqliteSystemDb<[\s\S]{0,500}?witnessWeakMapGet\(sqliteSystemDbValues,\s*capability\)/u,
  'the internal SQLite capability entry must own the module-private mint/consume registry',
);
requirePattern(
  soundSubset,
  /\['src\/auth\.ts',\s+new Set\(\['appRuntimeDbReady',\s*'createAppAuthBindings'\]\)\]/u,
  'sound-subset allowlist must restrict src/auth.ts to readiness and createAppAuthBindings',
);
requirePattern(
  soundSubset,
  /\['src\/auth\.sqlite\.ts',\s+new Set\(\['appRuntimeDbReady',\s*'createAppAuthBindings'\]\)\]/u,
  'sound-subset allowlist must restrict src/auth.sqlite.ts to readiness and createAppAuthBindings',
);
requirePattern(
  sqlSafeHandle,
  /function\s+guardedSqlMethod\([\s\S]{0,500}?const\s+snapshot\s*=\s*enforceManagedSql\(statement,\s*mode,\s*writePolicy\);[\s\S]{0,300}?witnessReflectApply\(value,\s*target,\s*prependSqlSafetyArgument\(snapshot,\s*args\)\)/u,
  'managed SQL direct execution must pass the frozen snapshot to the driver',
);
requirePattern(
  sqlSafeHandle,
  /function\s+guardedPrepareMethod\([\s\S]{0,700}?const\s+snapshot\s*=\s*enforceManagedSql\(statement,\s*mode,\s*writePolicy\);[\s\S]{0,350}?witnessReflectApply\(value,\s*target,\s*prependSqlSafetyArgument\(snapshot,\s*args\)\)/u,
  'managed SQL prepare execution must pass the frozen snapshot to the driver',
);
rejectPattern(
  sqlSafeHandle,
  /witnessReflectApply\(value,\s*target,\s*prependSqlSafetyArgument\(statement,\s*args\)\)/u,
  'managed SQL execution must not pass the original mutable statement to the driver',
);

if (violations.length > 0) {
  process.stderr.write(`Capability surface census gate failed:\n${violations.join('\n')}\n`);
  process.exit(1);
}

process.stdout.write(`capability-surface-census/v1 rows=${rows.length} OK\n`);

function validateRow(row) {
  if (typeof row !== 'object' || row === null || Array.isArray(row)) {
    violations.push('capability census row must be an object');
    return;
  }
  const label = typeof row.id === 'string' && row.id.length > 0 ? row.id : '<unknown>';
  for (const field of requiredFields) {
    if (!(field in row)) violations.push(`${label}: missing ${field}`);
  }
  if (!Array.isArray(row.allowedConsumers) || row.allowedConsumers.length === 0) {
    violations.push(`${label}: allowedConsumers must be a non-empty array`);
  }
}

function readRepoFile(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function rejectPattern(source, pattern, message) {
  if (pattern.test(source)) violations.push(message);
}

function requirePattern(source, pattern, message) {
  if (!pattern.test(source)) violations.push(message);
}
