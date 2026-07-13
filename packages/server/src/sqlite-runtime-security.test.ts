import { describe, expect, it } from 'vitest';

import { createSqliteAppRuntimeDb, type KovoSqliteAppRuntimeOptions } from './sqlite-runtime.js';

describe('SQLite runtime authority snapshots', () => {
  it('rejects accessor-backed DB authority without invoking it', () => {
    const options = {
      metadata: {
        allColumnKeys: new Set<string>(),
        columnSources: new Map(),
        governedColumnKeysByTable: new Map(),
        governedColumnNamesByTable: new Map(),
        secretColumnKeys: new Set<string>(),
        secretColumnKeysByTable: new Map(),
        secretColumnNames: new Set<string>(),
        secretColumnNamesByTable: new Map(),
        secretTableNames: new Set<string>(),
      },
      normalizeTableName: (table: string) => table,
      sqliteAuthorizer: {},
      tableNames: () => [],
    } as Record<string, unknown>;
    let dbReads = 0;
    Object.defineProperty(options, 'db', {
      get() {
        dbReads += 1;
        return {};
      },
    });

    expect(() =>
      createSqliteAppRuntimeDb(
        options as unknown as KovoSqliteAppRuntimeOptions<Record<string, unknown>>,
      ),
    ).toThrow(/db must be an own data property/u);
    expect(dbReads).toBe(0);
  });
});
