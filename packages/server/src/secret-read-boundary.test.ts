import { describe, expect, it } from 'vitest';
import { isSecret, revealSecret } from '@kovojs/core';
import {
  createSecretBoxingReadDb,
  declareSecretReadCapability,
  type SecretReadMetadata,
  type SecretReadSqliteColumnOrigin,
} from './secret-read-boundary.js';

const secretColumn = { name: 'classified' };
const publicColumn = { name: 'label' };

function metadata(): SecretReadMetadata {
  return {
    allColumnKeys: new Set(['id', 'classified', 'label']),
    columnSources: new Map([
      [secretColumn, { column: 'classified', key: 'classified', secret: true, table: 'secrets' }],
      [publicColumn, { column: 'label', key: 'label', secret: false, table: 'secrets' }],
    ]),
    secretColumnKeys: new Set(['classified']),
    secretColumnNames: new Set(['classified']),
    secretColumnKeysByTable: new Map([['secrets', new Set(['classified'])]]),
    secretColumnNamesByTable: new Map([['secrets', new Set(['classified'])]]),
    secretTableNames: new Set(['secrets']),
  };
}

function originClient(origins: readonly SecretReadSqliteColumnOrigin[]) {
  return {
    prepare() {
      return { columns: () => origins };
    },
  };
}

function readDb(rows: readonly Record<string, unknown>[]) {
  return {
    all() {
      return rows;
    },
  };
}

function builderDb(query: object) {
  return {
    select() {
      return query;
    },
  };
}

function queryObject(
  sql: string,
  rows: readonly Record<string, unknown>[],
  selectedFields?: Record<string, unknown>,
) {
  return {
    selectedFields,
    then(onFulfilled?: (value: unknown) => unknown) {
      return Promise.resolve(onFulfilled?.(rows));
    },
    toSQL: () => ({ sql }),
  };
}

describe('secret read boundary', () => {
  it('boxes values whose concrete SQLite origin is a secret column', async () => {
    const db = createSecretBoxingReadDb(
      builderDb(
        queryObject('select classified as alias from secrets', [{ alias: 'runtime-secret-value' }]),
      ),
      metadata(),
      {
        sqliteColumnOrigins: originClient([
          { column: 'classified', name: 'alias', table: 'secrets' },
        ]),
      },
    );

    const [row] = await db.select();

    expect(isSecret(row.alias)).toBe(true);
    expect(revealSecret(row.alias, 'test')).toBe('runtime-secret-value');
  });

  it('serves proven non-secret projections from a secret table', async () => {
    const db = createSecretBoxingReadDb(
      builderDb(
        queryObject(
          'select upper(label) as publicLabel from secrets',
          [{ publicLabel: 'public label' }],
          {
            publicLabel: { queryChunks: [{ value: ['upper('] }, publicColumn, { value: [')'] }] },
          },
        ),
      ),
      metadata(),
      {
        sqliteColumnOrigins: originClient([{ column: null, name: 'publicLabel', table: null }]),
      },
    );

    const [row] = await db.select();

    expect(row.publicLabel).toBe('public label');
  });

  it('boxes opaque derived values when the SQL reads a secret table', async () => {
    const db = createSecretBoxingReadDb(
      builderDb(
        queryObject(
          'select substr(classified, 1, 7) as leaked from secrets',
          [{ leaked: 'runtime-secret-value' }],
          {
            leaked: { queryChunks: [{ value: ['substr('] }, secretColumn, { value: [')'] }] },
          },
        ),
      ),
      metadata(),
      {
        sqliteColumnOrigins: originClient([{ column: null, name: 'leaked', table: null }]),
      },
    );

    const [row] = await db.select();

    expect(isSecret(row.leaked)).toBe(true);
  });

  it('refuses raw secret-table reads without a declared capability', () => {
    const db = createSecretBoxingReadDb(
      readDb([{ classified: 'runtime-secret-value' }]),
      metadata(),
      {
        sqliteColumnOrigins: originClient([
          { column: 'classified', name: 'classified', table: 'secrets' },
        ]),
      },
    );

    expect(() => db.all('select classified from secrets')).toThrow(/KV435/);
  });

  it('boxes entire raw declared secret reads', () => {
    const db = createSecretBoxingReadDb(
      readDb([{ classified: 'runtime-secret-value' }]),
      metadata(),
      {
        sqliteColumnOrigins: originClient([
          { column: 'classified', name: 'classified', table: 'secrets' },
        ]),
      },
    );
    const statement = declareSecretReadCapability(
      { toSQL: () => ({ sql: 'select classified from secrets' }) },
      {
        columns: ['classified'],
        justification: 'test raw secret-read path',
        source: 'test',
        table: 'secrets',
      },
    );

    const [row] = db.all(statement);

    expect(isSecret(row)).toBe(true);
    expect(revealSecret(row, 'test')).toEqual({ classified: 'runtime-secret-value' });
  });
});
