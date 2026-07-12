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
  /\bfunction\s+authAdapterDb\(\):\s*KovoPostgresSystemDb\b/u,
  'generated Postgres auth DB mint must return an opaque system capability',
);
requirePattern(
  postgresRuntime,
  /\busePostgresSystemDb\(authAdapterDb\(\),\s*\(db\)\s*=>/u,
  'generated Postgres auth adapter must unwrap the system DB only at the adapter sink',
);
requirePattern(
  postgresRuntime,
  /\bfunction\s+createAuthAdapter\(\):\s*ReturnType<typeof drizzleAdapter>/u,
  'generated Postgres auth adapter factory must remain in the framework-owned runtime module',
);
requirePattern(
  sqliteRuntime,
  /\bfunction\s+createAuthAdapter\(\):\s*ReturnType<typeof drizzleAdapter>/u,
  'generated SQLite auth adapter factory must remain in the framework-owned runtime module',
);
rejectPattern(
  `${postgresRuntime}\n${sqliteRuntime}`,
  /\bexport\s+function\s+createAuthAdapter\b/u,
  'generated auth adapter factories must not cross the framework-owned runtime boundary',
);
requirePattern(
  postgresRuntime,
  /\bexport\s+function\s+createAppAuthBindings\([\s\S]{0,900}?\bdatabase:\s*createAuthAdapter\(\)/u,
  'generated Postgres runtime must consume the private adapter inside createAppAuthBindings',
);
requirePattern(
  sqliteRuntime,
  /\bexport\s+function\s+createAppAuthBindings\([\s\S]{0,900}?\bdatabase:\s*createAuthAdapter\(\)/u,
  'generated SQLite runtime must consume the private adapter inside createAppAuthBindings',
);
requirePattern(
  postgresAuth,
  /import\s+\{\s*createAppAuthBindings\s*\}\s+from\s+['"]\.\/_kovo\/app-runtime-db\.js['"]/u,
  'Postgres auth module must import only the sanitized auth-binding factory',
);
requirePattern(
  sqliteAuth,
  /import\s+\{\s*createAppAuthBindings\s*\}\s+from\s+['"]\.\/_kovo\/app-runtime-db\.js['"]/u,
  'SQLite auth module must import only the sanitized auth-binding factory',
);
rejectPattern(
  `${postgresAuth}\n${sqliteAuth}`,
  /\b(?:appRuntime(?:AuthDb|DbProvider|ReadonlyDb)|createAuthAdapter|betterAuth|drizzleAdapter)\b/u,
  'auth modules must not import or use raw runtime DB, adapter, or Better Auth capabilities',
);
requirePattern(
  soundSubset,
  /\['src\/auth\.ts',\s+new Set\(\['createAppAuthBindings'\]\)\]/u,
  'sound-subset allowlist must restrict src/auth.ts to createAppAuthBindings',
);
requirePattern(
  soundSubset,
  /\['src\/auth\.sqlite\.ts',\s+new Set\(\['createAppAuthBindings'\]\)\]/u,
  'sound-subset allowlist must restrict src/auth.sqlite.ts to createAppAuthBindings',
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
