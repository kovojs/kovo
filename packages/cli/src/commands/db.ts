import { access as builtinAccess } from 'node:fs/promises';
import {
  dirname as builtinDirname,
  extname as builtinExtname,
  relative as builtinRelative,
  resolve as builtinResolve,
} from 'node:path';
import { pathToFileURL as builtinPathToFileURL } from 'node:url';

import {
  checkPostgresAppDbPosture,
  createPostgresAppRuntimeDb,
  migratePostgresAppDb,
  planPostgresAppDbMigration,
  provisionPostgresAppDb,
  type KovoPostgresAppRuntimeOptions,
  type KovoPostgresMigrationPlan,
  type KovoPostgresMigration,
  type KovoPostgresMigrationRunReport,
  type KovoPostgresPostureReport,
  type KovoPostgresRuntimeDriver,
} from '@kovojs/server';
import { collectRuntimeRegistryFacts } from '@kovojs/server/internal/data-plane-static-analysis';
import { installGeneratedTableSecurityManifestForCommand } from '@kovojs/server/internal/execution';
import { createFrameworkOutputFileSystemBoundary } from '@kovojs/core/internal/filesystem';

import {
  commandArgvError,
  DB_ARGV_SPEC,
  DB_USAGE,
  parsedStringOption,
  parseCommandArgv,
} from '../commands-manifest.js';
import { kovoInvocationEnvironmentValue } from '../invocation-environment.js';
import { dbOutputVersion, stableValue, type CliCommandResult } from '../shared.js';
import {
  kovoCommandBootSecurityDisposition,
  type KovoCommandSecurityDisposition,
} from './security-disposition.js';
import {
  buildArrayJoin,
  buildCurrentIsoTimestamp,
  buildRegExpReplace,
  buildSecurityArrayAppend,
  buildStringEndsWith,
  buildStringTrimEnd,
  buildUtf8Text,
} from './build-security-intrinsics.js';

// SPEC §6.6 rule 6: Node builtin ESM exports can be resynchronized from their mutable CommonJS
// facades. Pin every DB-command path/file control before authored schema modules evaluate so a
// later syncBuiltinESMExports() cannot redirect migration or runtime-database authority.
const access = builtinAccess;
const dirname = builtinDirname;
const extname = builtinExtname;
const relative = builtinRelative;
const resolve = builtinResolve;
const pathToFileURL = builtinPathToFileURL;

type KovoDbAction = 'check' | 'generate' | 'migrate' | 'provision';
type KovoDbTargetSource = 'admin' | 'explicit-driver' | 'pglite' | 'runtime';
let generatedMigrationSequence = 0;

interface KovoDbOptions {
  action: KovoDbAction;
  adminDatabaseUrl?: string;
  dataDir?: string;
  databaseUrl?: string;
  driver?: KovoPostgresRuntimeDriver;
  migrationsDir?: string;
  readerRole?: string;
  schemaPath: string;
  writerRole?: string;
}

interface ResolvedKovoDbOptions extends KovoDbOptions {
  invocationCwd: string;
  invocationEnv: NodeJS.ProcessEnv;
  migrationsDir: string;
}

interface LoadedDbConfig {
  runtimeOptions?: KovoPostgresAppRuntimeOptions;
  schema: Record<string, unknown>;
}

type DbArgParseResult = { ok: true; options: KovoDbOptions } | { message: string; ok: false };

export function parseDbArgs(args: readonly string[]): DbArgParseResult {
  const parsed = parseCommandArgv(args, DB_ARGV_SPEC);
  if (!parsed.ok) return dbArgvError(parsed);

  const [actionValue, extra] = parsed.value.positionals;
  if (extra !== undefined) {
    return { message: `kovo: db accepts one action.\n${dbUsage()}`, ok: false };
  }
  const action = parseDbAction(actionValue);
  if (action === undefined) {
    return {
      message: `kovo: db requires provision, migrate, generate, or check.\n${dbUsage()}`,
      ok: false,
    };
  }

  const driverValue = parsedStringOption(parsed.value, '--driver');
  const driver = driverValue === undefined ? undefined : parsePostgresRuntimeDriver(driverValue);
  if (driverValue !== undefined && driver === undefined) {
    return {
      message: `kovo: unsupported db driver ${stableValue(driverValue)}.\n${dbUsage()}`,
      ok: false,
    };
  }

  const adminDatabaseUrl = parsedStringOption(parsed.value, '--admin-database-url');
  const dataDir = parsedStringOption(parsed.value, '--data-dir');
  const databaseUrl = parsedStringOption(parsed.value, '--database-url');
  const migrationsDir = parsedStringOption(parsed.value, '--migrations');
  const readerRole = parsedStringOption(parsed.value, '--reader-role');
  const writerRole = parsedStringOption(parsed.value, '--writer-role');
  const options: KovoDbOptions = {
    action,
    schemaPath: parsedStringOption(parsed.value, '--schema') ?? 'src/schema.ts',
  };
  if (adminDatabaseUrl !== undefined) options.adminDatabaseUrl = adminDatabaseUrl;
  if (dataDir !== undefined) options.dataDir = dataDir;
  if (databaseUrl !== undefined) options.databaseUrl = databaseUrl;
  if (driver !== undefined) options.driver = driver;
  if (migrationsDir !== undefined) options.migrationsDir = migrationsDir;
  if (readerRole !== undefined) options.readerRole = readerRole;
  if (writerRole !== undefined) options.writerRole = writerRole;
  return { ok: true, options };
}

export async function runDbCommand(
  options: KovoDbOptions,
  security: KovoCommandSecurityDisposition = kovoCommandBootSecurityDisposition,
): Promise<CliCommandResult> {
  let releaseTableSecurityManifest: (() => void) | undefined;
  try {
    // SPEC §6.6 rule 6: resolve every operator-selected path and environment value before the
    // authored schema/runtime-options graph evaluates. Schema top-level code shares the process,
    // but cannot redirect privileged database administration or framework-owned migration I/O.
    const resolvedOptions = resolveDbCommandAuthority(options, security);
    const sourceRoot = dbStaticAnalysisSourceRoot(resolvedOptions);
    const registry = await collectRuntimeRegistryFacts({
      appSourceDir: dirname(resolvedOptions.schemaPath),
      root: sourceRoot,
    });
    if (registry.tableSecurity !== undefined) {
      releaseTableSecurityManifest = installGeneratedTableSecurityManifestForCommand(
        registry.tableSecurity,
      );
    }
    const dbConfig = await loadDbConfig(resolvedOptions.schemaPath);
    if (resolvedOptions.action === 'generate') {
      return dbGenerateCommandResult(await runDbGenerate({ ...resolvedOptions, dbConfig }));
    }
    const report = await runDbAction({ ...resolvedOptions, dbConfig });
    return dbCommandResult(resolvedOptions.action, report);
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
      exitCode: 1,
    };
  } finally {
    releaseTableSecurityManifest?.();
  }
}

function dbStaticAnalysisSourceRoot(options: ResolvedKovoDbOptions): string {
  const schemaRelative = relative(options.invocationCwd, options.schemaPath);
  const schemaIsInsideInvocationRoot =
    schemaRelative === '' ||
    (!schemaRelative.startsWith('..') &&
      !schemaRelative.startsWith('/') &&
      !/^[A-Za-z]:/u.test(schemaRelative));
  return schemaIsInsideInvocationRoot ? options.invocationCwd : dirname(options.schemaPath);
}

function resolveDbCommandAuthority(
  options: KovoDbOptions,
  security: KovoCommandSecurityDisposition,
): ResolvedKovoDbOptions {
  const invocationCwd = security.invocationCwd;
  const driver = resolveDbCommandDriver(options.driver, security.invocationEnv);
  return {
    ...options,
    ...(options.dataDir === undefined ? {} : { dataDir: resolve(invocationCwd, options.dataDir) }),
    ...(driver === undefined ? {} : { driver }),
    invocationCwd,
    invocationEnv: security.invocationEnv,
    migrationsDir: resolve(invocationCwd, options.migrationsDir ?? 'migrations'),
    schemaPath: resolve(invocationCwd, options.schemaPath),
  };
}

function resolveDbCommandDriver(
  explicitDriver: KovoPostgresRuntimeDriver | undefined,
  invocationEnv: NodeJS.ProcessEnv,
): KovoPostgresRuntimeDriver | undefined {
  if (explicitDriver !== undefined) return explicitDriver;
  const environmentDriver = kovoInvocationEnvironmentValue(invocationEnv, 'KOVO_DB_DRIVER');
  if (environmentDriver === undefined) return undefined;
  const parsed = parsePostgresRuntimeDriver(environmentDriver);
  if (parsed === undefined) {
    throw new Error(
      `kovo: unsupported KOVO_DB_DRIVER ${stableValue(environmentDriver)}; expected pglite, pg, or node-postgres.`,
    );
  }
  return parsed;
}

function dbArgvError(error: Exclude<ReturnType<typeof parseCommandArgv>, { ok: true }>): {
  message: string;
  ok: false;
} {
  return commandArgvError('db', error, dbUsage());
}

function dbUsage(): string {
  return [DB_USAGE, ''].join('\n');
}

function parseDbAction(value: string | undefined): KovoDbAction | undefined {
  if (value === 'check' || value === 'generate' || value === 'migrate' || value === 'provision') {
    return value;
  }
  return undefined;
}

function parsePostgresRuntimeDriver(value: string): KovoPostgresRuntimeDriver | undefined {
  if (value === 'pg' || value === 'pglite' || value === 'node-postgres') return value;
  return undefined;
}

async function loadSchemaModule(schemaPath: string): Promise<Record<string, unknown>> {
  return schemaExports(await loadModuleExports(resolve(schemaPath)));
}

async function loadModuleExports(resolvedPath: string): Promise<Record<string, unknown>> {
  const loaded = schemaModuleNeedsVite(resolvedPath)
    ? await loadSchemaModuleWithVite(resolvedPath)
    : ((await import(pathToFileURL(resolvedPath).href)) as Record<string, unknown>);
  return loaded;
}

async function loadSchemaModuleWithVite(schemaPath: string): Promise<Record<string, unknown>> {
  const { createServer } = await import('vite-plus');
  const root = dirname(schemaPath);
  const server = await createServer({
    appType: 'custom',
    logLevel: 'error',
    root,
    server: { hmr: false },
  });
  try {
    return (await server.ssrLoadModule(viteSsrModuleId(schemaPath, root))) as Record<
      string,
      unknown
    >;
  } finally {
    await server.close();
  }
}

function schemaExports(loaded: Record<string, unknown>): Record<string, unknown> {
  const schema: Record<string, unknown> = { ...loaded };
  const defaultExport = loaded.default;
  if (isRecord(defaultExport)) {
    for (const [key, value] of Object.entries(defaultExport)) schema[key] = value;
  }
  return schema;
}

async function loadDbConfig(schemaPath: string): Promise<LoadedDbConfig> {
  const resolvedSchemaPath = resolve(schemaPath);
  const runtimeModulePath = await resolveRuntimeOptionsModulePath(resolvedSchemaPath);
  if (runtimeModulePath !== undefined) {
    const loaded = await loadModuleExports(runtimeModulePath);
    const runtimeOptions = appRuntimeOptionsExport(loaded);
    if (runtimeOptions !== undefined) {
      return { runtimeOptions, schema: schemaFromRuntimeOptions(runtimeOptions) };
    }
  }
  return { schema: await loadSchemaModule(resolvedSchemaPath) };
}

function schemaFromRuntimeOptions(options: KovoPostgresAppRuntimeOptions): Record<string, unknown> {
  return schemaExports(options.schema);
}

function appRuntimeOptionsExport(
  loaded: Record<string, unknown>,
): KovoPostgresAppRuntimeOptions | undefined {
  const direct = loaded.appRuntimeDbOptions;
  if (isPostgresRuntimeOptions(direct)) return direct;
  const defaultExport = loaded.default;
  if (isRecord(defaultExport) && isPostgresRuntimeOptions(defaultExport.appRuntimeDbOptions)) {
    return defaultExport.appRuntimeDbOptions;
  }
  return undefined;
}

function isPostgresRuntimeOptions(value: unknown): value is KovoPostgresAppRuntimeOptions {
  return isRecord(value) && isRecord(value.schema);
}

async function resolveRuntimeOptionsModulePath(schemaPath: string): Promise<string | undefined> {
  const extension = extname(schemaPath);
  const candidates =
    extension === '' ? ['.ts', '.tsx', '.js', '.jsx', '.mts', '.mjs'] : [extension];
  for (const candidate of candidates) {
    const filePath = resolve(dirname(schemaPath), '_kovo', `app-runtime-db-options${candidate}`);
    try {
      await access(filePath);
      return filePath;
    } catch {}
  }
  return undefined;
}

function schemaModuleNeedsVite(schemaPath: string): boolean {
  return ['.ts', '.tsx', '.jsx'].includes(extname(schemaPath));
}

function viteSsrModuleId(filePath: string, root: string): string {
  const relativePath = relative(root, filePath);
  if (
    relativePath !== '' &&
    !relativePath.startsWith('..') &&
    !relativePath.startsWith('/') &&
    !/^[A-Za-z]:/.test(relativePath)
  ) {
    return `/${relativePath.split(/[\\/]/).join('/')}`;
  }
  return pathToFileURL(filePath).href;
}

async function runDbProvision(
  options: ResolvedKovoDbOptions & { dbConfig: LoadedDbConfig },
): Promise<DbRunReport> {
  const migrations = await loadMigrationFiles(options.migrationsDir ?? 'migrations');
  if (shouldProvisionEmbeddedPglite(options)) {
    if (migrations.length > 0) {
      const migrated = await migratePostgresAppDb({
        ...runtimeOptions(options, { driver: 'pglite' }),
        migrations,
      });
      return { migrations: migrated, posture: migrated.posture, targetSource: 'pglite' };
    }
    const runtime = createPostgresAppRuntimeDb(
      runtimeOptions(options, { driver: 'pglite', provisionOnBoot: true }),
    );
    try {
      await runtime.ready;
    } finally {
      await runtime.close();
    }
    return {
      posture: await checkPostgresAppDbPosture(runtimeOptions(options, { driver: 'pglite' })),
      targetSource: 'pglite',
    };
  }

  const adminDatabaseUrl = resolveAdminDatabaseUrl(options);
  if (adminDatabaseUrl === undefined) {
    throw new Error(
      'kovo db provision requires KOVO_ADMIN_DATABASE_URL, --admin-database-url, or --driver pglite.',
    );
  }
  if (migrations.length > 0) {
    const runtimeDatabaseUrl = resolveRuntimeDatabaseUrl(options);
    const migrated = await migratePostgresAppDb({
      ...runtimeOptions(options, { databaseUrl: adminDatabaseUrl, driver: 'node-postgres' }),
      migrations,
      ...(runtimeDatabaseUrl === undefined ? {} : { runtimeDatabaseUrl }),
    });
    return { migrations: migrated, posture: migrated.posture, targetSource: 'admin' };
  }
  const runtimeDatabaseUrl = resolveRuntimeDatabaseUrl(options);
  const provisionOptions: KovoPostgresAppRuntimeOptions & {
    databaseUrl: string;
    runtimeDatabaseUrl?: string;
  } = {
    ...runtimeOptions(options, { driver: 'node-postgres' }),
    databaseUrl: adminDatabaseUrl,
  };
  if (runtimeDatabaseUrl !== undefined) {
    provisionOptions.runtimeDatabaseUrl = runtimeDatabaseUrl;
  }
  return {
    posture: await provisionPostgresAppDb(provisionOptions),
    targetSource: 'admin',
  };
}

async function runDbMigrate(
  options: ResolvedKovoDbOptions & { dbConfig: LoadedDbConfig },
): Promise<DbRunReport> {
  const migrations = await loadMigrationFiles(options.migrationsDir ?? 'migrations');
  if (shouldMigrateEmbeddedPglite(options)) {
    const migrated = await migratePostgresAppDb({
      ...runtimeOptions(options, { driver: 'pglite' }),
      migrations,
    });
    return { migrations: migrated, posture: migrated.posture, targetSource: 'pglite' };
  }

  const databaseUrl = resolveAdminDatabaseUrl(options);
  if (databaseUrl === undefined) {
    throw new Error(
      'kovo db migrate requires KOVO_ADMIN_DATABASE_URL, --admin-database-url, or --driver pglite.',
    );
  }
  const runtimeDatabaseUrl = resolveRuntimeDatabaseUrl(options);
  const migrated = await migratePostgresAppDb({
    ...runtimeOptions(options, { databaseUrl, driver: 'node-postgres' }),
    migrations,
    ...(runtimeDatabaseUrl === undefined ? {} : { runtimeDatabaseUrl }),
  });
  return { migrations: migrated, posture: migrated.posture, targetSource: 'admin' };
}

async function runDbGenerate(
  options: ResolvedKovoDbOptions & { dbConfig: LoadedDbConfig },
): Promise<DbGenerateReport> {
  const migrationsDir = options.migrationsDir ?? 'migrations';
  const plan = await planPostgresAppDbMigration(
    runtimeOptions(options, generateDriverOptions(options)),
  );
  const files =
    plan.empty === true ? undefined : await writeGeneratedMigrationFiles(migrationsDir, plan);
  return files === undefined ? { plan } : { files, plan };
}

async function runDbCheck(
  options: ResolvedKovoDbOptions & { dbConfig: LoadedDbConfig },
): Promise<DbRunReport> {
  const target = checkTargetOptions(options);
  return {
    posture: await checkPostgresAppDbPosture(runtimeOptions(options, target.overrides)),
    targetSource: target.source,
  };
}

async function runDbAction(
  options: ResolvedKovoDbOptions & { dbConfig: LoadedDbConfig },
): Promise<DbRunReport> {
  if (options.action === 'check') return await runDbCheck(options);
  if (options.action === 'migrate') return await runDbMigrate(options);
  return await runDbProvision(options);
}

async function loadMigrationFiles(migrationsDir: string): Promise<KovoPostgresMigration[]> {
  const resolvedDir = resolve(migrationsDir);
  const fileSystem = createFrameworkOutputFileSystemBoundary(resolvedDir);
  const entries = await fileSystem.entries();
  const sqlEntries: (typeof entries)[number][] = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]!;
    if (
      entry.kind !== 'file' ||
      !buildStringEndsWith(entry.name, '.sql') ||
      buildStringEndsWith(entry.name, '.down.sql')
    ) {
      continue;
    }
    let insertAt = sqlEntries.length;
    buildSecurityArrayAppend(sqlEntries, entry, 'Kovo DB migration entries');
    while (insertAt > 0 && entry.name < sqlEntries[insertAt - 1]!.name) {
      sqlEntries[insertAt] = sqlEntries[insertAt - 1]!;
      insertAt -= 1;
    }
    sqlEntries[insertAt] = entry;
  }
  const migrations: KovoPostgresMigration[] = [];
  for (let index = 0; index < sqlEntries.length; index += 1) {
    const entry = sqlEntries[index]!;
    const bytes = await fileSystem.fileBytesOf(entry);
    buildSecurityArrayAppend(
      migrations,
      { id: entry.name, sql: buildUtf8Text(bytes) },
      'Kovo DB migration snapshots',
    );
  }
  return migrations;
}

function runtimeOptions(
  options: ResolvedKovoDbOptions & { dbConfig: LoadedDbConfig },
  overrides: Partial<KovoPostgresAppRuntimeOptions> = {},
): KovoPostgresAppRuntimeOptions {
  const runtimeOptions = options.dbConfig.runtimeOptions;
  const result: KovoPostgresAppRuntimeOptions = {
    ...(runtimeOptions ?? { schema: options.dbConfig.schema }),
    schema: options.dbConfig.schema,
  };
  const databaseUrl = resolveRuntimeDatabaseUrl(options);
  const configuredDataDir =
    options.dataDir ??
    result.dataDir ??
    invocationEnvironmentValue(options, 'KOVO_DATA_DIR') ??
    '.kovo/data';
  result.dataDir = resolve(options.invocationCwd, configuredDataDir);
  if (databaseUrl !== undefined) result.databaseUrl = databaseUrl;
  if (options.driver !== undefined) result.driver = options.driver;
  if (options.readerRole !== undefined) result.readerRole = options.readerRole;
  if (options.writerRole !== undefined) result.writerRole = options.writerRole;
  applyRuntimeOptionOverrides(result, overrides);
  return result;
}

function applyRuntimeOptionOverrides(
  result: KovoPostgresAppRuntimeOptions,
  overrides: Partial<KovoPostgresAppRuntimeOptions>,
): void {
  if (overrides.schema !== undefined) result.schema = overrides.schema;
  if (overrides.dataDir !== undefined) result.dataDir = overrides.dataDir;
  if (overrides.databaseUrl !== undefined) result.databaseUrl = overrides.databaseUrl;
  if (overrides.driver !== undefined) result.driver = overrides.driver;
  if (overrides.provisionOnBoot !== undefined) result.provisionOnBoot = overrides.provisionOnBoot;
  if (overrides.postureCheck !== undefined) result.postureCheck = overrides.postureCheck;
  if (overrides.principalFromRequest !== undefined)
    result.principalFromRequest = overrides.principalFromRequest;
  if (overrides.readerRole !== undefined) result.readerRole = overrides.readerRole;
  if (overrides.adminRole !== undefined) result.adminRole = overrides.adminRole;
  if (overrides.systemRole !== undefined) result.systemRole = overrides.systemRole;
  if (overrides.crossOwnerReadTables !== undefined)
    result.crossOwnerReadTables = overrides.crossOwnerReadTables;
  if (overrides.publicRelations !== undefined) result.publicRelations = overrides.publicRelations;
  if (overrides.seedSql !== undefined) result.seedSql = overrides.seedSql;
  if (overrides.writerRole !== undefined) result.writerRole = overrides.writerRole;
}

function shouldProvisionEmbeddedPglite(options: ResolvedKovoDbOptions): boolean {
  const driver = options.driver;
  if (driver === 'pglite') return true;
  if (driver === 'pg' || driver === 'node-postgres') return false;
  return (
    nonEmptyValue(options.adminDatabaseUrl) === undefined &&
    resolveRuntimeDatabaseUrl(options) === undefined &&
    nonEmptyValue(invocationEnvironmentValue(options, 'KOVO_ADMIN_DATABASE_URL')) === undefined &&
    nonEmptyValue(invocationEnvironmentValue(options, 'KOVO_RUNTIME_DATABASE_URL')) === undefined &&
    nonEmptyValue(invocationEnvironmentValue(options, 'KOVO_DATABASE_URL')) === undefined
  );
}

function shouldCheckEmbeddedPglite(options: ResolvedKovoDbOptions): boolean {
  const driver = options.driver;
  if (driver === 'pglite') return true;
  if (driver === 'pg' || driver === 'node-postgres') return false;
  return (
    resolveRuntimeDatabaseUrl(options) === undefined &&
    resolveAdminDatabaseUrl(options) === undefined
  );
}

function shouldMigrateEmbeddedPglite(options: ResolvedKovoDbOptions): boolean {
  return shouldCheckEmbeddedPglite(options);
}

function checkTargetOptions(options: ResolvedKovoDbOptions): {
  overrides: Partial<KovoPostgresAppRuntimeOptions>;
  source: KovoDbTargetSource;
} {
  const driver = options.driver;
  if (driver === 'pglite') return { overrides: { driver: 'pglite' }, source: 'explicit-driver' };
  const runtimeDatabaseUrl = resolveRuntimeDatabaseUrl(options);
  if (driver === 'pg' || driver === 'node-postgres') {
    const databaseUrl = runtimeDatabaseUrl ?? resolveAdminDatabaseUrl(options);
    if (databaseUrl === undefined) {
      throw new Error(
        'kovo db check with external Postgres requires KOVO_DATABASE_URL, KOVO_RUNTIME_DATABASE_URL, KOVO_ADMIN_DATABASE_URL, --database-url, or --admin-database-url.',
      );
    }
    return {
      overrides: { databaseUrl, driver: 'node-postgres' },
      source: runtimeDatabaseUrl === undefined ? 'admin' : 'runtime',
    };
  }
  if (runtimeDatabaseUrl !== undefined) {
    return {
      overrides: { databaseUrl: runtimeDatabaseUrl, driver: 'node-postgres' },
      source: 'runtime',
    };
  }
  const adminDatabaseUrl = resolveAdminDatabaseUrl(options);
  if (adminDatabaseUrl !== undefined) {
    return {
      overrides: { databaseUrl: adminDatabaseUrl, driver: 'node-postgres' },
      source: 'admin',
    };
  }
  return { overrides: { driver: 'pglite' }, source: 'pglite' };
}

function generateDriverOptions(
  options: ResolvedKovoDbOptions,
): Partial<KovoPostgresAppRuntimeOptions> {
  const driver = options.driver;
  if (driver === 'pglite' || shouldCheckEmbeddedPglite(options)) return { driver: 'pglite' };
  const databaseUrl = nonEmptyValue(
    resolveAdminDatabaseUrl(options) ?? resolveRuntimeDatabaseUrl(options),
  );
  if (databaseUrl === undefined) {
    throw new Error(
      'kovo db generate requires KOVO_ADMIN_DATABASE_URL, KOVO_RUNTIME_DATABASE_URL, KOVO_DATABASE_URL, --admin-database-url, --database-url, or --driver pglite.',
    );
  }
  return { databaseUrl, driver: 'node-postgres' };
}

function resolveAdminDatabaseUrl(options: ResolvedKovoDbOptions): string | undefined {
  return nonEmptyValue(
    options.adminDatabaseUrl ?? invocationEnvironmentValue(options, 'KOVO_ADMIN_DATABASE_URL'),
  );
}

function resolveRuntimeDatabaseUrl(options: ResolvedKovoDbOptions): string | undefined {
  return nonEmptyValue(
    options.databaseUrl ??
      invocationEnvironmentValue(options, 'KOVO_RUNTIME_DATABASE_URL') ??
      invocationEnvironmentValue(options, 'KOVO_DATABASE_URL'),
  );
}

function invocationEnvironmentValue(
  options: ResolvedKovoDbOptions,
  name: string,
): string | undefined {
  return kovoInvocationEnvironmentValue(options.invocationEnv, name);
}

function nonEmptyValue(value: string | undefined): string | undefined {
  return value === undefined || value === '' ? undefined : value;
}

interface DbRunReport {
  migrations?: KovoPostgresMigrationRunReport;
  posture: KovoPostgresPostureReport;
  targetSource: KovoDbTargetSource;
}

interface GeneratedMigrationFiles {
  down: string;
  up: string;
}

interface DbGenerateReport {
  files?: GeneratedMigrationFiles;
  plan: KovoPostgresMigrationPlan;
}

function dbCommandResult(action: KovoDbAction, report: DbRunReport): CliCommandResult {
  const migrations = report.migrations;
  const posture = report.posture;
  const topology = posture.roleTopology;
  const migrationLines =
    migrations === undefined
      ? []
      : [
          ...migrations.applied.map((id) => `MIGRATION status=applied id=${stableValue(id)}`),
          ...migrations.skipped.map((id) => `MIGRATION status=skipped id=${stableValue(id)}`),
        ];
  const summary =
    migrations === undefined
      ? `SUMMARY issues=${posture.issues.length}`
      : `SUMMARY migrationsApplied=${migrations.applied.length} migrationsSkipped=${migrations.skipped.length} issues=${posture.issues.length}`;
  return {
    exitCode: posture.ok ? 0 : 1,
    output:
      [
        dbOutputVersion,
        `ACTION ${action}`,
        `DRIVER ${posture.driver}`,
        `TARGET source=${report.targetSource}`,
        `STATUS ${posture.ok ? 'ok' : 'failed'}`,
        `ROLE readerRole=${stableValue(topology.readerRole.name)} management=${topology.readerRole.management}`,
        `ROLE writerRole=${stableValue(topology.writerRole.name)} management=${topology.writerRole.management}`,
        `ROLE adminRole=${stableValue(topology.adminRole.name)} management=${topology.adminRole.management}`,
        `ROLE systemRole=${stableValue(topology.systemRole.name)} management=${topology.systemRole.management}`,
        ...(topology.runtimeLogin === undefined
          ? []
          : [`ROLE runtimeLogin=${stableValue(topology.runtimeLogin)}`]),
        ...topology.membershipEdges.map(
          (edge) =>
            `MEMBERSHIP member=${stableValue(edge.memberRole)} role=${stableValue(edge.role)} owner=${edge.owner} status=${edge.status}`,
        ),
        ...migrationLines,
        ...posture.issues.map(
          (issue) => `ISSUE code=${issue.code} detail=${stableValue(issue.detail)}`,
        ),
        summary,
      ].join('\n') + '\n',
  };
}

function dbGenerateCommandResult(report: DbGenerateReport): CliCommandResult {
  return {
    exitCode: 0,
    output:
      [
        dbOutputVersion,
        'ACTION generate',
        `DRIVER ${report.plan.driver}`,
        `STATUS ${report.plan.empty ? 'empty' : 'generated'}`,
        ...report.plan.operations.map((operation) => `OPERATION ${stableValue(operation)}`),
        ...(report.files === undefined
          ? []
          : [
              `GENERATED up=${stableValue(report.files.up)}`,
              `GENERATED down=${stableValue(report.files.down)}`,
            ]),
        `SUMMARY operations=${report.plan.operations.length}`,
      ].join('\n') + '\n',
  };
}

async function writeGeneratedMigrationFiles(
  migrationsDir: string,
  plan: KovoPostgresMigrationPlan,
): Promise<GeneratedMigrationFiles> {
  const fileSystem = createFrameworkOutputFileSystemBoundary(migrationsDir);
  await fileSystem.ensureDirectory();
  const base = `${migrationTimestamp()}_generated`;
  const up = resolve(migrationsDir, `${base}.up.sql`);
  const down = resolve(migrationsDir, `${base}.down.sql`);
  await fileSystem.writeFile(`${base}.up.sql`, generatedMigrationText('up', plan.upSql));
  await fileSystem.writeFile(`${base}.down.sql`, generatedMigrationText('down', plan.downSql));
  return { down, up };
}

function generatedMigrationText(direction: 'down' | 'up', sql: string): string {
  return buildArrayJoin(
    [
      `-- Generated by kovo db generate (${direction}). Review before applying.`,
      '-- Add data backfills, destructive changes, and rename/drop decisions by hand.',
      buildStringTrimEnd(sql),
      '',
    ],
    '\n',
  );
}

function migrationTimestamp(): string {
  generatedMigrationSequence += 1;
  const timestamp = buildRegExpReplace(/\D/g, buildCurrentIsoTimestamp(), '');
  const sequence = `${generatedMigrationSequence}`;
  const prefix = sequence.length === 1 ? '00' : sequence.length === 2 ? '0' : '';
  const paddedSequence = `${prefix}${sequence}`;
  return `${timestamp}_${paddedSequence}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
