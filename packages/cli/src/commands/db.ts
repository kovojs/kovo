import { readdir, readFile } from 'node:fs/promises';
import { dirname, extname, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  checkPostgresAppDbPosture,
  createPostgresAppRuntimeDb,
  migratePostgresAppDb,
  provisionPostgresAppDb,
  type KovoPostgresAppRuntimeOptions,
  type KovoPostgresMigration,
  type KovoPostgresMigrationRunReport,
  type KovoPostgresPostureReport,
  type KovoPostgresRuntimeDriver,
} from '@kovojs/server';

import {
  commandArgvError,
  DB_ARGV_SPEC,
  DB_USAGE,
  parsedStringOption,
  parseCommandArgv,
} from '../commands-manifest.js';
import { dbOutputVersion, stableValue, type CliCommandResult } from '../shared.js';

type KovoDbAction = 'check' | 'migrate' | 'provision';

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
    return { message: `kovo: db requires provision, migrate, or check.\n${dbUsage()}`, ok: false };
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

export async function runDbCommand(options: KovoDbOptions): Promise<CliCommandResult> {
  try {
    const schema = await loadSchemaModule(options.schemaPath);
    const report = await runDbAction({ ...options, schema });
    return dbCommandResult(options.action, report);
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
      exitCode: 1,
    };
  }
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
  if (value === 'check' || value === 'migrate' || value === 'provision') return value;
  return undefined;
}

function parsePostgresRuntimeDriver(value: string): KovoPostgresRuntimeDriver | undefined {
  if (value === 'pg' || value === 'pglite' || value === 'node-postgres') return value;
  return undefined;
}

async function loadSchemaModule(schemaPath: string): Promise<Record<string, unknown>> {
  const resolvedPath = resolve(schemaPath);
  const loaded = schemaModuleNeedsVite(resolvedPath)
    ? await loadSchemaModuleWithVite(resolvedPath)
    : ((await import(pathToFileURL(resolvedPath).href)) as Record<string, unknown>);
  return schemaExports(loaded);
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
  options: KovoDbOptions & { schema: Record<string, unknown> },
): Promise<DbRunReport> {
  const migrations = await loadMigrationFiles(options.migrationsDir ?? 'migrations');
  if (shouldProvisionEmbeddedPglite(options)) {
    if (migrations.length > 0) {
      const migrated = await migratePostgresAppDb({
        ...runtimeOptions(options, { driver: 'pglite' }),
        migrations,
      });
      return { migrations: migrated, posture: migrated.posture };
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
    };
  }

  const databaseUrl = nonEmptyValue(
    options.adminDatabaseUrl ?? process.env.KOVO_ADMIN_DATABASE_URL,
  );
  if (databaseUrl === undefined || databaseUrl === '') {
    throw new Error(
      'kovo db provision requires KOVO_ADMIN_DATABASE_URL, --admin-database-url, or --driver pglite.',
    );
  }
  if (migrations.length > 0) {
    const migrated = await migratePostgresAppDb({
      ...runtimeOptions(options, { databaseUrl, driver: 'node-postgres' }),
      migrations,
    });
    return { migrations: migrated, posture: migrated.posture };
  }
  return {
    posture: await provisionPostgresAppDb({
      ...runtimeOptions(options, { driver: 'node-postgres' }),
      databaseUrl,
    }),
  };
}

async function runDbMigrate(
  options: KovoDbOptions & { schema: Record<string, unknown> },
): Promise<DbRunReport> {
  const migrations = await loadMigrationFiles(options.migrationsDir ?? 'migrations');
  if (shouldMigrateEmbeddedPglite(options)) {
    const migrated = await migratePostgresAppDb({
      ...runtimeOptions(options, { driver: 'pglite' }),
      migrations,
    });
    return { migrations: migrated, posture: migrated.posture };
  }

  const databaseUrl = nonEmptyValue(
    options.adminDatabaseUrl ?? process.env.KOVO_ADMIN_DATABASE_URL,
  );
  if (databaseUrl === undefined || databaseUrl === '') {
    throw new Error(
      'kovo db migrate requires KOVO_ADMIN_DATABASE_URL, --admin-database-url, or --driver pglite.',
    );
  }
  const migrated = await migratePostgresAppDb({
    ...runtimeOptions(options, { databaseUrl, driver: 'node-postgres' }),
    migrations,
  });
  return { migrations: migrated, posture: migrated.posture };
}

async function runDbCheck(
  options: KovoDbOptions & { schema: Record<string, unknown> },
): Promise<DbRunReport> {
  const overrides = shouldCheckEmbeddedPglite(options) ? ({ driver: 'pglite' } as const) : {};
  return { posture: await checkPostgresAppDbPosture(runtimeOptions(options, overrides)) };
}

async function runDbAction(
  options: KovoDbOptions & { schema: Record<string, unknown> },
): Promise<DbRunReport> {
  if (options.action === 'check') return await runDbCheck(options);
  if (options.action === 'migrate') return await runDbMigrate(options);
  return await runDbProvision(options);
}

async function loadMigrationFiles(migrationsDir: string): Promise<KovoPostgresMigration[]> {
  const resolvedDir = resolve(migrationsDir);
  let entries;
  try {
    entries = await readdir(resolvedDir, { withFileTypes: true });
  } catch (error) {
    if ((error as { code?: unknown }).code === 'ENOENT') return [];
    throw error;
  }
  const sqlFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
  return await Promise.all(
    sqlFiles.map(async (fileName) => ({
      id: fileName,
      sql: await readFile(resolve(resolvedDir, fileName), 'utf8'),
    })),
  );
}

function runtimeOptions(
  options: KovoDbOptions & { schema: Record<string, unknown> },
  overrides: Partial<KovoPostgresAppRuntimeOptions> = {},
): KovoPostgresAppRuntimeOptions {
  return {
    schema: options.schema,
    ...(options.dataDir === undefined ? {} : { dataDir: options.dataDir }),
    ...(options.databaseUrl === undefined ? {} : { databaseUrl: options.databaseUrl }),
    ...(options.driver === undefined ? {} : { driver: options.driver }),
    ...(options.readerRole === undefined ? {} : { readerRole: options.readerRole }),
    ...(options.writerRole === undefined ? {} : { writerRole: options.writerRole }),
    ...overrides,
  };
}

function shouldProvisionEmbeddedPglite(options: KovoDbOptions): boolean {
  const driver = options.driver ?? process.env.KOVO_DB_DRIVER;
  if (driver === 'pglite') return true;
  if (driver === 'pg' || driver === 'node-postgres') return false;
  return (
    nonEmptyValue(options.adminDatabaseUrl) === undefined &&
    nonEmptyValue(options.databaseUrl) === undefined &&
    nonEmptyValue(process.env.KOVO_ADMIN_DATABASE_URL) === undefined &&
    nonEmptyValue(process.env.KOVO_DATABASE_URL) === undefined
  );
}

function shouldCheckEmbeddedPglite(options: KovoDbOptions): boolean {
  const driver = options.driver ?? process.env.KOVO_DB_DRIVER;
  if (driver === 'pglite') return true;
  if (driver === 'pg' || driver === 'node-postgres') return false;
  return (
    nonEmptyValue(options.databaseUrl) === undefined &&
    nonEmptyValue(process.env.KOVO_DATABASE_URL) === undefined
  );
}

function shouldMigrateEmbeddedPglite(options: KovoDbOptions): boolean {
  return shouldCheckEmbeddedPglite(options);
}

function nonEmptyValue(value: string | undefined): string | undefined {
  return value === undefined || value === '' ? undefined : value;
}

interface DbRunReport {
  migrations?: KovoPostgresMigrationRunReport;
  posture: KovoPostgresPostureReport;
}

function dbCommandResult(action: KovoDbAction, report: DbRunReport): CliCommandResult {
  const migrations = report.migrations;
  const posture = report.posture;
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
        `FINGERPRINT ${posture.fingerprint}`,
        `STATUS ${posture.ok ? 'ok' : 'failed'}`,
        ...migrationLines,
        ...posture.issues.map(
          (issue) => `ISSUE code=${issue.code} detail=${stableValue(issue.detail)}`,
        ),
        summary,
      ].join('\n') + '\n',
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
