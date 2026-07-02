import { describe, expect, it } from 'vitest';
import { sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { kovo } from './runtime.js';
import { extractKovoRuntimeDbMetadata } from './runtime-metadata.js';

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

    expect(metadata.allColumnKeys).toEqual(
      new Set(['id', 'passwordHash', 'apiToken', 'displayName']),
    );
    expect(metadata.secretTableNames).toEqual(new Set(['users']));
    expect(metadata.secretColumnKeysByTable.get('users')).toEqual(
      new Set(['passwordHash', 'apiToken']),
    );
    expect(metadata.secretColumnNamesByTable.get('users')).toEqual(
      new Set(['password_hash', 'api_token']),
    );
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

    expect(metadata.secretColumnKeysByTable.get('vault')).toEqual(new Set(['id', 'contents']));
    expect(metadata.secretColumnNamesByTable.get('vault')).toEqual(new Set(['id', 'contents']));
  });
});
