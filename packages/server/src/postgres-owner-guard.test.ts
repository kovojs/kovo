import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { kovo } from '@kovojs/drizzle';
import type { KovoRuntimeDbMetadata } from '@kovojs/drizzle/internal/runtime-metadata';
import { getTableColumns } from 'drizzle-orm';
import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { sqliteTable, text as sqliteText } from 'drizzle-orm/sqlite-core';
import { describe, expect, it } from 'vitest';

import {
  extractCompilerBoundKovoRuntimeDbMetadata,
  installGeneratedTableSecurityManifestForCommand,
} from './generated-table-security-registry.js';
import { guards, resolveLifecycleRequest } from './guards.js';
import { usePostgresSystemDb } from './internal/postgres-capability.js';
import { managedDb } from './managed-db.js';
import {
  registerFrameworkPostgresOwnerGuardDerivedRequestDb,
  registerFrameworkPostgresOwnerGuardRequestDb,
  registerFrameworkPostgresOwnerGuardSchema,
} from './postgres-owner-guard.js';
import { createPostgresAppRuntimeDb } from './postgres-runtime.js';
import {
  snapshotFrameworkNativeDrizzleOwnerGuardTableForExecution,
  snapshotFrameworkNativeDrizzleTableForExecution,
} from './sql-safe-handle.js';

const documents = pgTable(
  'owner_guard_documents',
  {
    id: text('document_id').primaryKey(),
    ownerId: text('owner_id').notNull(),
    title: text('title').notNull(),
    // Regression: Drizzle represents defaultNow() as native SQL metadata. The guard query does
    // not execute this unrelated column, so the C9 execution snapshot must not carry it.
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  kovo((columns) => ({ domain: 'document:tenant', key: columns.id, owner: columns.ownerId })),
);

const manifest = {
  tables: [
    {
      authorizationClassifications: ['owned'],
      columns: [
        { key: 'id', name: 'document_id' },
        { key: 'ownerId', name: 'owner_id' },
        { key: 'title', name: 'title' },
        { key: 'createdAt', name: 'created_at' },
      ],
      dialect: 'postgres',
      domain: 'document:tenant',
      governedColumnKeys: ['id', 'ownerId'],
      key: { columnKey: 'id', columnName: 'document_id', uniqueness: 'primary' },
      name: 'owner_guard_documents',
      owner: { columnKey: 'ownerId', columnName: 'owner_id' },
      secretColumnKeys: [],
      secretDeclared: false,
    },
  ],
} as const;

type OwnerRequest = {
  args: { id: string };
  db?: unknown;
  session?: { user?: { id?: string } } | null;
};

const ownerGuard = () =>
  guards.owns<OwnerRequest, OwnerRequest, string>((request) => request.args.id, documents.id, {
    resourceKey: 'args.id',
  });

describe('framework-derived Postgres owner guard', () => {
  it('reconstructs only the manifest-proven query identities and rejects mutable selected identities', () => {
    expect(() => snapshotFrameworkNativeDrizzleTableForExecution(documents)).toThrow(/KV422/u);
    const snapshot = snapshotFrameworkNativeDrizzleOwnerGuardTableForExecution(
      documents,
      'owner_guard_documents',
      undefined,
      documents.id,
      'id',
      'document_id',
      documents.ownerId,
      'ownerId',
      'owner_id',
    );
    expect(Object.keys(getTableColumns(snapshot.table as never))).toEqual(['id', 'ownerId']);
    expect(Object.hasOwn(snapshot.table, 'title')).toBe(false);
    expect(Object.hasOwn(snapshot.table, 'createdAt')).toBe(false);
    expect(Object.hasOwn(snapshot.keyColumn, 'default')).toBe(false);
    expect(Object.hasOwn(snapshot.ownerColumn, 'default')).toBe(false);
    expect(Object.isFrozen(snapshot.table)).toBe(true);
    expect(Object.isFrozen(snapshot.keyColumn)).toBe(true);
    expect(Object.isFrozen(snapshot.ownerColumn)).toBe(true);

    const accessorBacked = pgTable('owner_guard_accessor', {
      id: text('id').primaryKey(),
      ownerId: text('owner_id').notNull(),
    });
    Object.defineProperty(accessorBacked.id, 'name', {
      configurable: true,
      enumerable: true,
      get: () => 'id',
    });
    expect(() =>
      snapshotFrameworkNativeDrizzleOwnerGuardTableForExecution(
        accessorBacked,
        'owner_guard_accessor',
        undefined,
        accessorBacked.id,
        'id',
        'id',
        accessorBacked.ownerId,
        'ownerId',
        'owner_id',
      ),
    ).toThrow(/KV422/u);
  });

  it('preserves the exact reader execution registration when lifecycle composition also sees the writer', async () => {
    const release = installGeneratedTableSecurityManifestForCommand(manifest);
    const calls: string[] = [];
    try {
      const extracted = extractCompilerBoundKovoRuntimeDbMetadata([documents]);
      const metadata: KovoRuntimeDbMetadata = {
        ...extracted,
        columnSources: nativeMap(extracted.columnSources),
        keySourcesByTable: nativeMap(extracted.keySourcesByTable),
        ownerSourcesByTable: nativeMap(extracted.ownerSourcesByTable),
      };
      registerFrameworkPostgresOwnerGuardSchema(metadata, [documents]);

      const readerSource = {};
      const writerSource = {};
      const lifecycleDb = {};
      registerFrameworkPostgresOwnerGuardRequestDb(
        readerSource,
        metadata,
        { principal: 'alice' },
        {
          execute() {
            calls.push('reader');
            return [{ owner: 'alice' }];
          },
        },
      );
      registerFrameworkPostgresOwnerGuardRequestDb(
        writerSource,
        metadata,
        { principal: 'alice' },
        {
          execute() {
            calls.push('writer');
            return [];
          },
        },
      );

      registerFrameworkPostgresOwnerGuardDerivedRequestDb(lifecycleDb, readerSource);
      registerFrameworkPostgresOwnerGuardDerivedRequestDb(lifecycleDb, writerSource);

      await expect(
        ownerGuard()({
          args: { id: 'owned' },
          db: lifecycleDb,
          session: { user: { id: 'alice' } },
        }),
      ).resolves.toBe(true);
      expect(calls).toEqual(['reader']);
    } finally {
      release();
    }
  });

  it('rejects missing manifests, nonunique keys, SQLite, and ownerVia at construction', () => {
    expect(() => ownerGuard()).toThrow(/compiler-generated table-security manifest/u);

    const nonunique = pgTable(
      'nonunique_documents',
      { id: text('id').notNull(), ownerId: text('owner_id').notNull() },
      kovo((columns) => ({ domain: 'nonunique', key: columns.id, owner: columns.ownerId })),
    );
    const local = sqliteTable(
      'local_documents',
      { id: sqliteText('id').primaryKey(), ownerId: sqliteText('owner_id').notNull() },
      kovo((columns) => ({ domain: 'local', key: columns.id, owner: columns.ownerId })),
    );
    const accounts = pgTable(
      'owner_guard_accounts',
      { id: text('id').primaryKey(), ownerId: text('owner_id').notNull() },
      kovo((columns) => ({ domain: 'account', key: columns.id, owner: columns.ownerId })),
    );
    const entries = pgTable(
      'owner_guard_entries',
      { accountId: text('account_id').notNull(), id: text('id').primaryKey() },
      kovo((columns) => ({
        domain: 'entry',
        key: columns.id,
        ownerVia: { fk: columns.accountId, parent: accounts, parentKey: accounts.id },
      })),
    );
    const release = installGeneratedTableSecurityManifestForCommand({
      tables: [
        {
          authorizationClassifications: ['owned'],
          columns: [
            { key: 'id', name: 'id' },
            { key: 'ownerId', name: 'owner_id' },
          ],
          dialect: 'sqlite',
          domain: 'local',
          governedColumnKeys: ['id', 'ownerId'],
          key: { columnKey: 'id', columnName: 'id', uniqueness: 'primary' },
          name: 'local_documents',
          owner: { columnKey: 'ownerId', columnName: 'owner_id' },
          secretColumnKeys: [],
          secretDeclared: false,
        },
        {
          authorizationClassifications: ['owned'],
          columns: [
            { key: 'id', name: 'id' },
            { key: 'ownerId', name: 'owner_id' },
          ],
          dialect: 'postgres',
          domain: 'nonunique',
          governedColumnKeys: ['id', 'ownerId'],
          key: { columnKey: 'id', columnName: 'id', uniqueness: 'none' },
          name: 'nonunique_documents',
          owner: { columnKey: 'ownerId', columnName: 'owner_id' },
          secretColumnKeys: [],
          secretDeclared: false,
        },
        {
          authorizationClassifications: ['owned'],
          columns: [
            { key: 'id', name: 'id' },
            { key: 'ownerId', name: 'owner_id' },
          ],
          dialect: 'postgres',
          domain: 'account',
          governedColumnKeys: ['id', 'ownerId'],
          key: { columnKey: 'id', columnName: 'id', uniqueness: 'primary' },
          name: 'owner_guard_accounts',
          owner: { columnKey: 'ownerId', columnName: 'owner_id' },
          secretColumnKeys: [],
          secretDeclared: false,
        },
        {
          authorizationClassifications: ['ownedVia'],
          columns: [
            { key: 'accountId', name: 'account_id' },
            { key: 'id', name: 'id' },
          ],
          dialect: 'postgres',
          domain: 'entry',
          governedColumnKeys: ['id'],
          key: { columnKey: 'id', columnName: 'id', uniqueness: 'primary' },
          name: 'owner_guard_entries',
          ownerVia: {
            fkColumnKey: 'accountId',
            fkColumnName: 'account_id',
            parentKeyColumnKey: 'id',
            parentKeyColumnName: 'id',
            parentTable: 'owner_guard_accounts',
          },
          secretColumnKeys: [],
          secretDeclared: false,
        },
      ],
    });
    try {
      for (const keyColumn of [nonunique.id, local.id as never, entries.id]) {
        expect(() =>
          guards.owns<OwnerRequest, OwnerRequest, string>((request) => request.args.id, keyColumn),
        ).toThrow(/single-key direct-owner Postgres tables/u);
      }
    } finally {
      release();
    }
  });

  it('uses the exact managed write/read DB and rejects foreign, missing, mismatched, and system authority', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'kovo-owner-guard-'));
    const release = installGeneratedTableSecurityManifestForCommand(manifest);
    const guard = ownerGuard();
    const runtime = createPostgresAppRuntimeDb({
      dataDir,
      driver: 'pglite',
      schema: { documents },
      seedSql: [
        `INSERT INTO owner_guard_documents (document_id, owner_id, title) VALUES ('owned', 'alice', 'Alice'), ('foreign', 'bob', 'Bob')`,
      ],
    });
    try {
      await runtime.ready;
      const writeRequest = await requestFor(runtime, 'owned', 'alice', 'write');
      const readRequest = await requestFor(runtime, 'owned', 'alice', 'read');
      await expect(guard(writeRequest)).resolves.toBe(true);
      await expect(guard(readRequest)).resolves.toBe(true);

      const unregisteredWrapperRequest: OwnerRequest = {
        args: { id: 'owned' },
        db: managedDb(writeRequest.db, 'write'),
        session: { user: { id: 'alice' } },
      };
      await expect(guard(unregisteredWrapperRequest)).resolves.toEqual({
        kind: 'forbidden',
        payload: {},
      });

      const lookalikeDocuments = pgTable(
        'owner_guard_documents',
        {
          id: text('document_id').primaryKey(),
          ownerId: text('owner_id').notNull(),
          title: text('title').notNull(),
          createdAt: timestamp('created_at').notNull().defaultNow(),
        },
        kovo((columns) => ({
          domain: 'document:tenant',
          key: columns.id,
          owner: columns.ownerId,
        })),
      );
      const lookalikeGuard = guards.owns<OwnerRequest, OwnerRequest, string>(
        (request) => request.args.id,
        lookalikeDocuments.id,
      );
      await expect(lookalikeGuard(writeRequest)).resolves.toEqual({
        kind: 'forbidden',
        payload: {},
      });

      for (const mode of ['write', 'read'] as const) {
        await expect(guard(await requestFor(runtime, 'foreign', 'alice', mode))).resolves.toEqual({
          kind: 'forbidden',
          payload: {},
        });
        await expect(guard(await requestFor(runtime, 'missing', 'alice', mode))).resolves.toEqual({
          kind: 'forbidden',
          payload: {},
        });
      }

      const stolenDbRequest: OwnerRequest = {
        args: { id: 'owned' },
        db: writeRequest.db,
        session: { user: { id: 'bob' } },
      };
      await expect(guard(stolenDbRequest)).resolves.toEqual({
        kind: 'forbidden',
        payload: {},
      });

      const systemDb = usePostgresSystemDb(
        runtime.systemDb({
          operation: 'write',
          reason: 'owner-guard negative authority test',
          surface: 'postgres-owner-guard.test',
        }),
        (db) => db,
      );
      await expect(
        guard({
          args: { id: 'owned' },
          db: systemDb,
          session: { user: { id: 'alice' } },
        }),
      ).resolves.toEqual({ kind: 'forbidden', payload: {} });
    } finally {
      await runtime.close();
      release();
      rmSync(dataDir, { force: true, recursive: true });
    }
  }, 30_000);

  it('fails closed when the live single-column key constraint disappears', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'kovo-owner-guard-constraint-'));
    const release = installGeneratedTableSecurityManifestForCommand(manifest);
    const guard = ownerGuard();
    let runtime = createPostgresAppRuntimeDb({
      dataDir,
      driver: 'pglite',
      schema: { documents },
      seedSql: [
        `INSERT INTO owner_guard_documents (document_id, owner_id, title) VALUES ('shared', 'alice', 'Alice')`,
      ],
    });
    try {
      await runtime.ready;
      await expect(guard(await requestFor(runtime, 'shared', 'alice', 'write'))).resolves.toBe(
        true,
      );
      await runtime.close();

      const operator = new PGlite(dataDir);
      try {
        await operator.exec(
          'ALTER TABLE owner_guard_documents DROP CONSTRAINT owner_guard_documents_pkey',
        );
        await operator.exec(
          `INSERT INTO owner_guard_documents (document_id, owner_id, title) VALUES ('shared', 'bob', 'Bob')`,
        );
      } finally {
        await operator.close();
      }

      runtime = createPostgresAppRuntimeDb({
        dataDir,
        driver: 'pglite',
        postureCheck: {
          justification: 'Exercise the per-evaluation live key-constraint denial.',
          onBoot: false,
        },
        provisionOnBoot: false,
        schema: { documents },
      });
      await runtime.ready;
      await expect(guard(await requestFor(runtime, 'shared', 'alice', 'write'))).resolves.toEqual({
        kind: 'forbidden',
        payload: {},
      });
    } finally {
      await runtime.close();
      release();
      rmSync(dataDir, { force: true, recursive: true });
    }
  }, 30_000);
});

async function requestFor(
  runtime: ReturnType<typeof createPostgresAppRuntimeDb>,
  id: string,
  principal: string,
  dbMode: 'read' | 'write',
): Promise<OwnerRequest> {
  return resolveLifecycleRequest(
    { args: { id } },
    {
      db: runtime.db,
      dbMode,
      sessionProvider: () => ({ user: { id: principal } }),
    },
  );
}

function nativeMap<Key, Value>(source: ReadonlyMap<Key, Value>): Map<Key, Value> {
  const output = new Map<Key, Value>();
  source.forEach((value, key) => output.set(key, value));
  return output;
}
