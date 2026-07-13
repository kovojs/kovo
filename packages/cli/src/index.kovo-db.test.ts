import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { mainAsync } from './index.js';
import { captureKovoCommandSecurityDisposition } from './commands/security-disposition.js';

describe('kovo db', () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
  });

  it('provisions and checks a PGlite database from the schema module', async () => {
    const { dataDir, schemaPath } = writeDbCommandFixture('provisioned');

    const provision = await captureWrites(() =>
      mainAsync(['db', 'provision', '--schema', schemaPath, '--data-dir', dataDir]),
    );

    expect(provision.result).toBe(0);
    expect(provision.stderr).toBe('');
    expect(provision.stdout).toContain('kovo-db/v1\nACTION provision\nDRIVER pglite\n');
    expect(provision.stdout).toContain('TARGET source=pglite\nSTATUS ok\n');
    expect(provision.stdout).toContain('ROLE readerRole="kovo_reader" management=create\n');
    expect(provision.stdout).toContain('ROLE writerRole="kovo_writer" management=create\n');
    expect(provision.stdout).toContain('ROLE adminRole="kovo_admin" management=create\n');
    expect(provision.stdout).toContain('ROLE systemRole="kovo_system" management=create\n');
    expect(provision.stdout).toContain('SUMMARY issues=0\n');

    const check = await captureWrites(() =>
      mainAsync(['db', 'check', '--schema', schemaPath, '--data-dir', dataDir]),
    );

    expect(check.result).toBe(0);
    expect(check.stderr).toBe('');
    expect(check.stdout).toContain('kovo-db/v1\nACTION check\nDRIVER pglite\n');
    expect(check.stdout).toContain('TARGET source=pglite\nSTATUS ok\n');
    expect(check.stdout).toContain('ROLE readerRole="kovo_reader" management=create\n');
    expect(check.stdout).toContain('ROLE writerRole="kovo_writer" management=create\n');
    expect(check.stdout).toContain('ROLE adminRole="kovo_admin" management=create\n');
    expect(check.stdout).toContain('ROLE systemRole="kovo_system" management=create\n');
    expect(check.stdout).toContain('SUMMARY issues=0\n');
  });

  it('prefers scaffolded app runtime options when the sibling runtime module exports them', async () => {
    const { dataDir, schemaPath } = writeDbCommandFixture('runtime-options');
    const runtimeModulePath = join(dirname(schemaPath), '_kovo', 'app-runtime-db.ts');
    mkdirSync(dirname(runtimeModulePath), { recursive: true });
    writeFileSync(
      runtimeModulePath,
      [
        "import type { KovoPostgresAppRuntimeOptions } from '@kovojs/server';",
        "import * as schema from '../schema.js';",
        '',
        'export const appRuntimeDbOptions = {',
        '  schema,',
        "  seedSql: \"INSERT INTO kovo_cli_db_notes (id, \\\"ownerId\\\", title) VALUES ('seeded-note', 'seed-user', 'Seeded from runtime options') ON CONFLICT (id) DO NOTHING;\",",
        '} satisfies KovoPostgresAppRuntimeOptions;',
        '',
      ].join('\n'),
      'utf8',
    );

    const provision = await captureWrites(() =>
      mainAsync(['db', 'provision', '--schema', schemaPath, '--data-dir', dataDir]),
    );

    expect(provision.result).toBe(0);
    expect(provision.stderr).toBe('');

    const { PGlite } = (await import(
      fileURLToPath(new URL('../../server/node_modules/@electric-sql/pglite', import.meta.url))
    )) as typeof import('@electric-sql/pglite');
    const db = new PGlite(dataDir);
    try {
      const seeded = await db.query<{
        id: string;
        ownerId: string;
        title: string;
      }>('select id, "ownerId", title from kovo_cli_db_notes where id = $1', ['seeded-note']);
      expect(seeded.rows).toEqual([
        {
          id: 'seeded-note',
          ownerId: 'seed-user',
          title: 'Seeded from runtime options',
        },
      ]);
    } finally {
      await db.close();
    }
  });

  it('fails closed when check sees an unprovisioned database', async () => {
    const { dataDir, schemaPath } = writeDbCommandFixture('empty');

    const check = await captureWrites(() =>
      mainAsync([
        'db',
        'check',
        '--schema',
        schemaPath,
        '--driver',
        'pglite',
        '--data-dir',
        dataDir,
      ]),
    );

    expect(check.result).toBe(1);
    expect(check.stdout).toBe('');
    expect(check.stderr).toContain('kovo-db/v1\nACTION check\nDRIVER pglite\n');
    expect(check.stderr).toContain('STATUS failed\n');
    expect(check.stderr).toContain('ISSUE code=KV433_SCHEMA_TABLE');
  });

  it('treats an admin URL as an external db check target instead of falling back to PGlite', async () => {
    const { schemaPath } = writeDbCommandFixture('admin-url-check');
    const previousAdminUrl = process.env.KOVO_ADMIN_DATABASE_URL;
    const previousDatabaseUrl = process.env.KOVO_DATABASE_URL;
    const previousRuntimeUrl = process.env.KOVO_RUNTIME_DATABASE_URL;
    delete process.env.KOVO_DATABASE_URL;
    delete process.env.KOVO_RUNTIME_DATABASE_URL;
    process.env.KOVO_ADMIN_DATABASE_URL = 'postgres://bad@127.0.0.1:1/nope';
    try {
      const security = captureKovoCommandSecurityDisposition();
      const check = await captureWrites(() =>
        mainAsync(['db', 'check', '--schema', schemaPath], security),
      );

      expect(check.result).toBe(1);
      expect(check.stdout).toBe('');
      expect(check.stderr).not.toContain('DRIVER pglite');
      expect(check.stderr).toMatch(/ECONNREFUSED|connect/);
    } finally {
      restoreEnv('KOVO_ADMIN_DATABASE_URL', previousAdminUrl);
      restoreEnv('KOVO_DATABASE_URL', previousDatabaseUrl);
      restoreEnv('KOVO_RUNTIME_DATABASE_URL', previousRuntimeUrl);
    }
  });

  it('applies reviewed SQL migrations before reasserting Postgres posture', async () => {
    const { dataDir, migrationsDir, schemaPath } = writeDbCommandFixture('migrated');
    writeFileSync(
      join(migrationsDir, '001_create_notes.sql'),
      [
        'CREATE TABLE kovo_cli_db_notes (',
        '  id text PRIMARY KEY,',
        '  "ownerId" text NOT NULL,',
        '  title text NOT NULL',
        ');',
        '',
      ].join('\n'),
      'utf8',
    );

    const migrate = await captureWrites(() =>
      mainAsync([
        'db',
        'migrate',
        '--schema',
        schemaPath,
        '--driver',
        'pglite',
        '--data-dir',
        dataDir,
        '--migrations',
        migrationsDir,
      ]),
    );

    expect(migrate.result).toBe(0);
    expect(migrate.stderr).toBe('');
    expect(migrate.stdout).toContain('kovo-db/v1\nACTION migrate\nDRIVER pglite\n');
    expect(migrate.stdout).toContain('MIGRATION status=applied id="001_create_notes.sql"\n');
    expect(migrate.stdout).toContain('STATUS ok\n');
    expect(migrate.stdout).toContain(
      'MIGRATION status=applied id="001_create_notes.sql"\nSUMMARY migrationsApplied=1 migrationsSkipped=0 issues=0\n',
    );

    const rerun = await captureWrites(() =>
      mainAsync([
        'db',
        'migrate',
        '--schema',
        schemaPath,
        '--driver',
        'pglite',
        '--data-dir',
        dataDir,
        '--migrations',
        migrationsDir,
      ]),
    );

    expect(rerun.result).toBe(0);
    expect(rerun.stderr).toBe('');
    expect(rerun.stdout).toContain('MIGRATION status=skipped id="001_create_notes.sql"\n');
    expect(rerun.stdout).toContain('SUMMARY migrationsApplied=0 migrationsSkipped=1 issues=0\n');

    writeFileSync(
      join(migrationsDir, '001_create_notes.sql'),
      [
        'CREATE TABLE kovo_cli_db_notes (',
        '  id text PRIMARY KEY,',
        '  "ownerId" text NOT NULL,',
        '  title text NOT NULL,',
        '  changed text',
        ');',
        '',
      ].join('\n'),
      'utf8',
    );

    const changed = await captureWrites(() =>
      mainAsync([
        'db',
        'migrate',
        '--schema',
        schemaPath,
        '--driver',
        'pglite',
        '--data-dir',
        dataDir,
        '--migrations',
        migrationsDir,
      ]),
    );

    expect(changed.result).toBe(1);
    expect(changed.stdout).toBe('');
    expect(changed.stderr).toContain('KV433_MIGRATION_CHECKSUM');
  });

  it('generates reviewable up/down SQL and migrates only the up file', async () => {
    const { dataDir, migrationsDir, schemaPath } = writeDbCommandFixture('generated');

    const generate = await captureWrites(() =>
      mainAsync([
        'db',
        'generate',
        '--schema',
        schemaPath,
        '--driver',
        'pglite',
        '--data-dir',
        dataDir,
        '--migrations',
        migrationsDir,
      ]),
    );

    expect(generate.result).toBe(0);
    expect(generate.stderr).toBe('');
    expect(generate.stdout).toContain('kovo-db/v1\nACTION generate\nDRIVER pglite\n');
    expect(generate.stdout).toContain('STATUS generated\n');
    expect(generate.stdout).toContain('OPERATION "create table public.kovo_cli_db_notes"\n');
    expect(generate.stdout).toContain('SUMMARY operations=1\n');

    const files = readdirSync(migrationsDir).sort();
    const upFile = files.find((file) => file.endsWith('.up.sql'));
    const downFile = files.find((file) => file.endsWith('.down.sql'));
    expect(upFile).toBeTruthy();
    expect(downFile).toBeTruthy();
    expect(readFileSync(join(migrationsDir, upFile ?? ''), 'utf8')).toContain(
      'CREATE TABLE "kovo_cli_db_notes"',
    );
    expect(readFileSync(join(migrationsDir, downFile ?? ''), 'utf8')).toContain(
      'DROP TABLE "kovo_cli_db_notes";',
    );

    const migrate = await captureWrites(() =>
      mainAsync([
        'db',
        'migrate',
        '--schema',
        schemaPath,
        '--driver',
        'pglite',
        '--data-dir',
        dataDir,
        '--migrations',
        migrationsDir,
      ]),
    );

    expect(migrate.result).toBe(0);
    expect(migrate.stderr).toBe('');
    expect(migrate.stdout).toContain(`MIGRATION status=applied id="${upFile}"\n`);
    expect(migrate.stdout).not.toContain(downFile ?? 'missing-down-file');
    expect(migrate.stdout).toContain('SUMMARY migrationsApplied=1 migrationsSkipped=0 issues=0\n');

    writeFileSync(
      schemaPath,
      readFileSync(schemaPath, 'utf8').replace(
        "    title: text('title').notNull(),",
        "    title: text('title').notNull(),\n    summary: text('summary'),",
      ),
      'utf8',
    );

    const addColumn = await captureWrites(() =>
      mainAsync([
        'db',
        'generate',
        '--schema',
        schemaPath,
        '--driver',
        'pglite',
        '--data-dir',
        dataDir,
        '--migrations',
        migrationsDir,
      ]),
    );
    expect(addColumn.result).toBe(0);
    expect(addColumn.stderr).toBe('');
    expect(addColumn.stdout).toContain('OPERATION "add column public.kovo_cli_db_notes.summary"\n');

    const afterColumnFiles = readdirSync(migrationsDir).sort();
    const newUpFile = afterColumnFiles.find((file) => file.endsWith('.up.sql') && file !== upFile);
    const newDownFile = afterColumnFiles.find(
      (file) => file.endsWith('.down.sql') && file !== downFile,
    );
    expect(newUpFile).toBeTruthy();
    expect(newDownFile).toBeTruthy();
    expect(readFileSync(join(migrationsDir, newUpFile ?? ''), 'utf8')).toContain(
      'ALTER TABLE "kovo_cli_db_notes" ADD COLUMN "summary" text;',
    );
    expect(readFileSync(join(migrationsDir, newDownFile ?? ''), 'utf8')).toContain(
      'ALTER TABLE "kovo_cli_db_notes" DROP COLUMN "summary";',
    );
  });

  it('does not write generated migrations through a symlinked migrations root', async () => {
    const { dataDir, migrationsDir, root, schemaPath } = writeDbCommandFixture(
      'generated-symlink-root',
    );
    const outside = mkdtempSync(join(dirname(root), '.tmp-kovo-db-generate-outside-'));
    roots.push(outside);
    rmSync(migrationsDir, { force: true, recursive: true });
    symlinkSync(outside, migrationsDir, 'dir');

    const generated = await captureWrites(() =>
      mainAsync([
        'db',
        'generate',
        '--schema',
        schemaPath,
        '--driver',
        'pglite',
        '--data-dir',
        dataDir,
        '--migrations',
        migrationsDir,
      ]),
    );

    expect(generated.result).toBe(1);
    expect(generated.stdout).toBe('');
    expect(generated.stderr).toMatch(/symbolic-link|symbolic link|cannot use/u);
    expect(readdirSync(outside)).toEqual([]);
  });

  it('does not execute migrations read through a symlinked migrations root', async () => {
    const { dataDir, migrationsDir, root, schemaPath } = writeDbCommandFixture(
      'migrate-symlink-root',
    );
    const outside = mkdtempSync(join(dirname(root), '.tmp-kovo-db-migrate-outside-'));
    roots.push(outside);
    writeFileSync(
      join(outside, '001_outside.sql'),
      'CREATE TABLE outside_symlink_migration (id text PRIMARY KEY);\n',
      'utf8',
    );
    rmSync(migrationsDir, { force: true, recursive: true });
    symlinkSync(outside, migrationsDir, 'dir');

    const migrated = await captureWrites(() =>
      mainAsync([
        'db',
        'migrate',
        '--schema',
        schemaPath,
        '--driver',
        'pglite',
        '--data-dir',
        dataDir,
        '--migrations',
        migrationsDir,
      ]),
    );

    expect(migrated.result).toBe(1);
    expect(migrated.stdout).toBe('');
    expect(migrated.stderr).not.toContain('MIGRATION status=applied');

    const { PGlite } = (await import(
      fileURLToPath(new URL('../../server/node_modules/@electric-sql/pglite', import.meta.url))
    )) as typeof import('@electric-sql/pglite');
    const db = new PGlite(dataDir);
    try {
      await expect(db.query('select * from outside_symlink_migration')).rejects.toThrow(
        /does not exist/u,
      );
    } finally {
      await db.close();
    }
  });

  it('prints usage for missing db actions', async () => {
    const output = await captureWrites(() => mainAsync(['db']));

    expect(output.result).toBe(1);
    expect(output.stdout).toBe('');
    expect(output.stderr).toContain('kovo: db requires provision, migrate, generate, or check.');
    expect(output.stderr).toContain('usage: kovo db provision|migrate|generate|check');
  });

  it('pins DB environment and relative paths before authored schema evaluation', () => {
    const { root, schemaPath } = writeDbCommandFixture('operator-authority');
    const outside = mkdtempSync(join(dirname(root), '.tmp-kovo-db-authority-outside-'));
    roots.push(outside);
    writeFileSync(
      schemaPath,
      [
        `process.chdir(${JSON.stringify(outside)});`,
        "Object.defineProperty(Object.prototype, 'KOVO_ADMIN_DATABASE_URL', {",
        "  configurable: true, value: 'postgres://attacker@127.0.0.1:2/attacker',",
        '});',
        readFileSync(schemaPath, 'utf8'),
      ].join('\n'),
      'utf8',
    );

    const env = { ...process.env };
    delete env.KOVO_ADMIN_DATABASE_URL;
    delete env.KOVO_DATABASE_URL;
    delete env.KOVO_DB_DRIVER;
    delete env.KOVO_RUNTIME_DATABASE_URL;
    const generated = runKovoDbCli(
      root,
      [
        'db',
        'generate',
        '--schema',
        './schema.ts',
        '--driver',
        'pglite',
        '--data-dir',
        './pglite',
        '--migrations',
        './migrations',
      ],
      env,
    );
    expect(generated.status, generated.stderr).toBe(0);
    expect(readdirSync(join(root, 'migrations')).some((name) => name.endsWith('.up.sql'))).toBe(
      true,
    );
    expect(existsSync(join(outside, 'migrations'))).toBe(false);
    expect(existsSync(join(outside, 'pglite'))).toBe(false);

    const checked = runKovoDbCli(
      root,
      ['db', 'check', '--schema', './schema.ts', '--data-dir', './pglite'],
      env,
    );
    expect(checked.status).toBe(1);
    expect(checked.stderr).toContain('DRIVER pglite');
    expect(checked.stderr).not.toContain('127.0.0.1:2');
  }, 120_000);

  function writeDbCommandFixture(name: string): {
    dataDir: string;
    migrationsDir: string;
    root: string;
    schemaPath: string;
  } {
    const root = mkdtempSync(
      join(dirname(fileURLToPath(import.meta.url)), `.tmp-kovo-db-${name}-`),
    );
    roots.push(root);
    const dataDir = join(root, 'pglite');
    const migrationsDir = join(root, 'migrations');
    mkdirSync(dataDir, { recursive: true });
    mkdirSync(migrationsDir, { recursive: true });
    mkdirSync(join(root, 'node_modules', '@kovojs'), { recursive: true });
    symlinkSync(
      fileURLToPath(new URL('../../server', import.meta.url)),
      join(root, 'node_modules', '@kovojs', 'server'),
    );
    symlinkSync(
      fileURLToPath(new URL('../node_modules/@kovojs/drizzle', import.meta.url)),
      join(root, 'node_modules', '@kovojs', 'drizzle'),
    );
    symlinkSync(
      fileURLToPath(new URL('../../server/node_modules/drizzle-orm', import.meta.url)),
      join(root, 'node_modules', 'drizzle-orm'),
    );
    const schemaPath = join(root, 'schema.ts');
    writeFileSync(
      schemaPath,
      [
        "import { kovo } from '@kovojs/drizzle';",
        "import { pgTable, text } from 'drizzle-orm/pg-core';",
        '',
        'export const notes = pgTable(',
        "  'kovo_cli_db_notes',",
        '  {',
        "    id: text('id').primaryKey(),",
        "    ownerId: text('ownerId').notNull(),",
        "    title: text('title').notNull(),",
        '  },',
        "  kovo({ domain: 'cli-notes', key: 'id', owner: 'ownerId' }),",
        ');',
        '',
      ].join('\n'),
      'utf8',
    );
    return { dataDir, migrationsDir, root, schemaPath };
  }
});

function runKovoDbCli(root: string, args: readonly string[], env: NodeJS.ProcessEnv) {
  return spawnSync(fileURLToPath(new URL('./bin.ts', import.meta.url)), args, {
    cwd: root,
    encoding: 'utf8',
    env,
  });
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

async function captureWrites(run: () => Promise<number>): Promise<{
  result: number;
  stderr: string;
  stdout: string;
}> {
  let stdout = '';
  let stderr = '';
  const stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk) => {
    stdout += chunk.toString();
    return true;
  }) as typeof process.stdout.write);
  const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(((chunk) => {
    stderr += chunk.toString();
    return true;
  }) as typeof process.stderr.write);

  try {
    return { result: await run(), stderr, stdout };
  } finally {
    stdoutWrite.mockRestore();
    stderrWrite.mockRestore();
  }
}
