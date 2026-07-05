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
  /\bfunction\s+authAdapterDb\(\):\s*AppDb\b/u,
  'generated Postgres auth DB mint must stay module-private',
);
requirePattern(
  postgresRuntime,
  /\bexport\s+function\s+createAuthAdapter\(\):\s*ReturnType<typeof drizzleAdapter>/u,
  'generated Postgres auth adapter factory must be exported',
);
requirePattern(
  sqliteRuntime,
  /\bexport\s+function\s+createAuthAdapter\(\):\s*ReturnType<typeof drizzleAdapter>/u,
  'generated SQLite auth adapter factory must be exported',
);
requirePattern(
  postgresAuth,
  /import\s+\{\s*createAuthAdapter\s*\}\s+from\s+['"]\.\/_kovo\/app-runtime-db\.js['"]/u,
  'Postgres auth module must import only the narrowed auth adapter factory',
);
requirePattern(
  sqliteAuth,
  /import\s+\{\s*createAuthAdapter\s*\}\s+from\s+['"]\.\/_kovo\/app-runtime-db\.js['"]/u,
  'SQLite auth module must import only the narrowed auth adapter factory',
);
rejectPattern(
  `${postgresAuth}\n${sqliteAuth}`,
  /\bappRuntime(?:AuthDb|DbProvider|ReadonlyDb)\b/u,
  'auth modules must not import or use raw runtime DB values',
);
requirePattern(
  soundSubset,
  /\['src\/auth\.ts',\s+new Set\(\['createAuthAdapter'\]\)\]/u,
  'sound-subset allowlist must restrict src/auth.ts to createAuthAdapter',
);
requirePattern(
  soundSubset,
  /\['src\/auth\.sqlite\.ts',\s+new Set\(\['createAuthAdapter'\]\)\]/u,
  'sound-subset allowlist must restrict src/auth.sqlite.ts to createAuthAdapter',
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
