import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { mainAsync } from './index.js';

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
    expect(provision.stdout).toContain('STATUS ok\nSUMMARY issues=0\n');

    const check = await captureWrites(() =>
      mainAsync(['db', 'check', '--schema', schemaPath, '--data-dir', dataDir]),
    );

    expect(check.result).toBe(0);
    expect(check.stderr).toBe('');
    expect(check.stdout).toContain('kovo-db/v1\nACTION check\nDRIVER pglite\n');
    expect(check.stdout).toContain('STATUS ok\nSUMMARY issues=0\n');
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
    expect(check.stderr).toContain('ISSUE code=KV433_SCHEMA_FINGERPRINT');
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
    expect(migrate.stdout).toContain(
      'STATUS ok\nMIGRATION status=applied id="001_create_notes.sql"\nSUMMARY migrationsApplied=1 migrationsSkipped=0 issues=0\n',
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

  it('prints usage for missing db actions', async () => {
    const output = await captureWrites(() => mainAsync(['db']));

    expect(output.result).toBe(1);
    expect(output.stdout).toBe('');
    expect(output.stderr).toContain('kovo: db requires provision, migrate, or check.');
    expect(output.stderr).toContain('usage: kovo db provision|migrate|check');
  });

  function writeDbCommandFixture(name: string): {
    dataDir: string;
    migrationsDir: string;
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
    return { dataDir, migrationsDir, schemaPath };
  }
});

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
