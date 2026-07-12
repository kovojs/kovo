import { describe, expect, it } from 'vitest';
import { isSecret, revealSecret } from '@kovojs/core';
import { PGlite } from '@electric-sql/pglite';
import Database from 'better-sqlite3';
import { defineRelations, sql as drizzleSql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { drizzle as drizzlePostgres } from 'drizzle-orm/pglite';
import { pgTable, text as pgText } from 'drizzle-orm/pg-core';
import { sqliteTable, text } from 'drizzle-orm/sqlite-core';
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
    const rows = [{ publicLabel: 'public label' }];
    const db = createSecretBoxingReadDb(
      builderDb(
        queryObject(
          'select upper(label) as publicLabel from secrets',
          rows,
          {
            publicLabel: { queryChunks: [{ value: ['upper('] }, publicColumn, { value: [')'] }] },
          },
        ),
      ),
      metadata(),
      {
        executeSql: () => rows,
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

  it('keeps SQL word classification closed under inherited array index setters', async () => {
    const query = queryObject(
      'select max(classified) as leaked from secrets',
      [{ leaked: 'victim-secret' }],
      { leaked: { queryChunks: [{ value: ['max('] }, secretColumn, { value: [')'] }] } },
    );
    const db = createSecretBoxingReadDb(builderDb(query), metadata(), {
      sqliteColumnOrigins: originClient([{ column: null, name: 'leaked', table: null }]),
    });
    const prior = Object.getOwnPropertyDescriptor(Array.prototype, '0');
    let row: Record<string, unknown> | undefined;
    try {
      Object.defineProperty(Array.prototype, '0', {
        configurable: true,
        set(value: unknown) {
          if (typeof value === 'string') return;
          Object.defineProperty(this, '0', {
            configurable: true,
            enumerable: true,
            value,
            writable: true,
          });
        },
      });
      [row] = await db.select();
    } finally {
      if (prior === undefined) delete (Array.prototype as { 0?: unknown })[0];
      else Object.defineProperty(Array.prototype, '0', prior);
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
    const rows = [{ total: 42 }];
    const db = createSecretBoxingReadDb(
      builderDb(
        queryObject('select sum(amount) as total from metrics', rows, {
          total: { queryChunks: [{ value: ['sum('] }, metricColumn, { value: [')'] }] },
        }),
      ),
      metadata(),
      {
        executeSql: () => rows,
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

  it('executes the exact SQL carrier classified for an async builder', async () => {
    let toSqlCalls = 0;
    let originalThenReached = false;
    const query = {
      then(onFulfilled?: (value: unknown) => unknown) {
        originalThenReached = true;
        return Promise.resolve(onFulfilled?.([{ leaked: 'victim-secret' }]));
      },
      toSQL() {
        toSqlCalls += 1;
        return {
          sql:
            toSqlCalls === 1
              ? 'select label as leaked from public_data'
              : 'select classified as leaked from secrets',
        };
      },
    };
    const executed: string[] = [];
    const db = createSecretBoxingReadDb(builderDb(query), metadata(), {
      executeSql(statement) {
        executed.push(statement.text);
        return [{ leaked: 'public-label' }];
      },
      sqliteColumnOrigins: originClient([
        { column: 'label', name: 'leaked', table: 'public_data' },
      ]),
    });

    const [row] = await db.select();

    expect(row.leaked).toBe('public-label');
    expect(toSqlCalls).toBe(1);
    expect(originalThenReached).toBe(false);
    expect(executed).toEqual(['select label as leaked from public_data']);
  });

  it('pins the SQLite origin client before application mutation', async () => {
    const client = originClient([
      { column: 'classified', name: 'leaked', table: 'secrets' },
    ]);
    const rows = [{ leaked: 'victim-secret' }];
    const db = createSecretBoxingReadDb(
      builderDb(queryObject('select classified as leaked from secrets', rows)),
      metadata(),
      { executeSql: () => rows, sqliteColumnOrigins: client },
    );
    client.prepare = () => ({
      columns: () => [{ column: 'label', name: 'leaked', table: 'public_data' }],
    });

    const [row] = await db.select();

    expect(isSecret(row.leaked)).toBe(true);
    expect(revealSecret(row.leaked, 'test')).toBe('victim-secret');
  });

  it('boxes every derived value when no exact builder execution path exists', async () => {
    const db = createSecretBoxingReadDb(
      builderDb(
        queryObject('select max(classified) as leaked from secrets', [
          { leaked: 'victim-secret' },
        ]),
      ),
      metadata(),
    );

    const [row] = await db.select();

    expect(isSecret(row)).toBe(true);
    expect(revealSecret(row, 'test')).toEqual({ leaked: 'victim-secret' });
  });

  it('classifies and boxes a real synchronous SQLite all terminal', () => {
    const client = new Database(':memory:');
    try {
      client.exec(
        "create table secrets (classified text not null); insert into secrets values ('victim-secret')",
      );
      const secrets = sqliteTable('secrets', { classified: text('classified').notNull() });
      const db = createSecretBoxingReadDb(drizzle({ client }), metadata(), {
        sqliteColumnOrigins: client,
      });

      const [row] = db.select({ alias: secrets.classified }).from(secrets).all();

      expect(isSecret(row.alias)).toBe(true);
      expect(revealSecret(row.alias, 'test')).toBe('victim-secret');
    } finally {
      client.close();
    }
  });

  it('deep-boxes relational namespaces and parameter-bearing prepared terminals', async () => {
    const client = new Database(':memory:');
    try {
      client.exec(
        [
          'create table parents (id text primary key)',
          'create table secrets (id text primary key, parent_id text, classified text not null, label text not null)',
          "insert into parents values ('p1')",
          "insert into secrets values ('s1', 'p1', 'victim-secret', 'public-label')",
        ].join(';'),
      );
      const parents = sqliteTable('parents', { id: text('id').primaryKey() });
      const secrets = sqliteTable('secrets', {
        classified: text('classified').notNull(),
        id: text('id').primaryKey(),
        label: text('label').notNull(),
        parentId: text('parent_id').references(() => parents.id),
      });
      const relations = defineRelations({ parents, secrets }, (r) => ({
        parents: { secrets: r.many.secrets() },
        secrets: {
          parent: r.one.parents({ from: r.secrets.parentId, to: r.parents.id }),
        },
      }));
      const db = createSecretBoxingReadDb(drizzle({ client, relations }), metadata(), {
        sqliteColumnOrigins: client,
      });

      const [relational] = await db.query.secrets.findMany();
      expect(isSecret(relational.classified)).toBe(true);

      const publicOnly = await db.query.secrets.findFirst({
        columns: { classified: false, label: true },
      });
      expect(publicOnly?.label).toBe('public-label');
      expect(isSecret(publicOnly?.label)).toBe(false);

      const retainedConfig: {
        columns: { classified: boolean; label: boolean };
        extras?: Record<string, unknown>;
      } = { columns: { classified: false, label: true } };
      const pinnedPublicRead = db.query.secrets.findFirst(retainedConfig);
      retainedConfig.columns = { classified: true, label: false };
      retainedConfig.extras = {
        label: drizzleSql.raw('"d0"."classified"').as('label'),
      };
      const stillPublic = await pinnedPublicRead;
      expect(stillPublic?.label).toBe('public-label');
      expect(isSecret(stillPublic?.label)).toBe(false);

      const first = await db.query.secrets.findFirst({
        extras: {
          derived: drizzleSql.raw('"d0"."classified"').as('derived'),
        },
      });
      expect(isSecret(first?.derived)).toBe(true);

      const [parent] = await db.query.parents.findMany({ with: { secrets: true } });
      expect(isSecret(parent.secrets[0]!.classified)).toBe(true);

      const [synced] = db.query.secrets
        .findMany({
          extras: { derived: drizzleSql.raw('"d0"."classified"').as('derived') },
        })
        .sync({});
      expect(isSecret(synced.derived)).toBe(true);

      const preparedAll = db
        .select({ derived: secrets.classified })
        .from(secrets)
        .prepare()
        .all({});
      expect(isSecret(preparedAll[0]!.derived)).toBe(true);
      const preparedGet = db
        .select({ derived: secrets.classified })
        .from(secrets)
        .prepare()
        .get({});
      expect(isSecret(preparedGet?.derived)).toBe(true);
      const preparedValues = db
        .select({ derived: secrets.classified })
        .from(secrets)
        .prepare()
        .values({});
      expect(isSecret(preparedValues[0]![0])).toBe(true);
      const preparedExecute = await db
        .select({ derived: secrets.classified })
        .from(secrets)
        .prepare()
        .execute({});
      expect(Array.isArray(preparedExecute)).toBe(true);
      expect(isSecret(preparedExecute[0]!.derived)).toBe(true);
      const preparedRelationalPublic = await db.query.secrets
        .findMany({ columns: { classified: false, label: true } })
        .prepare()
        .execute({});
      expect(preparedRelationalPublic[0]!.label).toBe('public-label');
      expect(isSecret(preparedRelationalPublic[0]!.label)).toBe(false);
    } finally {
      client.close();
    }
  });

  it('preserves PGlite relational findFirst/findMany shape while boxing secret fields', async () => {
    const client = new PGlite();
    try {
      await client.exec(
        [
          'create table secrets (id text primary key, classified text not null, label text not null)',
          "insert into secrets values ('s1', 'victim-secret', 'public-label')",
        ].join(';'),
      );
      const secrets = pgTable('secrets', {
        classified: pgText('classified').notNull(),
        id: pgText('id').primaryKey(),
        label: pgText('label').notNull(),
      });
      const relations = defineRelations({ secrets }, () => ({}));
      const db = createSecretBoxingReadDb(
        drizzlePostgres({ client, relations }),
        metadata(),
      );

      const first = await db.query.secrets.findFirst();
      expect(Array.isArray(first)).toBe(false);
      expect(first?.label).toBe('public-label');
      expect(isSecret(first?.label)).toBe(false);
      expect(isSecret(first?.classified)).toBe(true);

      const many = await db.query.secrets.findMany();
      expect(Array.isArray(many)).toBe(true);
      expect(many[0]!.label).toBe('public-label');
      expect(isSecret(many[0]!.classified)).toBe(true);

      const preparedPublic = await db.query.secrets
        .findMany({ columns: { classified: false, label: true } })
        .prepare()
        .execute({});
      expect(preparedPublic[0]!.label).toBe('public-label');
      expect(isSecret(preparedPublic[0]!.label)).toBe(false);
    } finally {
      await client.close();
    }
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

  it('does not let a late Array iterator skip raw secret-read classification', () => {
    const statement = { sql: 'select classified from secrets', values: [] };
    const db = createSecretBoxingReadDb(readDb([{ classified: 'victim-secret' }]), metadata(), {
      rawSecretTableRead: 'throw',
      sqliteColumnOrigins: originClient([{ column: null, name: 'classified', table: null }]),
    });
    const nativeIterator = Array.prototype[Symbol.iterator];
    const empty: unknown[] = [];
    let error: unknown;
    try {
      Array.prototype[Symbol.iterator] = function (): ArrayIterator<unknown> {
        if (this.length === 1 && this[0] === statement) {
          return Reflect.apply(nativeIterator, empty, []) as ArrayIterator<unknown>;
        }
        return Reflect.apply(nativeIterator, this, []) as ArrayIterator<unknown>;
      };
      try {
        db.all(statement);
      } catch (caught) {
        error = caught;
      }
    } finally {
      Array.prototype[Symbol.iterator] = nativeIterator;
    }

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('KV435');
  });

  it('routes the exact classified SQL args through the secret-read sink', () => {
    const publicStatement = { sql: 'select label as classified from public_data', values: [] };
    const secretStatement = { sql: 'select classified from secrets', values: [] };
    const executed: unknown[] = [];
    const raw = {
      all(statement: unknown) {
        executed.push(statement);
        return statement === secretStatement
          ? [{ classified: 'victim-secret' }]
          : [{ classified: 'public-label' }];
      },
    };
    const db = createSecretBoxingReadDb(raw, metadata(), {
      sqliteColumnOrigins: originClient([
        { column: 'label', name: 'classified', table: 'public_data' },
      ]),
    });
    const nativeApply = Reflect.apply;
    let rows: unknown;
    try {
      Reflect.apply = function <Result>(
        target: Function,
        receiver: unknown,
        args: ArrayLike<unknown>,
      ) {
        if (target === raw.all && args[0] === publicStatement) {
          return nativeApply(target, receiver, [secretStatement]) as Result;
        }
        return nativeApply(target, receiver, args) as Result;
      };
      rows = db.all(publicStatement);
    } finally {
      Reflect.apply = nativeApply;
    }

    expect(rows).toEqual([{ classified: 'public-label' }]);
    expect(executed).toEqual([publicStatement]);
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

  it('keeps declared secret-read authority out of attacker carrier property traps', () => {
    let definitionAttempts = 0;
    const statement = new Proxy(
      { toSQL: () => ({ sql: 'select classified from secrets' }) },
      {
        defineProperty() {
          definitionAttempts += 1;
          return true;
        },
      },
    );
    declareSecretReadCapability(statement, {
      columns: ['classified'],
      justification: 'proxy carrier authority stays in framework storage',
      source: 'test',
      table: 'secrets',
    });
    const db = createSecretBoxingReadDb(
      readDb([{ classified: 'runtime-secret-value' }]),
      metadata(),
    );

    const [row] = db.all(statement);

    expect(definitionAttempts).toBe(0);
    expect(isSecret(row)).toBe(true);
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
