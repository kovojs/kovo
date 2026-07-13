import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { sql, Table } from 'drizzle-orm';
import { pgTable, text as pgText } from 'drizzle-orm/pg-core';
import { text, sqliteTable } from 'drizzle-orm/sqlite-core';
import { kovo } from '@kovojs/drizzle';

import { actAsNonRequestPrincipal } from './auth-principal.js';
import {
  extractCompilerBoundKovoRuntimeDbMetadata,
  installGeneratedTableSecurityManifestForCommand,
  registerGeneratedTableSecurityManifest,
} from './generated-table-security-registry.js';
import { createPostgresAppRuntimeDb } from './postgres-runtime.js';

describe('generated table-security registry', () => {
  it('keeps the compiler policy authoritative after the live callback is replaced', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'kovo-compiler-authz-policy-'));
    const predicate = '"ownerId" = current_setting(\'kovo.principal\', true)';
    const shares = pgTable(
      'compiler_authz_shares',
      {
        id: pgText('id').primaryKey(),
        ownerId: pgText('ownerId').notNull(),
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
            { key: 'ownerId', name: 'ownerId' },
          ],
          governedColumnKeys: ['id'],
          name: 'compiler_authz_shares',
          secretColumnKeys: [],
          secretDeclared: false,
        },
      ],
    } as const;
    const originalAnnotation = shares[Table.Symbol.ExtraConfigBuilder];
    const release = installGeneratedTableSecurityManifestForCommand(manifest);
    let runtime: ReturnType<typeof createPostgresAppRuntimeDb> | undefined;

    try {
      runtime = createPostgresAppRuntimeDb({
        dataDir,
        driver: 'pglite',
        schema: { shares },
        seedSql: [
          'INSERT INTO compiler_authz_shares (id, "ownerId") VALUES ' +
            "('s1', 'u1'), ('s2', 'u2')",
        ],
      });
      Object.defineProperty(shares, Table.Symbol.ExtraConfigBuilder, {
        configurable: true,
        enumerable: true,
        value: kovo({ authzPolicy: sql.raw('TRUE'), domain: 'share', key: 'id' }),
        writable: true,
      });
      await runtime.ready;
      await expect(
        runtime
          .db({
            principalPosture: actAsNonRequestPrincipal('u1', {
              ingress: 'task',
              operation: 'read',
              surface: 'generated-table-security-registry mutation-after-snapshot regression',
            }),
          })
          .select({ id: shares.id })
          .from(shares)
          .orderBy(shares.id),
      ).resolves.toEqual([{ id: 's1' }]);
    } finally {
      Object.defineProperty(shares, Table.Symbol.ExtraConfigBuilder, {
        configurable: true,
        enumerable: true,
        value: originalAnnotation,
        writable: true,
      });
      try {
        if (runtime !== undefined) await runtime.close();
      } finally {
        release();
        rmSync(dataDir, { force: true, recursive: true });
      }
    }
  });

  it('rejects an authzPolicy classification without exact policy authority', () => {
    expect(() =>
      installGeneratedTableSecurityManifestForCommand({
        tables: [
          {
            authorizationClassifications: ['authzPolicy'],
            columns: [{ key: 'id', name: 'id' }],
            governedColumnKeys: ['id'],
            name: 'missing_policy',
            secretColumnKeys: [],
            secretDeclared: false,
          },
        ],
      }),
    ).toThrow(/authzPolicy must exactly match its classification/u);
  });

  it('binds runtime metadata to the first compiler manifest and rejects exact-slot replacement', () => {
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
    const users = sqliteTable(
      'users',
      {
        id: text('id').primaryKey(),
        passwordHash: text('password_hash').notNull(),
      },
      kovo({ domain: 'user', key: 'id', secret: ['passwordHash'] }),
    );

    const release = installGeneratedTableSecurityManifestForCommand(manifest);
    expect(extractCompilerBoundKovoRuntimeDbMetadata([users]).secretTableNames.has('users')).toBe(
      true,
    );
    registerGeneratedTableSecurityManifest(manifest);
    release();

    const originalAnnotation = users[Table.Symbol.ExtraConfigBuilder];
    Object.defineProperty(users, Table.Symbol.ExtraConfigBuilder, {
      configurable: true,
      enumerable: true,
      value: Object.assign(() => [], { domain: 'public', public: true }),
      writable: true,
    });
    expect(() => extractCompilerBoundKovoRuntimeDbMetadata([users])).toThrow(
      /KV414: runtime Drizzle table security/u,
    );
    Object.defineProperty(users, Table.Symbol.ExtraConfigBuilder, {
      configurable: true,
      enumerable: true,
      value: originalAnnotation,
      writable: true,
    });

    expect(registerGeneratedTableSecurityManifest(manifest)).toEqual(manifest);
    expect(extractCompilerBoundKovoRuntimeDbMetadata([users]).secretTableNames.has('users')).toBe(
      true,
    );

    Object.defineProperty(users, Table.Symbol.ExtraConfigBuilder, {
      configurable: true,
      enumerable: true,
      value: Object.assign(() => [], { domain: 'public', public: true }),
      writable: true,
    });

    expect(() => extractCompilerBoundKovoRuntimeDbMetadata([users])).toThrow(
      /KV414: runtime Drizzle table security/u,
    );
    expect(() =>
      registerGeneratedTableSecurityManifest({
        tables: [
          {
            ...manifest.tables[0],
            authorizationClassifications: ['public'],
            secretColumnKeys: [],
            secretDeclared: false,
          },
        ],
      }),
    ).toThrow(/already registered/u);
  });
});
