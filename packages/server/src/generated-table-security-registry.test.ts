import { describe, expect, it } from 'vitest';
import { Table } from 'drizzle-orm';
import { text, sqliteTable } from 'drizzle-orm/sqlite-core';
import { kovo } from '@kovojs/drizzle';

import {
  extractCompilerBoundKovoRuntimeDbMetadata,
  installGeneratedTableSecurityManifestForCommand,
  registerGeneratedTableSecurityManifest,
} from './generated-table-security-registry.js';

describe('generated table-security registry', () => {
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
