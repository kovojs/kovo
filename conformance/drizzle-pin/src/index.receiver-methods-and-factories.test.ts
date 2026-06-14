import { describe, expect, it } from 'vitest';

import { eq, gt, inArray, sql } from 'drizzle-orm';
import {
  alias,
  boolean,
  customType,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import * as pg from 'drizzle-orm/pg-core';

import {
  createTouchGraphEntry,
  diagnosticsForQueryFacts,
  diagnosticsForTouchGraph,
  extractQueryFactsFromProject,
  extractTouchGraphFromProject,
  jiso,
  serializeDomainRegistry,
  serializeTouchGraph,
} from '../../../packages/drizzle/src/static.js';

import { annotatedTable, drizzleSymbol } from './test-helpers.js';

describe('Drizzle pinned subset conformance', () => {
  it('pins real Drizzle materialized-view refresh as an explicit FW406 write surface', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/catalog.domain.ts',
          source: `
            import type { PgDatabase } from 'drizzle-orm/pg-core';
            import { pgMaterializedView, text } from 'drizzle-orm/pg-core';

            const productSearch = pgMaterializedView('product_search', { id: text('id') });

            export async function refreshCatalog(db: PgDatabase<any, any, any>) {
              await db.refreshMaterializedView(productSearch);
            }
          `,
        },
      ],
    });

    expect(graph).toEqual({
      refreshCatalog: {
        reads: [],
        touches: [],
        unresolved: [
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'conformance/drizzle-pin/src/catalog.domain.ts:8',
          },
        ],
      },
    });
  });

  it('pins real Drizzle count helper as an explicit FW406 surface', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/users.domain.ts',
          source: `
            import { eq } from 'drizzle-orm';
            import type { PgDatabase } from 'drizzle-orm/pg-core';
            import { boolean, pgTable, text } from 'drizzle-orm/pg-core';

            const users = pgTable('users', {
              active: boolean('active').notNull(),
              id: text('id').primaryKey(),
            }, jiso({ domain: 'user', key: 'id' }));

            export async function countActiveUsers(db: PgDatabase<any, any, any>) {
              return db.$count(users, eq(users.active, true));
            }
          `,
        },
      ],
    });

    expect(graph).toEqual({
      countActiveUsers: {
        reads: [],
        touches: [],
        unresolved: [
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'conformance/drizzle-pin/src/users.domain.ts:12',
          },
        ],
      },
    });
  });

  it('pins unknown real Drizzle receiver methods as explicit FW406 surfaces', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/users.domain.ts',
          source: `
            import type { PgDatabase } from 'drizzle-orm/pg-core';

            interface FakeDb {
              $with(name: string): unknown;
            }

            export async function configureUsers(db: PgDatabase<any, any, any>, fake: FakeDb) {
              db.$with('active_users');
              db['$with']('inactive_users');
              fake.$with('ignored_users');
            }
          `,
        },
      ],
    });

    expect(graph).toEqual({
      configureUsers: {
        reads: [],
        touches: [],
        unresolved: [
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'conformance/drizzle-pin/src/users.domain.ts:9',
          },
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'conformance/drizzle-pin/src/users.domain.ts:10',
          },
        ],
      },
    });
  });

  it('pins computed real Drizzle receiver methods as explicit FW406 surfaces', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/users.domain.ts',
          source: `
            import type { PgDatabase } from 'drizzle-orm/pg-core';

            type FakeDb = Record<string, (query: unknown) => Promise<void>>;

            export async function configureUsers(db: PgDatabase<any, any, any>, fake: FakeDb, method: string) {
              db[method]('active_users');
              fake[method]('ignored_users');
            }
          `,
        },
      ],
    });

    expect(graph).toEqual({
      configureUsers: {
        reads: [],
        touches: [],
        unresolved: [
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'conformance/drizzle-pin/src/users.domain.ts:7',
          },
        ],
      },
    });
  });

  it('pins bound real Drizzle receiver methods as explicit FW406 surfaces', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/users.domain.ts',
          source: `
            import type { PgDatabase } from 'drizzle-orm/pg-core';
            import { pgTable, text } from 'drizzle-orm/pg-core';

            export const users = pgTable('users', {
              id: text('id').primaryKey(),
            }, jiso({ domain: 'user', key: 'id' }));

            interface FakeDb {
              execute(query: unknown): Promise<void>;
              update(table: unknown): { set(value: unknown): Promise<void> };
            }

            export async function configureUsers(db: PgDatabase<any, any, any>, fake: FakeDb, method: string) {
              const execute = db.execute.bind(db);
              const write = db.update.bind(db);
              const computed = db[method].bind(db);
              const fakeExecute = fake.execute.bind(fake);
              await execute('select 1');
              await write(users).set({});
              await computed('select 1');
              await fakeExecute('select 1');
            }
          `,
        },
      ],
    });

    expect(graph).toEqual({
      configureUsers: {
        reads: [],
        touches: [],
        unresolved: [
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'conformance/drizzle-pin/src/users.domain.ts:19',
          },
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'conformance/drizzle-pin/src/users.domain.ts:20',
          },
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'conformance/drizzle-pin/src/users.domain.ts:21',
          },
        ],
      },
    });
  });

  it('pins assigned real Drizzle receiver methods as explicit FW406 surfaces', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/users.domain.ts',
          source: [
            "import type { PgDatabase } from 'drizzle-orm/pg-core';",
            "import { pgTable, text } from 'drizzle-orm/pg-core';",
            '',
            "export const users = pgTable('users', {",
            "  id: text('id').primaryKey(),",
            "}, jiso({ domain: 'user', key: 'id' }));",
            '',
            'interface FakeDb {',
            '  execute(query: unknown): Promise<void>;',
            '  update(table: unknown): { set(value: unknown): Promise<void> };',
            '}',
            '',
            'export async function configureUsers(db: PgDatabase<any, any, any>, fake: FakeDb, method: string) {',
            '  let execute;',
            '  execute = db.execute;',
            '  let write;',
            '  write = db.update;',
            '  let computed;',
            '  computed = db[method];',
            '  let fakeExecute;',
            '  fakeExecute = fake.execute;',
            '  let objectExecute;',
            '  ({ execute: objectExecute } = db);',
            '  const carrier = { db, fake };',
            '  const carrierExecute = carrier.db.execute;',
            '  let carrierComputed;',
            '  carrierComputed = carrier.db[method];',
            '  const carrierFakeExecute = carrier.fake.execute;',
            "  await execute('select 1');",
            '  await write(users).set({});',
            "  await computed('select 1');",
            "  await objectExecute('select 1');",
            "  await carrierExecute('select 1');",
            "  await carrierComputed('select 1');",
            "  await carrierFakeExecute('select 1');",
            "  await fakeExecute('select 1');",
            '}',
          ].join('\n'),
        },
      ],
    });

    expect(graph).toEqual({
      configureUsers: {
        reads: [],
        touches: [],
        unresolved: [
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'conformance/drizzle-pin/src/users.domain.ts:29',
          },
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'conformance/drizzle-pin/src/users.domain.ts:30',
          },
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'conformance/drizzle-pin/src/users.domain.ts:31',
          },
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'conformance/drizzle-pin/src/users.domain.ts:32',
          },
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'conformance/drizzle-pin/src/users.domain.ts:33',
          },
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'conformance/drizzle-pin/src/users.domain.ts:34',
          },
        ],
      },
    });
  });

  it('pins array-destructured real Drizzle receiver methods as explicit FW406 surfaces', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/users.domain.ts',
          source: [
            "import type { PgDatabase } from 'drizzle-orm/pg-core';",
            "import { pgTable, text } from 'drizzle-orm/pg-core';",
            '',
            "export const users = pgTable('users', {",
            "  id: text('id').primaryKey(),",
            "}, jiso({ domain: 'user', key: 'id' }));",
            '',
            'interface FakeDb {',
            '  execute(query: unknown): Promise<void>;',
            '  update(table: unknown): { set(value: unknown): Promise<void> };',
            '}',
            '',
            'export async function configureUsers(db: PgDatabase<any, any, any>, fake: FakeDb, method: string) {',
            '  const [execute, write, computed] = [db.execute, db.update, db[method]];',
            '  const [fakeExecute] = [fake.execute];',
            '  let assignedExecute;',
            '  [assignedExecute] = [db.execute];',
            "  await execute('select 1');",
            '  await write(users).set({});',
            "  await computed('select 1');",
            "  await assignedExecute('select 1');",
            "  await fakeExecute('select 1');",
            '}',
          ].join('\n'),
        },
      ],
    });

    expect(graph).toEqual({
      configureUsers: {
        reads: [],
        touches: [],
        unresolved: [
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'conformance/drizzle-pin/src/users.domain.ts:18',
          },
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'conformance/drizzle-pin/src/users.domain.ts:19',
          },
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'conformance/drizzle-pin/src/users.domain.ts:20',
          },
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'conformance/drizzle-pin/src/users.domain.ts:21',
          },
        ],
      },
    });
  });

  it('pins direct real Drizzle carrier member calls as exact facts with FW406 raw calls', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        {
          fileName: 'conformance/drizzle-pin/src/users.domain.ts',
          source: [
            "import type { PgDatabase } from 'drizzle-orm/pg-core';",
            "import { pgTable, text } from 'drizzle-orm/pg-core';",
            '',
            "export const users = pgTable('users', {",
            "  id: text('id').primaryKey(),",
            "}, jiso({ domain: 'user', key: 'id' }));",
            '',
            'interface FakeDb {',
            '  execute(query: unknown): Promise<void>;',
            '  query: any;',
            '  update(table: unknown): { set(value: unknown): Promise<void> };',
            '}',
            '',
            'export async function configureUsers(db: PgDatabase<any, any, any>, fake: FakeDb) {',
            '  const carrier = { db, fake };',
            "  await carrier.db.execute('select 1');",
            '  await carrier.db.update(users).set({});',
            '  await carrier.db.query.users.findMany();',
            "  await carrier.fake.execute('select 1');",
            '  await carrier.fake.update(users).set({});',
            '  await carrier.fake.query.users.findMany();',
            '  await audit({ db: carrier.db });',
            '  await audit({ db: carrier.fake });',
            '}',
          ].join('\n'),
        },
      ],
    });

    expect(graph).toEqual({
      configureUsers: {
        reads: [
          {
            domain: 'user',
            keys: null,
            site: 'conformance/drizzle-pin/src/users.domain.ts:18',
            source: 'relational-query',
            via: 'users',
          },
        ],
        touches: [
          {
            domain: 'user',
            keys: null,
            site: 'conformance/drizzle-pin/src/users.domain.ts:17',
            via: 'users',
          },
        ],
        unresolved: [
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'conformance/drizzle-pin/src/users.domain.ts:22',
          },
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'conformance/drizzle-pin/src/users.domain.ts:16',
          },
        ],
      },
    });
  });

  it('pins typed real Drizzle query/domain factories as FW406 when callbacks are invisible', () => {
    const files = [
      {
        fileName: 'conformance/drizzle-pin/src/users.domain.ts',
        source: [
          "import type { PgDatabase } from 'drizzle-orm/pg-core';",
          "import { pgTable, text } from 'drizzle-orm/pg-core';",
          '',
          "export const users = pgTable('users', {",
          "  id: text('id').primaryKey(),",
          "}, jiso({ domain: 'user', key: 'id' }));",
          '',
          'declare function makeActions(): { add: ReturnType<typeof write> };',
          'declare function makeQueryOptions(): {',
          '  load(input: unknown, db: PgDatabase<any, any, any>): Promise<void>;',
          '};',
          '',
          'export const userDomain = domain(makeActions());',
          '',
          "export const userQuery = query('user/factory-loader', makeQueryOptions());",
        ].join('\n'),
      },
    ];

    expect(extractTouchGraphFromProject({ files })).toEqual({
      'userDomain.<spread>': {
        reads: [],
        touches: [],
        unresolved: [
          {
            code: 'FW406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'conformance/drizzle-pin/src/users.domain.ts:13',
          },
        ],
      },
    });
    expect(extractQueryFactsFromProject({ files })).toEqual([
      {
        diagnostics: [
          {
            code: 'FW406',
            message:
              'Statically un-analyzable write site; manual touches required. Query load callback could not be statically resolved.',
            severity: 'warn',
            site: 'conformance/drizzle-pin/src/users.domain.ts:15',
          },
        ],
        query: 'user/factory-loader',
        reads: [],
        shape: {},
        site: 'conformance/drizzle-pin/src/users.domain.ts:15',
      },
    ]);
  });

  it('pins visible real Drizzle query/domain factories returning static objects', () => {
    const files = [
      {
        fileName: 'conformance/drizzle-pin/src/users.domain.ts',
        source: [
          "import { eq } from 'drizzle-orm';",
          "import type { PgDatabase } from 'drizzle-orm/pg-core';",
          "import { pgTable, text } from 'drizzle-orm/pg-core';",
          '',
          "export const users = pgTable('users', {",
          "  id: text('id').primaryKey(),",
          "  name: text('name').notNull(),",
          "}, jiso({ domain: 'user', key: 'id' }));",
          '',
          'function loadUsers(_input: unknown, db: PgDatabase<any, any, any>) {',
          '  return db.select({ id: users.id, name: users.name }).from(users);',
          '}',
          '',
          'function addUser(db: PgDatabase<any, any, any>, userId: string) {',
          '  return db.update(users).set({ name: userId }).where(eq(users.id, userId));',
          '}',
          '',
          'function makeOptions() {',
          '  return { load: loadUsers };',
          '}',
          '',
          'const makeActions = () => ({',
          '  add: write(addUser),',
          '});',
          '',
          'export const userDomain = domain(makeActions());',
          '',
          "export const userQuery = query('user/factory-return-loader', makeOptions());",
        ].join('\n'),
      },
    ];

    expect(extractTouchGraphFromProject({ files })).toEqual({
      'userDomain.add': {
        reads: [],
        touches: [
          {
            domain: 'user',
            keys: 'arg:userId',
            site: 'conformance/drizzle-pin/src/users.domain.ts:15',
            via: 'users',
          },
        ],
        unresolved: [],
      },
      addUser: {
        reads: [],
        touches: [
          {
            domain: 'user',
            keys: 'arg:userId',
            site: 'conformance/drizzle-pin/src/users.domain.ts:15',
            via: 'users',
          },
        ],
        unresolved: [],
      },
      loadUsers: {
        reads: [
          {
            domain: 'user',
            keys: null,
            site: 'conformance/drizzle-pin/src/users.domain.ts:11',
            source: 'select',
            via: 'users',
          },
        ],
        touches: [],
        unresolved: [],
      },
    });
    expect(extractQueryFactsFromProject({ files })).toEqual([
      {
        query: 'user/factory-return-loader',
        reads: ['user'],
        shape: {
          id: 'string',
          name: 'string',
        },
        site: 'conformance/drizzle-pin/src/users.domain.ts:28',
      },
    ]);
  });

  it('pins real Drizzle query/domain factories returning local static aliases', () => {
    const files = [
      {
        fileName: 'conformance/drizzle-pin/src/users.domain.ts',
        source: [
          "import { eq } from 'drizzle-orm';",
          "import type { PgDatabase } from 'drizzle-orm/pg-core';",
          "import { pgTable, text } from 'drizzle-orm/pg-core';",
          '',
          "export const users = pgTable('users', {",
          "  id: text('id').primaryKey(),",
          "  name: text('name').notNull(),",
          "}, jiso({ domain: 'user', key: 'id' }));",
          '',
          'function loadUsers(_input: unknown, db: PgDatabase<any, any, any>) {',
          '  return db.select({ id: users.id, name: users.name }).from(users);',
          '}',
          '',
          'function addUser(db: PgDatabase<any, any, any>, userId: string) {',
          '  return db.update(users).set({ name: userId }).where(eq(users.id, userId));',
          '}',
          '',
          'function makeOptions() {',
          '  const base = { load: loadUsers };',
          '  const options = { ...base };',
          '  return options;',
          '}',
          '',
          'function makeActions() {',
          '  const base = { add: write(addUser) };',
          '  const actions = { ...base };',
          '  return actions;',
          '}',
          '',
          'export const userDomain = domain(makeActions());',
          '',
          "export const userQuery = query('user/local-factory-return-loader', makeOptions());",
        ].join('\n'),
      },
    ];

    expect(extractTouchGraphFromProject({ files })).toEqual({
      'userDomain.add': {
        reads: [],
        touches: [
          {
            domain: 'user',
            keys: 'arg:userId',
            site: 'conformance/drizzle-pin/src/users.domain.ts:15',
            via: 'users',
          },
        ],
        unresolved: [],
      },
      addUser: {
        reads: [],
        touches: [
          {
            domain: 'user',
            keys: 'arg:userId',
            site: 'conformance/drizzle-pin/src/users.domain.ts:15',
            via: 'users',
          },
        ],
        unresolved: [],
      },
      loadUsers: {
        reads: [
          {
            domain: 'user',
            keys: null,
            site: 'conformance/drizzle-pin/src/users.domain.ts:11',
            source: 'select',
            via: 'users',
          },
        ],
        touches: [],
        unresolved: [],
      },
    });
    expect(extractQueryFactsFromProject({ files })).toEqual([
      {
        query: 'user/local-factory-return-loader',
        reads: ['user'],
        shape: {
          id: 'string',
          name: 'string',
        },
        site: 'conformance/drizzle-pin/src/users.domain.ts:32',
      },
    ]);
  });
});
