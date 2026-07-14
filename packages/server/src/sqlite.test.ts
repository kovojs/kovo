import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';
import { kovo, sql, trustedSql } from '@kovojs/drizzle';
import { Table } from 'drizzle-orm';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import * as sqlitePublicApi from '@kovojs/server/sqlite';
import { useSqliteSystemDb } from '@kovojs/server/internal/sqlite-capability';
import { installGeneratedTableSecurityManifestForCommand } from './generated-table-security-registry.js';
import { resolveDbProvider } from './guards.js';
import { managedDb } from './managed-db.js';

const runtimes: Array<{ close(): void }> = [];
const sqliteTestRequire = createRequire(import.meta.url);

afterEach(() => {
  while (runtimes.length > 0) runtimes.pop()?.close();
  vi.restoreAllMocks();
});

describe('public SQLite runtime boundary (SPEC §6.6/§10.3)', () => {
  it('refuses production before inspecting authored options and boots in development', () => {
    const production = runSqlitePostureChild('production');
    expect(production.status, production.stderr).toBe(0);
    expect(JSON.parse(production.stdout)).toEqual({
      optionAccesses: 0,
      refusal: expect.stringContaining('must not boot in production'),
    });

    const development = runSqlitePostureChild('development');
    expect(development.status, development.stderr).toBe(0);
    expect(JSON.parse(development.stdout)).toEqual({ created: true });
  });

  it('keeps the main database and SQLite temporary storage in memory', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const schema = runtimeSchema(`kovo_memory_posture_${Date.now()}`);
    const release = installGeneratedTableSecurityManifestForCommand(schema.manifest);
    try {
      const runtime = sqlitePublicApi.createSqliteAppRuntime({
        tables: [schema.parent, schema.child],
      });
      runtimes.push(runtime);
      const capability = runtime.systemDb({
        operation: 'write',
        reason: 'Inspect the framework-owned SQLite storage posture',
        surface: 'sqlite.test#memory-posture',
      });
      const posture = useSqliteSystemDb(capability, (db) => ({
        databases: db.all<{ file: string; name: string }>(sql.raw('PRAGMA database_list')),
        tempStore: db.get<{ temp_store: number }>(sql.raw('PRAGMA temp_store')),
      }));
      expect(posture).toEqual({
        databases: [{ file: '', name: 'main', seq: 0 }],
        tempStore: { temp_store: 2 },
      });
    } finally {
      release();
    }
  });

  it('exposes only an opaque provider/capability and seeds exact non-enumerable own keys', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const schema = runtimeSchema('kovo_public_boundary');
    const release = installGeneratedTableSecurityManifestForCommand(schema.manifest);
    const row = {} as Record<string, string>;
    Object.defineProperty(row, 'id', { configurable: true, value: 'p1', writable: true });
    Object.defineProperty(row, 'name', {
      configurable: true,
      value: 'Pinned parent',
      writable: true,
    });
    try {
      const runtime = sqlitePublicApi.createSqliteAppRuntime({
        seed: [{ rows: [row], table: schema.parent }],
        tables: [schema.parent, schema.child],
      });
      runtimes.push(runtime);

      expect(typeof runtime.db).toBe('object');
      expect(Reflect.ownKeys(runtime.db)).toEqual([]);
      expect(Object.isFrozen(runtime.db)).toBe(true);
      expect(runtime.db).not.toHaveProperty('select');
      expect(sqlitePublicApi).not.toHaveProperty('createSqliteSystemDb');
      expect(sqlitePublicApi).not.toHaveProperty('useSqliteSystemDb');

      const capability = runtime.systemDb({
        operation: 'write',
        reason: 'Better Auth owns local session rows before request authentication',
        surface: 'sqlite.test#createBindings',
      });
      const rows = useSqliteSystemDb(capability, (db) =>
        db.select({ id: schema.parent.id, name: schema.parent.name }).from(schema.parent).all(),
      );
      expect(rows).toEqual([{ id: 'p1', name: 'Pinned parent' }]);
      expect(() =>
        useSqliteSystemDb({} as Parameters<typeof useSqliteSystemDb>[0], () => undefined),
      ).toThrow(/KV414/u);
      expect(() =>
        runtime.systemDb({
          // @ts-expect-error SQLite system capabilities are intentionally write-only.
          operation: 'read',
          reason: 'read-scoped authority would be dishonest for the unrestricted adapter handle',
          surface: 'sqlite.test#read-scope',
        }),
      ).toThrow(/operation must be write/u);
      expect(() =>
        runtime.systemDb({
          operation: 'write',
          reason: 'forged\nsecond audit row',
          surface: 'sqlite.test#forged',
        }),
      ).toThrow(/printable/u);
      expect(() =>
        runtime.systemDb({
          operation: 'write',
          reason: 'bounded audit reason',
          surface: `sqlite.test#${'x'.repeat(4_097)}`,
        }),
      ).toThrow(/at most 4096/u);
    } finally {
      release();
    }
  });

  it('rejects getters/proxies and aggregate budgets before native SQLite authority exists', () => {
    let getterHits = 0;
    const options = {} as sqlitePublicApi.KovoSqliteAppRuntimeOptions;
    Object.defineProperty(options, 'tables', {
      get() {
        getterHits += 1;
        return [];
      },
    });
    expect(() => sqlitePublicApi.createSqliteAppRuntime(options)).toThrow(/own-data/u);
    expect(getterHits).toBe(0);

    let proxyHits = 0;
    const proxy = new Proxy(
      { tables: [] },
      {
        ownKeys() {
          proxyHits += 1;
          return ['tables'];
        },
      },
    );
    expect(() =>
      sqlitePublicApi.createSqliteAppRuntime(proxy as sqlitePublicApi.KovoSqliteAppRuntimeOptions),
    ).toThrow(/Proxy/u);
    expect(proxyHits).toBe(0);

    expect(() =>
      sqlitePublicApi.createSqliteAppRuntime({
        tables: Array.from({ length: 257 }, () => ({})),
      }),
    ).toThrow(/no greater than 256/u);

    const schema = runtimeSchema('kovo_seed_budget');
    const release = installGeneratedTableSecurityManifestForCommand(schema.manifest);
    const before = sqliteRuntimeDirectories();
    try {
      const parentRow = { id: 'p1', name: 'Parent' };
      const childRow = { id: 'c1', parent_id: 'p1' };
      expect(() =>
        sqlitePublicApi.createSqliteAppRuntime({
          seed: [
            { rows: Array.from({ length: 6_000 }, () => parentRow), table: schema.parent },
            { rows: Array.from({ length: 6_000 }, () => childRow), table: schema.child },
          ],
          tables: [schema.parent, schema.child],
        }),
      ).toThrow(/at most 10000 rows/u);
      expect(sqliteRuntimeDirectories()).toEqual(before);
    } finally {
      release();
    }
  });

  it('runs compiler-bound metadata before authored foreign-key callbacks and filesystem setup', () => {
    const prefix = `kovo_fk_order_${Date.now()}`;
    const parent = sqliteTable(
      `${prefix}_parent`,
      { id: text('id').primaryKey() },
      kovo({ domain: `${prefix}_parent`, key: 'id' }),
    );
    let callbackHits = 0;
    const child = sqliteTable(
      `${prefix}_child`,
      {
        id: text('id').primaryKey(),
        parentId: text('parent_id').references(() => {
          callbackHits += 1;
          throw new Error('foreign-key callback sentinel');
        }),
      },
      kovo({ domain: `${prefix}_child`, key: 'id' }),
    );
    const manifest = manifestFor([
      { columns: [{ key: 'id', name: 'id' }], name: `${prefix}_parent` },
      {
        columns: [
          { key: 'id', name: 'id' },
          { key: 'parentId', name: 'parent_id' },
        ],
        name: `${prefix}_child`,
      },
    ]);
    const release = installGeneratedTableSecurityManifestForCommand(manifest);
    const before = sqliteRuntimeDirectories();
    try {
      expect(() => sqlitePublicApi.createSqliteAppRuntime({ tables: [parent, child] })).toThrow(
        /foreign-key callback sentinel/u,
      );
      expect(callbackHits).toBe(1);
      expect(sqliteRuntimeDirectories()).toEqual(before);
    } finally {
      release();
    }
  });

  it('rejects table and secret/non-secret column mutation from the later extra-config callback', () => {
    const mutations = ['table', 'public-column', 'secret-column'] as const;
    for (const mutation of mutations) {
      const prefix = `kovo_extra_mutation_${mutation.replaceAll('-', '_')}_${Date.now()}`;
      const table = sqliteTable(
        prefix,
        {
          id: text('id').primaryKey(),
          publicValue: text('public_value').notNull(),
          secretValue: text('secret_value').notNull(),
        },
        kovo({ domain: prefix, key: 'id', secret: ['secretValue'] }),
      );
      const original = table[Table.Symbol.ExtraConfigBuilder];
      expect(original).toBeTypeOf('function');
      let callbackHits = 0;
      const wrapper = Object.assign(
        (columns: Parameters<Exclude<typeof original, undefined>>[0]) => {
          callbackHits += 1;
          if (callbackHits === 2) {
            if (mutation === 'table') {
              Object.defineProperty(table, Table.Symbol.Name, {
                configurable: true,
                value: `${prefix}_changed`,
                writable: true,
              });
            } else {
              const column = mutation === 'public-column' ? table.publicValue : table.secretValue;
              Object.defineProperty(column, 'name', {
                configurable: true,
                value: `${mutation.replaceAll('-', '_')}_changed`,
                writable: true,
              });
            }
          }
          return original!(columns);
        },
        original,
      );
      Object.defineProperty(table, Table.Symbol.ExtraConfigBuilder, {
        ...Object.getOwnPropertyDescriptor(table, Table.Symbol.ExtraConfigBuilder),
        value: wrapper,
      });
      const release = installGeneratedTableSecurityManifestForCommand({
        tables: [
          {
            authorizationClassifications: [],
            columns: [
              { key: 'id', name: 'id' },
              { key: 'publicValue', name: 'public_value' },
              { key: 'secretValue', name: 'secret_value' },
            ],
            governedColumnKeys: ['id'],
            name: prefix,
            secretColumnKeys: ['secretValue'],
            secretDeclared: true,
          },
        ],
      });
      const before = sqliteRuntimeDirectories();
      try {
        expect(() => sqlitePublicApi.createSqliteAppRuntime({ tables: [table] })).toThrow(/KV414/u);
        expect(callbackHits).toBe(2);
        expect(sqliteRuntimeDirectories()).toEqual(before);
      } finally {
        release();
      }
    }
  });

  it('rejects parent table or column mutation from a late foreign-key callback', () => {
    const mutations = ['table', 'column'] as const;
    for (const mutation of mutations) {
      const prefix = `kovo_fk_mutation_${mutation}_${Date.now()}`;
      const parent = sqliteTable(
        `${prefix}_parent`,
        { id: text('id').primaryKey() },
        kovo({ domain: `${prefix}_parent`, key: 'id' }),
      );
      const child = sqliteTable(
        `${prefix}_child`,
        {
          id: text('id').primaryKey(),
          parentId: text('parent_id').references(() => {
            if (mutation === 'table') {
              Object.defineProperty(parent, Table.Symbol.Name, {
                configurable: true,
                value: `${prefix}_parent_changed`,
                writable: true,
              });
            } else {
              Object.defineProperty(parent.id, 'name', {
                configurable: true,
                value: 'id_changed',
                writable: true,
              });
            }
            return parent.id;
          }),
        },
        kovo({ domain: `${prefix}_child`, key: 'id' }),
      );
      const release = installGeneratedTableSecurityManifestForCommand(
        manifestFor([
          { columns: [{ key: 'id', name: 'id' }], name: `${prefix}_parent` },
          {
            columns: [
              { key: 'id', name: 'id' },
              { key: 'parentId', name: 'parent_id' },
            ],
            name: `${prefix}_child`,
          },
        ]),
      );
      const before = sqliteRuntimeDirectories();
      try {
        expect(() => sqlitePublicApi.createSqliteAppRuntime({ tables: [parent, child] })).toThrow(
          /KV414: SQLite table .* changed/u,
        );
        expect(sqliteRuntimeDirectories()).toEqual(before);
      } finally {
        release();
      }
    }
  });

  it('uses boot-captured Node builtin sinks after a foreign-key callback synchronizes poison', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const prefix = `kovo_builtin_poison_${Date.now()}`;
    const builtinFs = sqliteTestRequire('node:fs') as Record<PropertyKey, unknown>;
    const builtinOs = sqliteTestRequire('node:os') as Record<PropertyKey, unknown>;
    const builtinPath = sqliteTestRequire('node:path') as Record<PropertyKey, unknown>;
    const builtinSqlite = sqliteTestRequire('node:sqlite') as Record<PropertyKey, unknown>;
    const replacements: Array<
      readonly [Record<PropertyKey, unknown>, PropertyKey, PropertyDescriptor]
    > = [];
    const processDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'process');
    const originalProcess = globalThis.process;
    let poisonHits = 0;
    let poisoned = false;

    const poison = (label: string) => () => {
      poisonHits += 1;
      throw new Error(`synchronized builtin poison reached ${label}`);
    };
    const replace = (
      owner: Record<PropertyKey, unknown>,
      property: PropertyKey,
      value: unknown,
    ): void => {
      const descriptor = Object.getOwnPropertyDescriptor(owner, property);
      if (descriptor === undefined) throw new Error(`missing test builtin ${String(property)}`);
      replacements.push([owner, property, descriptor]);
      Object.defineProperty(owner, property, { ...descriptor, value });
    };
    const synchronizePoison = (): void => {
      if (poisoned) return;
      poisoned = true;
      replace(builtinFs, 'mkdtempSync', poison('fs.mkdtempSync'));
      replace(builtinFs, 'rmSync', poison('fs.rmSync'));
      replace(builtinOs, 'tmpdir', poison('os.tmpdir'));
      replace(builtinPath, 'join', poison('path.join'));
      replace(builtinSqlite, 'DatabaseSync', poison('sqlite.DatabaseSync'));
      replace(
        builtinSqlite,
        'constants',
        new Proxy(
          {},
          {
            get() {
              poisonHits += 1;
              throw new Error('synchronized builtin poison reached sqlite.constants');
            },
          },
        ),
      );
      const fakeProcess = new Proxy(originalProcess, {
        get(target, property) {
          if (property === 'once' || property === 'removeListener') {
            return poison(`process.${String(property)}`);
          }
          const value = Reflect.get(target, property, target);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
      Object.defineProperty(globalThis, 'process', {
        configurable: true,
        value: fakeProcess,
        writable: true,
      });
      syncBuiltinESMExports();
    };

    const parent = sqliteTable(
      `${prefix}_parent`,
      { id: text('id').primaryKey() },
      kovo({ domain: `${prefix}_parent`, key: 'id' }),
    );
    const child = sqliteTable(
      `${prefix}_child`,
      {
        id: text('id').primaryKey(),
        parentId: text('parent_id').references(() => {
          synchronizePoison();
          return parent.id;
        }),
      },
      kovo({ domain: `${prefix}_child`, key: 'id' }),
    );
    const release = installGeneratedTableSecurityManifestForCommand(
      manifestFor([
        { columns: [{ key: 'id', name: 'id' }], name: `${prefix}_parent` },
        {
          columns: [
            { key: 'id', name: 'id' },
            { key: 'parentId', name: 'parent_id' },
          ],
          name: `${prefix}_child`,
        },
      ]),
    );
    const before = sqliteRuntimeDirectories();
    let runtime: Readonly<sqlitePublicApi.KovoSqliteAppRuntime> | undefined;
    let rows: unknown;
    try {
      runtime = sqlitePublicApi.createSqliteAppRuntime({
        seed: [{ rows: [{ id: 'p1' }], table: parent }],
        tables: [parent, child],
      });
      const capability = runtime.systemDb({
        operation: 'write',
        reason: 'Exercise the synchronized-builtin declared-write authorizer regression',
        surface: 'sqlite.test#synchronized-builtin-writer',
      });
      rows = useSqliteSystemDb(capability, (db) => {
        const providerDb = resolveDbProvider(runtime!.db, new Request('http://localhost'));
        if (providerDb instanceof Promise) {
          throw new Error('SQLite provider unexpectedly resolved asynchronously.');
        }
        const writer = managedDb(providerDb, 'write', {
          sqlWritePolicy: {
            tables: [`public.${prefix}_parent`],
            touches: [`public.${prefix}_parent`],
          },
        });
        expect(() =>
          writer.run(
            trustedSql(sql.raw(`insert into "${prefix}_parent" (id) values ('p2')`), {
              justification: 'synchronized builtin SQLite authorizer regression',
            }),
          ),
        ).toThrow(/SQLite authorizer rejected/u);
        db.insert(parent).values({ id: 'p2' }).run();
        return db.select({ id: parent.id }).from(parent).orderBy(parent.id).all();
      });
      runtime.close();
      runtime = undefined;
    } finally {
      try {
        runtime?.close();
      } finally {
        for (let index = replacements.length - 1; index >= 0; index -= 1) {
          const [owner, property, descriptor] = replacements[index]!;
          Object.defineProperty(owner, property, descriptor);
        }
        if (processDescriptor !== undefined) {
          Object.defineProperty(globalThis, 'process', processDescriptor);
        }
        syncBuiltinESMExports();
        release();
      }
    }
    expect(poisoned).toBe(true);
    expect(poisonHits).toBe(0);
    expect(rows).toEqual([{ id: 'p1' }, { id: 'p2' }]);
    expect(sqliteRuntimeDirectories()).toEqual(before);
  });

  it('uses boot-captured collection/number/process operations after a late FK callback poison', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const prefix = `kovo_fk_poison_${Date.now()}`;
    const parent = sqliteTable(
      `${prefix}_parent`,
      { id: text('id').primaryKey() },
      kovo({ domain: `${prefix}_parent`, key: 'id' }),
    );
    const originals = [
      [Array.prototype, 'filter'],
      [Array.prototype, 'find'],
      [Array.prototype, 'join'],
      [Array.prototype, 'map'],
      [Array.prototype, 'sort'],
      [Number, 'isFinite'],
      [Object, 'keys'],
      [process, 'once'],
      [process, 'removeListener'],
    ].map(
      ([owner, property]) =>
        [owner, property, Object.getOwnPropertyDescriptor(owner, property)] as const,
    );
    let poisoned = false;
    const child = sqliteTable(
      `${prefix}_child`,
      {
        id: integer('id').primaryKey(),
        parentId: text('parent_id').references(() => {
          poisoned = true;
          for (const [owner, property] of originals) {
            Object.defineProperty(owner, property, {
              configurable: true,
              value: () => {
                throw new Error(`late poison reached ${String(property)}`);
              },
              writable: true,
            });
          }
          return parent.id;
        }),
      },
      kovo({ domain: `${prefix}_child`, key: 'id' }),
    );
    const release = installGeneratedTableSecurityManifestForCommand(
      manifestFor([
        { columns: [{ key: 'id', name: 'id' }], name: `${prefix}_parent` },
        {
          columns: [
            { key: 'id', name: 'id' },
            { key: 'parentId', name: 'parent_id' },
          ],
          name: `${prefix}_child`,
        },
      ]),
    );
    let runtime: Readonly<sqlitePublicApi.KovoSqliteAppRuntime> | undefined;
    try {
      runtime = sqlitePublicApi.createSqliteAppRuntime({ tables: [parent, child] });
    } finally {
      for (const [owner, property, descriptor] of originals) {
        if (descriptor !== undefined) Object.defineProperty(owner, property, descriptor);
      }
      release();
    }
    expect(poisoned).toBe(true);
    expect(runtime).toBeDefined();
    if (runtime !== undefined) runtimes.push(runtime);
  });

  it('pins the authorizer methods used for raw-read and declared-write enforcement', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const prefix = `kovo_fk_authorizer_${Date.now()}`;
    const parentName = `${prefix}_parent`;
    const childName = `${prefix}_child`;
    const builtinSqlite = sqliteTestRequire('node:sqlite') as {
      DatabaseSync: { prototype: Record<PropertyKey, unknown> };
    };
    const authorizerPrototype = builtinSqlite.DatabaseSync.prototype;
    const authorizerMethodDescriptors = (
      ['close', 'exec', 'prepare', 'setAuthorizer'] as const
    ).map((property) => {
      const descriptor = Object.getOwnPropertyDescriptor(authorizerPrototype, property);
      if (descriptor === undefined) {
        throw new Error(`node:sqlite DatabaseSync.prototype.${property} is unavailable`);
      }
      return [property, descriptor] as const;
    });
    let poisonHits = 0;
    let poisoned = false;
    const parent = sqliteTable(
      parentName,
      { id: text('id').primaryKey() },
      kovo({ domain: parentName, key: 'id' }),
    );
    const child = sqliteTable(
      childName,
      {
        id: text('id').primaryKey(),
        parentId: text('parent_id')
          .notNull()
          .references(
            () => {
              if (!poisoned) {
                poisoned = true;
                for (const [property, descriptor] of authorizerMethodDescriptors) {
                  Object.defineProperty(authorizerPrototype, property, {
                    ...descriptor,
                    value: () => {
                      poisonHits += 1;
                      if (property !== 'close' && property !== 'setAuthorizer') {
                        throw new Error(`late node:sqlite prototype poison reached ${property}`);
                      }
                    },
                  });
                }
              }
              return parent.id;
            },
            { onDelete: 'cascade' },
          ),
      },
      kovo({ domain: childName, key: 'id' }),
    );
    const release = installGeneratedTableSecurityManifestForCommand(
      manifestFor([
        { columns: [{ key: 'id', name: 'id' }], name: parentName },
        {
          columns: [
            { key: 'id', name: 'id' },
            { key: 'parentId', name: 'parent_id' },
          ],
          name: childName,
        },
      ]),
    );
    let runtime: Readonly<sqlitePublicApi.KovoSqliteAppRuntime> | undefined;
    let writeError: unknown;
    let readError: unknown;
    let childRows: unknown;
    try {
      runtime = sqlitePublicApi.createSqliteAppRuntime({
        seed: [
          { rows: [{ id: 'p1' }], table: parent },
          { rows: [{ id: 'c1', parent_id: 'p1' }], table: child },
        ],
        // Deliberately build the FK source before its target to exercise clone DDL ordering.
        tables: [child, parent],
      });
      runtimes.push(runtime);
      const providerDb = resolveDbProvider(runtime.db, new Request('http://localhost'));
      if (providerDb instanceof Promise) {
        throw new Error('SQLite provider unexpectedly resolved asynchronously.');
      }
      const writer = managedDb(providerDb, 'write', {
        sqlWritePolicy: {
          tables: [`main.${parentName}`, `public.${parentName}`],
          touches: [`main.${parentName}`],
        },
      });
      try {
        writer.run(
          trustedSql(sql.raw(`delete from "${parentName}" where id = 'p1'`), {
            justification: 'foreign-key cascade declared-write authorizer regression',
          }),
        );
      } catch (error) {
        writeError = error;
      }
      const rawRead = runtime.readonlyDb.rawRead as <Row>(
        statement: unknown,
        declaration: { reads: readonly string[] },
      ) => Row[];
      try {
        rawRead(
          trustedSql(sql.raw(`select id from "${childName}"`), {
            justification: 'poisoned SQLite raw-read authorizer regression',
          }),
          { reads: [`main.${parentName}`] },
        );
      } catch (error) {
        readError = error;
      }

      const capability = runtime.systemDb({
        operation: 'write',
        reason: 'Inspect the engine state after the rejected cascade regression',
        surface: 'sqlite.test#foreign-key-authorizer-parity',
      });
      childRows = useSqliteSystemDb(capability, (db) =>
        db.select({ id: child.id }).from(child).all(),
      );
    } finally {
      try {
        for (const [property, descriptor] of authorizerMethodDescriptors) {
          Object.defineProperty(authorizerPrototype, property, descriptor);
        }
      } finally {
        runtime?.close();
        release();
      }
    }
    expect(poisoned).toBe(true);
    expect(poisonHits).toBe(0);
    expect(writeError).toBeInstanceOf(Error);
    expect((writeError as Error).message).toMatch(/SQLite authorizer rejected/u);
    expect(readError).toBeInstanceOf(Error);
    expect((readError as Error).message).toMatch(/outside the declared reads set/u);
    expect(childRows).toEqual([{ id: 'c1' }]);
  });
});

function runtimeSchema(prefix: string) {
  const parentName = `${prefix}_parent`;
  const childName = `${prefix}_child`;
  const parent = sqliteTable(
    parentName,
    { id: text('id').primaryKey(), name: text('name').notNull() },
    kovo({ domain: parentName, key: 'id' }),
  );
  const child = sqliteTable(
    childName,
    {
      id: text('id').primaryKey(),
      parentId: text('parent_id')
        .notNull()
        .references(() => parent.id),
    },
    kovo({ domain: childName, key: 'id' }),
  );
  return {
    child,
    manifest: manifestFor([
      {
        columns: [
          { key: 'id', name: 'id' },
          { key: 'name', name: 'name' },
        ],
        name: parentName,
      },
      {
        columns: [
          { key: 'id', name: 'id' },
          { key: 'parentId', name: 'parent_id' },
        ],
        name: childName,
      },
    ]),
    parent,
  };
}

function manifestFor(
  tables: readonly {
    columns: readonly { key: string; name: string }[];
    name: string;
  }[],
) {
  return {
    tables: tables.map((table) => ({
      authorizationClassifications: [],
      columns: table.columns,
      governedColumnKeys: [table.columns[0]!.key],
      name: table.name,
      secretColumnKeys: [],
      secretDeclared: false,
    })),
  };
}

function sqliteRuntimeDirectories(): string[] {
  return readdirSync(tmpdir())
    .filter((entry) => entry.startsWith('kovo-sqlite-runtime-'))
    .sort();
}

function runSqlitePostureChild(posture: 'development' | 'production') {
  const sqliteUrl = pathToFileURL(fileURLToPath(new URL('./sqlite.ts', import.meta.url))).href;
  const kovoDrizzleUrl = pathToFileURL(
    fileURLToPath(new URL('../../drizzle/src/runtime.ts', import.meta.url)),
  ).href;
  const drizzleSqliteUrl = pathToFileURL(sqliteTestRequire.resolve('drizzle-orm/sqlite-core')).href;
  const source = `
import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && specifier.endsWith('.js') && context.parentURL) {
      const candidate = new URL(specifier.replace(/\\.js$/, '.ts'), context.parentURL);
      if (existsSync(candidate)) return nextResolve(candidate.href, context);
    }
    return nextResolve(specifier, context);
  },
});
const sqlite = await import(${JSON.stringify(sqliteUrl)});
if (process.env.NODE_ENV === 'production') {
  let optionAccesses = 0;
  const options = new Proxy({}, {
    get() { optionAccesses += 1; throw new Error('production inspected authored options'); },
    ownKeys() { optionAccesses += 1; throw new Error('production enumerated authored options'); },
  });
  try {
    sqlite.createSqliteAppRuntime(options);
    process.stdout.write(JSON.stringify({ admitted: true, optionAccesses }));
  } catch (error) {
    process.stdout.write(JSON.stringify({ refusal: String(error), optionAccesses }));
  }
} else {
  const { kovo } = await import(${JSON.stringify(kovoDrizzleUrl)});
  const { sqliteTable, text } = await import(${JSON.stringify(drizzleSqliteUrl)});
  const table = sqliteTable(
    'kovo_development_posture_proof',
    { id: text('id').primaryKey() },
    kovo({ domain: 'kovo_development_posture_proof', key: 'id' }),
  );
  const runtime = sqlite.createSqliteAppRuntime({ tables: [table] });
  runtime.close();
  process.stdout.write(JSON.stringify({ created: true }));
}
`;
  return spawnSync(
    process.execPath,
    [
      '--disable-warning=ExperimentalWarning',
      '--experimental-transform-types',
      '--input-type=module',
      '--eval',
      source,
    ],
    {
      cwd: fileURLToPath(new URL('../../..', import.meta.url)),
      encoding: 'utf8',
      env: { ...process.env, NODE_ENV: posture },
    },
  );
}
