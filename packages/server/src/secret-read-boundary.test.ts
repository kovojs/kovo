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
const metricColumn = { name: 'amount' };

function metadata(): SecretReadMetadata {
  return {
    allColumnKeys: new Set(['id', 'classified', 'label', 'amount']),
    columnSources: new Map([
      [secretColumn, { column: 'classified', key: 'classified', secret: true, table: 'secrets' }],
      [publicColumn, { column: 'label', key: 'label', secret: false, table: 'secrets' }],
      [metricColumn, { column: 'amount', key: 'amount', secret: false, table: 'metrics' }],
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
    query() {
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
  it('pins declared secret metadata before application code can replace Set.has', () => {
    // SPEC §10.3/§11.2: the managed read boundary is the confidentiality choke. Application
    // code shares the server realm, so a late prototype replacement must not turn a declared
    // secret column into an ordinary scalar at that choke.
    const declared = metadata();
    const db = createSecretBoxingReadDb(
      {
        select() {
          return [{ classified: 'victim-secret' }];
        },
      },
      declared,
    );
    const nativeHas = Set.prototype.has;
    let rows: readonly Record<string, unknown>[];

    try {
      Set.prototype.has = function (value: unknown): boolean {
        if (this === declared.secretColumnKeys || this === declared.secretColumnNames) return false;
        return nativeHas.call(this, value);
      };
      rows = db.select();
    } finally {
      Set.prototype.has = nativeHas;
    }

    expect(isSecret(rows[0]!.classified)).toBe(true);
    expect(revealSecret(rows[0]!.classified, 'test')).toBe('victim-secret');
  });

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

  it('rejects raw expression chunks that hide a subquery read source', async () => {
    const db = createSecretBoxingReadDb(
      builderDb(
        queryObject(
          'select upper(label) || (select classified from secrets) as leaked from metrics',
          [{ leaked: 'runtime-secret-value' }],
          {
            leaked: {
              queryChunks: [
                { value: ['upper('] },
                publicColumn,
                { value: [') || (select classified from secrets)'] },
              ],
            },
          },
        ),
      ),
      metadata(),
      {
        sqliteColumnOrigins: originClient([{ column: null, name: 'leaked', table: null }]),
      },
    );

    await expect(async () => {
      await db.select();
    }).rejects.toThrow(/KV410[\s\S]*SELECT or FROM/);
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

  it('keeps derived secret expressions boxed after late Array.every substitution', async () => {
    // SPEC §6.6/§10.3: expression provenance is an authority decision. Walk the exact
    // framework snapshot by index; app-replaced collection callbacks cannot skip the source.
    const query = queryObject(
      'select max(classified) as leaked from secrets',
      [{ leaked: 'victim-secret' }],
      { leaked: { queryChunks: [{ value: ['max('] }, secretColumn, { value: [')'] }] } },
    );
    const db = createSecretBoxingReadDb(builderDb(query), metadata(), {
      sqliteColumnOrigins: originClient([{ column: null, name: 'leaked', table: null }]),
    });
    const nativeEvery = Array.prototype.every;
    let row: Record<string, unknown> | undefined;
    try {
      Array.prototype.every = function (): boolean {
        return true;
      };
      [row] = await db.select();
    } finally {
      Array.prototype.every = nativeEvery;
    }

    expect(isSecret(row?.leaked)).toBe(true);
    expect(revealSecret(row?.leaked, 'test')).toBe('victim-secret');
  });

  it('boxes compound selects before trusting a benign left-arm SQLite origin', async () => {
    const db = createSecretBoxingReadDb(
      builderDb(
        queryObject(
          'select id as value from users union all select classified as value from secrets',
          [{ value: 'runtime-secret-value' }],
        ),
      ),
      metadata(),
      {
        sqliteColumnOrigins: originClient([{ column: 'id', name: 'value', table: 'users' }]),
      },
    );

    const [row] = await db.select();

    expect(isSecret(row.value)).toBe(true);
    expect(revealSecret(row.value, 'test')).toBe('runtime-secret-value');
  });

  it('serves aggregates over non-secret tables when SQLite origin is opaque', async () => {
    const db = createSecretBoxingReadDb(
      builderDb(
        queryObject('select sum(amount) as total from metrics', [{ total: 42 }], {
          total: { queryChunks: [{ value: ['sum('] }, metricColumn, { value: [')'] }] },
        }),
      ),
      metadata(),
      {
        sqliteColumnOrigins: originClient([{ column: null, name: 'total', table: null }]),
      },
    );

    const [row] = await db.select();

    expect(row.total).toBe(42);
  });

  it('boxes aggregates over secret tables when SQLite origin is opaque', async () => {
    const db = createSecretBoxingReadDb(
      builderDb(
        queryObject('select max(classified) as topSecret from secrets', [{ topSecret: 'z' }], {
          topSecret: { queryChunks: [{ value: ['max('] }, secretColumn, { value: [')'] }] },
        }),
      ),
      metadata(),
      {
        sqliteColumnOrigins: originClient([{ column: null, name: 'topSecret', table: null }]),
      },
    );

    const [row] = await db.select();

    expect(isSecret(row.topSecret)).toBe(true);
    expect(revealSecret(row.topSecret, 'test')).toBe('z');
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

  it('does not let late RegExp replacement hide a direct secret-table read', () => {
    // SPEC §6.6 C13: this classifier retains the old closed verdict without dispatching
    // through application-replaceable RegExp controls.
    const db = createSecretBoxingReadDb(readDb([{ classified: 'victim-secret' }]), metadata(), {
      rawSecretTableRead: 'throw',
      sqliteColumnOrigins: originClient([{ column: null, name: 'classified', table: null }]),
    });
    const nativeTest = RegExp.prototype.test;
    let error: unknown;
    try {
      RegExp.prototype.test = function (): boolean {
        return false;
      };
      try {
        db.all({ sql: 'select classified from secrets', values: [] });
      } catch (caught) {
        error = caught;
      }
    } finally {
      RegExp.prototype.test = nativeTest;
    }
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('KV435');
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

  it('boxes rawRead results through the same direct read boundary', () => {
    const db = createSecretBoxingReadDb(
      {
        rawRead() {
          return [{ classified: 'runtime-secret-value' }];
        },
      },
      metadata(),
      {
        sqliteColumnOrigins: originClient([
          { column: 'classified', name: 'classified', table: 'secrets' },
        ]),
      },
    ) as { rawRead(statement: unknown, declaration: unknown): { classified: unknown }[] };
    const statement = declareSecretReadCapability(
      { toSQL: () => ({ sql: 'select classified from secrets' }) },
      {
        columns: ['classified'],
        justification: 'test rawRead secret-read path',
        source: 'test',
        table: 'secrets',
      },
    );

    const [row] = db.rawRead(statement, { reads: ['secrets'] });

    expect(isSecret(row)).toBe(true);
    expect(revealSecret(row, 'test')).toEqual({ classified: 'runtime-secret-value' });
  });

  it('lets engine-backed readers reject raw secret table reads before boxing', () => {
    const calls: string[] = [];
    const db = createSecretBoxingReadDb(
      {
        query(statement: unknown) {
          calls.push(`reader:${String(statement)}`);
          throw new Error('permission denied for table secrets');
        },
      },
      metadata(),
      { rawSecretTableRead: 'engine' },
    );

    expect(() => db.query('select classified from secrets')).toThrow(/permission denied/);
    expect(calls).toEqual(['reader:select classified from secrets']);
  });

  it('lets engine-backed readers serve raw public columns from secret-bearing tables', () => {
    const db = createSecretBoxingReadDb(
      {
        query() {
          return [{ label: 'public' }];
        },
      },
      metadata(),
      { rawSecretTableRead: 'engine' },
    );

    expect(db.query('select label from secrets')).toEqual([{ label: 'public' }]);
  });

  it('routes declared raw secret reads through the privileged handle and keeps rows boxed', () => {
    const calls: string[] = [];
    const reader = {
      query(statement: unknown) {
        calls.push(`reader:${String(statement)}`);
        throw new Error('permission denied for table secrets');
      },
    };
    const privilegedDb = {
      query() {
        calls.push('privileged');
        return [{ classified: 'runtime-secret-value' }];
      },
    };
    const db = createSecretBoxingReadDb(reader, metadata(), {
      privilegedDb,
      rawSecretTableRead: 'engine',
    });
    const statement = declareSecretReadCapability(
      { toSQL: () => ({ sql: 'select classified from secrets' }) },
      {
        columns: ['classified'],
        justification: 'test privileged secret-read path',
        source: 'test',
        table: 'secrets',
      },
    );

    const [row] = db.query(statement);

    expect(calls).toEqual(['privileged']);
    expect(isSecret(row)).toBe(true);
    expect(revealSecret(row, 'test')).toEqual({ classified: 'runtime-secret-value' });
  });

  it('boxes async privileged system-role secret reads before adapter serialization', async () => {
    const privilegedDb = {
      async query() {
        return [{ classified: 'async-runtime-secret-value' }];
      },
    };
    const db = createSecretBoxingReadDb(
      {
        query() {
          throw new Error('reader handle must not serve declared system-role secret read');
        },
      },
      metadata(),
      {
        privilegedDb,
        rawSecretTableRead: 'engine',
      },
    );
    const statement = declareSecretReadCapability(
      { toSQL: () => ({ sql: 'select classified from secrets' }) },
      {
        columns: ['classified'],
        justification: 'test async privileged system-role secret-read path',
        source: 'test',
        table: 'secrets',
      },
    );

    const [row] = await db.query(statement);

    expect(isSecret(row)).toBe(true);
    expect(revealSecret(row, 'test')).toEqual({ classified: 'async-runtime-secret-value' });
  });
});
