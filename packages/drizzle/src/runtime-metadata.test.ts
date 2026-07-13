import { describe, expect, it } from 'vitest';
import { sql, Table } from 'drizzle-orm';
import { PgDialect, pgTable, text as pgText } from 'drizzle-orm/pg-core';
import { sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { kovo } from './runtime.js';
import {
  extractCompilerBoundKovoRuntimeDbMetadata,
  extractKovoRuntimeDbMetadata,
} from './runtime-metadata.js';

describe('runtime metadata extraction', () => {
  it('extracts secret and non-secret SQLite schema metadata from Drizzle tables', () => {
    const users = sqliteTable(
      'users',
      {
        id: text('id').primaryKey(),
        passwordHash: text('password_hash').notNull(),
        apiToken: text('api_token').notNull(),
        displayName: text('display_name').notNull(),
      },
      kovo({ domain: 'user', key: 'id', secret: ['passwordHash', (t) => t.apiToken] }),
    );

    const metadata = extractKovoRuntimeDbMetadata([users]);

    expect([...metadata.allColumnKeys]).toEqual(['id', 'passwordHash', 'apiToken', 'displayName']);
    expect([...metadata.secretTableNames]).toEqual(['users']);
    expect([...(metadata.secretColumnKeysByTable.get('users') ?? [])]).toEqual([
      'passwordHash',
      'apiToken',
    ]);
    expect([...(metadata.secretColumnNamesByTable.get('users') ?? [])]).toEqual([
      'password_hash',
      'api_token',
    ]);
    expect(metadata.columnSources.get(users.passwordHash)).toEqual({
      column: 'password_hash',
      key: 'passwordHash',
      secret: true,
      table: 'users',
    });
    expect(metadata.columnSources.get(users.displayName)).toEqual({
      column: 'display_name',
      key: 'displayName',
      secret: false,
      table: 'users',
    });
    expect([...(metadata.governedColumnKeysByTable.get('users') ?? [])]).toEqual([
      'id',
      'passwordHash',
    ]);
    expect([...(metadata.governedColumnNamesByTable.get('users') ?? [])]).toEqual([
      'id',
      'password_hash',
    ]);
  });

  it('does not accept structural table values as Kovo security annotations', () => {
    const users = sqliteTable(
      'users',
      {
        id: text('id').primaryKey(),
        passwordHash: text('password_hash').notNull(),
      },
      kovo({ domain: 'user', key: 'id', secret: ['passwordHash'] }),
    );
    Object.defineProperty(users, 'forgedAnnotation', {
      enumerable: true,
      value: { domain: 'public', public: true },
    });

    const metadata = extractKovoRuntimeDbMetadata([users]);

    expect([...metadata.secretTableNames]).toEqual(['users']);
    expect([...(metadata.secretColumnKeysByTable.get('users') ?? [])]).toEqual(['passwordHash']);
    expect(metadata.authorizationClassificationsByTable.get('users')).toBeUndefined();
  });

  it('does not let an unrelated witnessed kovo value shadow the Drizzle-owned callback', () => {
    const users = sqliteTable(
      'users',
      {
        id: text('id').primaryKey(),
        passwordHash: text('password_hash').notNull(),
      },
      kovo({ domain: 'user', key: 'id', secret: ['passwordHash'] }),
    );
    Object.defineProperty(users, 'unrelatedKovoAnnotation', {
      enumerable: true,
      value: kovo({ domain: 'public', public: true }),
    });

    const metadata = extractKovoRuntimeDbMetadata([users]);

    expect([...metadata.secretTableNames]).toEqual(['users']);
    expect([...(metadata.secretColumnKeysByTable.get('users') ?? [])]).toEqual(['passwordHash']);
    expect(metadata.authorizationClassificationsByTable.get('users')).toBeUndefined();
  });

  it('rejects late replacement of the exact Drizzle callback against compiler facts', () => {
    const users = sqliteTable(
      'users',
      {
        id: text('id').primaryKey(),
        passwordHash: text('password_hash').notNull(),
      },
      kovo({ domain: 'user', key: 'id', secret: ['passwordHash'] }),
    );
    const manifest = {
      tables: [
        {
          authorizationClassifications: [],
          columns: [
            { key: 'id', name: 'id' },
            { key: 'passwordHash', name: 'password_hash' },
          ],
          governedColumnKeys: ['id', 'passwordHash'],
          name: 'users',
          secretColumnKeys: ['passwordHash'],
          secretDeclared: true,
        },
      ],
    } as const;

    Object.defineProperty(users, Table.Symbol.ExtraConfigBuilder, {
      configurable: true,
      enumerable: true,
      value: Object.assign(() => [], { domain: 'public', public: true }),
      writable: true,
    });

    expect(() => extractCompilerBoundKovoRuntimeDbMetadata([users], manifest)).toThrow(
      /KV414: runtime Drizzle table security/u,
    );
  });

  it('rejects a permissive runtime SQL policy against the compiler-bound restrictive policy', () => {
    const shares = pgTable(
      'shares',
      {
        id: pgText('id').primaryKey(),
        ownerId: pgText('owner_id').notNull(),
      },
      kovo({ authzPolicy: sql.raw('TRUE'), domain: 'share', key: 'id' }),
    );
    const manifest = {
      tables: [
        {
          authzPolicy: {
            kind: 'sql',
            sql: "owner_id = current_setting('kovo.principal', true)",
          },
          authorizationClassifications: ['authzPolicy'],
          columns: [
            { key: 'id', name: 'id' },
            { key: 'ownerId', name: 'owner_id' },
          ],
          governedColumnKeys: ['id'],
          name: 'shares',
          secretColumnKeys: [],
          secretDeclared: false,
        },
      ],
    } as const;

    expect(() => extractCompilerBoundKovoRuntimeDbMetadata([shares], manifest)).toThrow(
      /KV414: runtime Drizzle table security/u,
    );
  });

  it('compares compiler-bound guard assertions as exact literal justifications', () => {
    const labels = sqliteTable(
      'labels',
      { id: text('id').primaryKey() },
      kovo({ authzPolicy: 'writes require the labels mutation guard', domain: 'label', key: 'id' }),
    );
    const manifest = {
      tables: [
        {
          authzPolicy: {
            justification: 'writes require an unrelated guard',
            kind: 'guard-assertion',
          },
          authorizationClassifications: ['authzPolicy'],
          columns: [{ key: 'id', name: 'id' }],
          governedColumnKeys: ['id'],
          name: 'labels',
          secretColumnKeys: [],
          secretDeclared: false,
        },
      ],
    } as const;

    expect(() => extractCompilerBoundKovoRuntimeDbMetadata([labels], manifest)).toThrow(
      /KV414: runtime Drizzle table security/u,
    );
  });

  it('snapshots matching compiler-bound SQL policy authority before callback replacement', () => {
    const predicate = "owner_id = current_setting('kovo.principal', true)";
    const shares = pgTable(
      'shares',
      {
        id: pgText('id').primaryKey(),
        ownerId: pgText('owner_id').notNull(),
      },
      kovo({ authzPolicy: sql.raw(predicate), domain: 'share', key: 'id' }),
    );
    const manifest = {
      tables: [
        {
          authzPolicy: { kind: 'sql', sql: predicate },
          authorizationClassifications: ['authzPolicy'],
          columns: [
            { key: 'id', name: 'id' },
            { key: 'ownerId', name: 'owner_id' },
          ],
          governedColumnKeys: ['id'],
          name: 'shares',
          secretColumnKeys: [],
          secretDeclared: false,
        },
      ],
    } as const;

    const metadata = extractCompilerBoundKovoRuntimeDbMetadata([shares], manifest);
    Object.defineProperty(shares, Table.Symbol.ExtraConfigBuilder, {
      configurable: true,
      enumerable: true,
      value: kovo({ authzPolicy: sql.raw('TRUE'), domain: 'share', key: 'id' }),
      writable: true,
    });

    expect(metadata.compilerBoundAuthzPoliciesByTable?.get('shares')).toEqual({
      kind: 'sql',
      sql: predicate,
    });
  });

  it('uses the boot-pinned Postgres renderer when comparing compiler-bound policy SQL', () => {
    const predicate = "owner_id = current_setting('kovo.principal', true)";
    const shares = pgTable(
      'shares',
      {
        id: pgText('id').primaryKey(),
        ownerId: pgText('owner_id').notNull(),
      },
      kovo({ authzPolicy: sql.raw(predicate), domain: 'share', key: 'id' }),
    );
    const manifest = {
      tables: [
        {
          authzPolicy: { kind: 'sql', sql: predicate },
          authorizationClassifications: ['authzPolicy'],
          columns: [
            { key: 'id', name: 'id' },
            { key: 'ownerId', name: 'owner_id' },
          ],
          governedColumnKeys: ['id'],
          name: 'shares',
          secretColumnKeys: [],
          secretDeclared: false,
        },
      ],
    } as const;
    const original = Object.getOwnPropertyDescriptor(PgDialect.prototype, 'sqlToQuery');
    Object.defineProperty(PgDialect.prototype, 'sqlToQuery', {
      configurable: true,
      value: () => ({ params: [], sql: 'TRUE' }),
      writable: true,
    });
    try {
      expect(
        extractCompilerBoundKovoRuntimeDbMetadata(
          [shares],
          manifest,
        ).compilerBoundAuthzPoliciesByTable?.get('shares'),
      ).toEqual({ kind: 'sql', sql: predicate });
    } finally {
      if (original !== undefined)
        Object.defineProperty(PgDialect.prototype, 'sqlToQuery', original);
    }
  });

  it('treats secret: true as a whole-table secret annotation', () => {
    const vault = sqliteTable(
      'vault',
      {
        id: text('id').primaryKey(),
        contents: text('contents').notNull(),
      },
      kovo({ domain: 'vault', key: 'id', secret: true }),
    );

    const metadata = extractKovoRuntimeDbMetadata([vault]);

    expect([...(metadata.secretColumnKeysByTable.get('vault') ?? [])]).toEqual(['id', 'contents']);
    expect([...(metadata.secretColumnNamesByTable.get('vault') ?? [])]).toEqual(['id', 'contents']);
  });

  it('extracts Postgres table metadata for PGlite runtime wiring', () => {
    const account = pgTable(
      'account',
      {
        id: pgText('id').primaryKey(),
        accessToken: pgText('accessToken'),
        providerId: pgText('providerId').notNull(),
      },
      kovo({
        domain: 'auth',
        key: 'id',
        secret: ['accessToken'],
      }),
    );

    const metadata = extractKovoRuntimeDbMetadata([account]);

    expect([...metadata.secretTableNames]).toEqual(['account']);
    expect([...(metadata.secretColumnKeysByTable.get('account') ?? [])]).toEqual(['accessToken']);
    expect([...(metadata.secretColumnNamesByTable.get('account') ?? [])]).toEqual(['accessToken']);
    expect(metadata.columnSources.get(account.accessToken)).toEqual({
      column: 'accessToken',
      key: 'accessToken',
      secret: true,
      table: 'account',
    });
    expect(metadata.columnSources.get(account.providerId)).toEqual({
      column: 'providerId',
      key: 'providerId',
      secret: false,
      table: 'account',
    });
  });

  it('extracts governed keys and physical names from selectors and column annotations', () => {
    const account = pgTable(
      'account',
      {
        id: pgText('id').primaryKey(),
        ownerId: pgText('owner_id').notNull(),
        passwordDigest: pgText('password_digest').notNull(),
        recoveryCode: pgText('recovery_code').notNull(),
        role: pgText('role').notNull(),
        displayName: pgText('display_name').notNull(),
      },
      kovo({
        confidentialAtRest: [(table) => table.recoveryCode],
        domain: 'account',
        governed: [(table) => table.role],
        key: (table) => table.id,
        owner: 'owner_id',
      }),
    );

    const metadata = extractKovoRuntimeDbMetadata([account]);

    expect([...(metadata.governedColumnKeysByTable.get('account') ?? [])]).toEqual([
      'id',
      'ownerId',
      'passwordDigest',
      'recoveryCode',
      'role',
    ]);
    expect([...(metadata.governedColumnNamesByTable.get('account') ?? [])]).toEqual([
      'id',
      'owner_id',
      'password_digest',
      'recovery_code',
      'role',
    ]);
    expect(metadata.authorizationClassificationsByTable.get('account')).toEqual(['owned']);
    expect(metadata.ownerSourcesByTable.get('account')).toEqual({
      columnKey: 'ownerId',
      columnName: 'owner_id',
      table: 'account',
    });
  });

  it('treats governed: true as a whole-table governed annotation', () => {
    const auditLog = sqliteTable(
      'audit_log',
      {
        id: text('id').primaryKey(),
        actorId: text('actor_id').notNull(),
        event: text('event').notNull(),
      },
      kovo({ domain: 'audit', governed: true, key: 'id' }),
    );

    const metadata = extractKovoRuntimeDbMetadata([auditLog]);

    expect([...(metadata.governedColumnKeysByTable.get('audit_log') ?? [])]).toEqual([
      'id',
      'actorId',
      'event',
    ]);
    expect([...(metadata.governedColumnNamesByTable.get('audit_log') ?? [])]).toEqual([
      'id',
      'actor_id',
      'event',
    ]);
  });

  it('extracts ownerVia and non-owner DEC-K classifications for runtime authorization', () => {
    const users = pgTable(
      'users',
      {
        id: pgText('id').primaryKey(),
      },
      kovo({ domain: 'user', key: 'id', reference: true }),
    );
    const orders = pgTable(
      'orders',
      {
        id: pgText('id').primaryKey(),
        userId: pgText('user_id').notNull(),
      },
      kovo({ domain: 'order', key: 'id', owner: 'userId' }),
    );
    const orderItems = pgTable(
      'order_items',
      {
        id: pgText('id').primaryKey(),
        orderId: pgText('order_id').notNull(),
      },
      kovo({
        domain: 'orderItem',
        key: 'id',
        ownerVia: { fk: (table) => table.orderId, parent: orders, parentKey: 'id' },
      }),
    );
    const posts = pgTable(
      'posts',
      {
        id: pgText('id').primaryKey(),
      },
      kovo({ domain: 'post', key: 'id', public: true }),
    );
    const shares = pgTable(
      'shares',
      {
        id: pgText('id').primaryKey(),
      },
      kovo({
        authzPolicy: sql`owner_id = current_setting('kovo.principal', true)`,
        domain: 'share',
        key: 'id',
      }),
    );

    const metadata = extractKovoRuntimeDbMetadata([users, orders, orderItems, posts, shares]);

    expect([...metadata.authorizationClassificationsByTable]).toEqual([
      ['users', ['reference']],
      ['orders', ['owned']],
      ['order_items', ['ownedVia']],
      ['posts', ['public']],
      ['shares', ['authzPolicy']],
    ]);
    expect([...metadata.schemaTableNames]).toEqual([
      'users',
      'orders',
      'order_items',
      'posts',
      'shares',
    ]);
    expect(metadata.ownerViaSourcesByTable.get('order_items')).toEqual({
      fkColumnKey: 'orderId',
      fkColumnName: 'order_id',
      parentKeyColumnKey: 'id',
      parentKeyColumnName: 'id',
      parentTable: 'orders',
      table: 'order_items',
    });
  });
});
