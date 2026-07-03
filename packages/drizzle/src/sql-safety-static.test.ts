import { describe, expect, it } from 'vitest';

import { analyzeSqlSafetyFromProject } from '@kovojs/drizzle/internal/static';

function diagnosticsFor(source: string) {
  return diagnosticsForFile('app.ts', source);
}

function diagnosticsForFile(fileName: string, source: string) {
  return analyzeSqlSafetyFromProject({
    files: [
      {
        fileName,
        source,
      },
    ],
  });
}

describe('@kovojs/drizzle SQL safety static analysis', () => {
  it('warns that SQLite owner-table annotations are advisory in the experimental runtime', () => {
    const diagnostics = diagnosticsFor(`
      import { kovo } from '@kovojs/drizzle';
      import { sqliteTable, text } from 'drizzle-orm/sqlite-core';

      export const orders = sqliteTable("orders", {
        id: text("id").primaryKey(),
        userId: text("user_id").notNull(),
      }, kovo({ domain: "order", key: "id", owner: "userId" }));

      export const orderItems = sqliteTable("order_items", {
        id: text("id").primaryKey(),
        orderId: text("order_id").notNull().references(() => orders.id),
      }, kovo({
        domain: "orderItem",
        key: "id",
        ownerVia: { parent: orders, fk: "orderId", parentKey: "id" },
      }));

      export const statuses = sqliteTable("statuses", {
        id: text("id").primaryKey(),
      }, kovo({ domain: "status", key: "id", reference: true }));
    `);

    expect(diagnostics).toHaveLength(2);
    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'KV447',
          message: expect.stringContaining('Table orders declares owner scoping'),
          severity: 'warn',
          site: 'app.ts:5',
        }),
        expect.objectContaining({
          code: 'KV447',
          message: expect.stringContaining('Table order_items declares ownerVia scoping'),
          severity: 'warn',
          site: 'app.ts:10',
        }),
      ]),
    );
  });

  it('flags raw driver imports in endpoint modules instead of the managed actAs db seam', () => {
    const diagnostics = diagnosticsFor(`
      import Database from 'better-sqlite3';
      import { endpoint } from '@kovojs/server';

      const raw = new Database(':memory:');
      void raw;

      export const status = endpoint('/status', {
        method: 'GET',
        reason: 'raw endpoint driver import proof',
        csrf: false,
        csrfJustification: 'read-only proof endpoint',
        response: { appOwnedSafety: true, body: 'text', cache: 'no-store' },
        handler: () => new Response('ok'),
      });
    `);

    expect(diagnostics).toEqual([
      expect.objectContaining({
        code: 'KV414',
        message: expect.stringContaining('endpoint({ db: true }) + ctx.actAs(id)'),
        site: 'app.ts:2',
      }),
    ]);
  });

  it('flags unconfined appRuntimeDbProvider calls in request-authored endpoint modules', () => {
    const diagnostics = diagnosticsFor(`
      import { endpoint } from '@kovojs/server';
      declare function appRuntimeDbProvider(request?: unknown): { execute(sql: string): unknown };

      export const leak = endpoint('/leak', {
        method: 'GET',
        reason: 'unconfined runtime db proof',
        csrf: false,
        csrfJustification: 'read-only proof endpoint',
        response: { appOwnedSafety: true, body: 'text', cache: 'no-store' },
        async handler() {
          await appRuntimeDbProvider().execute('select * from account');
          return new Response('ok');
        },
      });
    `);

    expect(diagnostics).toEqual([
      expect.objectContaining({
        code: 'KV414',
        message: expect.stringContaining(
          'must not call appRuntimeDbProvider() without a lifecycle request',
        ),
        site: 'app.ts:12',
      }),
    ]);
  });

  it('flags explicit undefined appRuntimeDbProvider calls in request-authored endpoint modules', () => {
    const diagnostics = diagnosticsFor(`
      import { endpoint } from '@kovojs/server';
      declare function appRuntimeDbProvider(request?: unknown): { execute(sql: string): unknown };

      export const leak = endpoint('/leak', {
        method: 'GET',
        reason: 'undefined runtime db proof',
        csrf: false,
        csrfJustification: 'read-only proof endpoint',
        response: { appOwnedSafety: true, body: 'text', cache: 'no-store' },
        async handler() {
          await appRuntimeDbProvider(undefined).execute('select * from account');
          return new Response('ok');
        },
      });
    `);

    expect(diagnostics).toEqual([
      expect.objectContaining({
        code: 'KV414',
        message: expect.stringContaining(
          'must not call appRuntimeDbProvider() without a lifecycle request',
        ),
        site: 'app.ts:12',
      }),
    ]);
  });

  it('flags value imports from generated runtime DB modules in request-authored surfaces', () => {
    const diagnostics = diagnosticsFor(`
      import { endpoint } from '@kovojs/server';
      import { appRuntimeDbProvider } from './_kovo/app-runtime-db.js';

      export const leak = endpoint('/leak', {
        method: 'GET',
        reason: 'runtime db value import proof',
        csrf: false,
        csrfJustification: 'read-only proof endpoint',
        response: { appOwnedSafety: true, body: 'text', cache: 'no-store' },
        handler: () => new Response(String(appRuntimeDbProvider)),
      });
    `);

    expect(diagnostics).toEqual([
      expect.objectContaining({
        code: 'KV414',
        message: expect.stringContaining(
          'must not import value symbols from src/_kovo/app-runtime-db',
        ),
        site: 'app.ts:3',
      }),
    ]);
  });

  it.each([
    'status.endpoint.ts',
    'status.webhook.ts',
    'orders.task.ts',
    'orders.query.ts',
    'orders.mutation.ts',
  ])('flags runtime DB value imports from request-authored %s modules', (fileName) => {
    const diagnostics = diagnosticsForFile(
      fileName,
      `
        import { appRuntimeDbProvider } from './_kovo/app-runtime-db.js';

        void appRuntimeDbProvider;
      `,
    );

    expect(diagnostics).toEqual([
      expect.objectContaining({
        code: 'KV414',
        message: expect.stringContaining(
          'must not import value symbols from src/_kovo/app-runtime-db',
        ),
        site: `${fileName}:2`,
      }),
    ]);
  });

  it('allows type-only runtime DB imports in request-authored surfaces', () => {
    const diagnostics = diagnosticsFor(`
      import { endpoint } from '@kovojs/server';
      import type { AppDb } from './_kovo/app-runtime-db.js';

      export const status = endpoint('/status', {
        method: 'GET',
        reason: 'type-only runtime db import proof',
        csrf: false,
        csrfJustification: 'read-only proof endpoint',
        response: { appOwnedSafety: true, body: 'text', cache: 'no-store' },
        handler: () => new Response('ok'),
      });

      export type EndpointDb = AppDb;
    `);

    expect(diagnostics).toEqual([]);
  });

  it('allows app entrypoint framework DB wiring outside request surface bodies', () => {
    const diagnostics = diagnosticsForFile(
      'src/app.tsx',
      `
        import { createApp, endpoint, publicAccess } from '@kovojs/server';
        import { appRuntimeDbProvider, appRuntimeDbReady } from './_kovo/app-runtime-db.js';
        import { contactsQuery } from './queries.js';
        import { addContact } from './mutations.js';

        await appRuntimeDbReady;

        const healthEndpoint = endpoint('/api/health', {
          access: publicAccess('public uptime probe'),
          auth: { justification: 'public uptime probe', kind: 'none' },
          csrf: false,
          csrfJustification: 'read-only machine health probe',
          handler: () => Response.json({ ok: true }),
          method: 'GET',
          reason: 'read-only machine health probe',
          response: { appOwnedSafety: true, body: 'json', cache: 'no-store' },
        });

        export default createApp({
          db: appRuntimeDbProvider,
          endpoints: [healthEndpoint],
          mutations: [addContact],
          queries: [contactsQuery],
          routes: [],
        });
      `,
    );

    expect(diagnostics).toEqual([]);
  });

  it('accepts endpoint db access through the explicit actAs managed handle', () => {
    const diagnostics = diagnosticsFor(`
      import { endpoint } from '@kovojs/server';

      export const status = endpoint('/status', {
        db: true,
        method: 'GET',
        reason: 'managed endpoint db proof',
        csrf: false,
        csrfJustification: 'read-only proof endpoint',
        response: { appOwnedSafety: true, body: 'text', cache: 'no-store' },
        async handler(_request, context) {
          const scoped = await context.actAs('user_1');
          void scoped.db.read;
          return new Response('ok');
        },
      });
    `);

    expect(diagnostics).toEqual([]);
  });

  it('flags request-derived raw SQL construction at managed sinks', () => {
    const diagnostics = diagnosticsFor(`
      export async function loadProducts(input: { id: string }, req: { search: Record<string, string>, params: Record<string, string> }, db: any) {
        await db.execute("select * from products where id = '" + input.id + "'");
        await db.query(\`select * from products order by \${req.search.sort} \${req.search.dir}\`);
        const status = "where status = '" + req.search.status + "'";
        await db.exec("select * from products " + status);
        await db.prepare("select * from products where q like '%" + req.search.q + "%'");
        await db.run("delete from products where id = '" + input.id + "'");
        await db.get("select * from products where id = '" + input.id + "'");
        await db.all("select * from products where status = '" + req.search.status + "'");
        await db.values("select id from products where q like '%" + req.search.q + "%'");
        const ids = req.search.ids.split(",");
        await db.execute("select * from products where id in (" + ids.join(",") + ")");
        await db.query("select * from " + req.params.table);
      }
    `);

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'KV422',
      'KV422',
      'KV422',
      'KV422',
      'KV422',
      'KV422',
      'KV422',
      'KV422',
      'KV422',
      'KV422',
    ]);
    expect(diagnostics.map((diagnostic) => diagnostic.message)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('execute() receives request-derived SQL text'),
        expect.stringContaining('query() receives request-derived SQL text'),
        expect.stringContaining('exec() receives request-derived SQL text'),
        expect.stringContaining('prepare() receives request-derived SQL text'),
        expect.stringContaining('run() receives request-derived SQL text'),
        expect.stringContaining('get() receives request-derived SQL text'),
        expect.stringContaining('all() receives request-derived SQL text'),
        expect.stringContaining('values() receives request-derived SQL text'),
      ]),
    );
  });

  it('exempts raw driver handles captured before the framework wraps them (SPEC §10.2 non-goal)', () => {
    // A driver client created with `new` (e.g. `new PGlite()`) is out of KV422 scope: SPEC §10.2
    // states KV422 "does not prove safety for driver handles captured before the framework wraps
    // them." A managed handle (req.db / a `drizzle(...)` result) is never `new`-constructed, so an
    // injection at one is still flagged — the exemption is narrow and cannot mask a managed sink.
    const diagnostics = diagnosticsFor(`
      import { PGlite } from '@electric-sql/pglite';
      import { drizzle } from 'drizzle-orm/pglite';
      const SCHEMA_DDL = ["create table t (id text)", "create table u (id text)"].join("\\n");
      export async function createDb(input: { id: string }) {
        const client = new PGlite();
        await client.exec(SCHEMA_DDL);
        await client.exec("insert into t values ('seed')");
        const db = drizzle({ client });
        await db.execute("select * from t where id = '" + input.id + "'");
        return db;
      }
    `);

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['KV422']);
    expect(diagnostics[0]?.message).toContain('execute() receives');
  });

  it('excludes obvious RegExp#exec calls while keeping managed db.exec as KV422', () => {
    const diagnostics = diagnosticsFor(`
      const schemePattern = /^[a-z][a-z0-9+.-]*:/i;
      export async function validateAndLoad(input: { href: string }, db: any) {
        const stripped = input.href.trim();
        const schemeMatch = schemePattern.exec(stripped);
        if (schemeMatch) {
          return schemeMatch[0];
        }
        await db.exec("select * from products where href = '" + input.href + "'");
      }
    `);

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['KV422']);
    expect(diagnostics[0]?.message).toContain('exec() receives request-derived SQL text');
    expect(diagnostics[0]?.site).toBe('app.ts:9');
  });

  it('excludes Kovo stream.query while keeping managed db.query as KV422', () => {
    const diagnostics = diagnosticsFor(`
      import { stream } from '@kovojs/server';
      export async function* assistant(input: { id: string }, db: any) {
        yield stream.query({ name: 'assistant', value: { id: input.id } });
        await db.query("select * from products where id = '" + input.id + "'");
      }
    `);

    expect(diagnostics).toMatchObject([
      {
        code: 'KV422',
        message: expect.stringContaining('query() receives request-derived SQL text'),
        site: 'app.ts:5',
      },
    ]);
  });

  it('flags unknown-provenance helpers, untagged templates, and unaudited raw helpers', () => {
    const diagnostics = diagnosticsFor(`
      import { sql } from '@kovojs/drizzle';
      const userClause = (input: { status: string }) => "where status = '" + input.status + "'";
      export async function report(input: { status: string }, db: any) {
        const statement = userClause(input);
        await db.execute(statement);
        await db.query(\`select * from reports where status = \${"open"}\`);
        await db.execute(sql.raw(input.status));
        await db.execute(sql.identifier(input.status));
      }
    `);

    expect(diagnostics.map(({ code }) => code)).toEqual([
      'KV422',
      'KV422',
      'KV422',
      'KV422',
      'KV422',
      'KV422',
    ]);
    expect(diagnostics.map(({ message }) => message)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('execute() receives unknown-provenance SQL text'),
        expect.stringContaining('query() receives request-derived SQL text'),
        expect.stringContaining('sql.raw(...) receives request-derived text'),
        expect.stringContaining('sql.identifier(...) receives request-derived text'),
      ]),
    );
  });

  it('uses symbol provenance for destructured request values in SQL text', () => {
    const diagnostics = diagnosticsFor(`
      import { sql } from '@kovojs/drizzle';
      export async function report(
        input: { clause: string },
        req: { search: { sort: string } },
        db: any
      ) {
        const { sort } = req.search;
        const { clause } = input;
        await db.execute("select * from products order by " + sort);
        await db.execute(sql.raw(clause));
      }
    `);

    expect(diagnostics.map(({ message }) => message)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('execute() receives request-derived SQL text'),
        expect.stringContaining('sql.raw(...) receives request-derived text'),
      ]),
    );
  });

  it('allows branded tags, separated parameter carriers, and allowlisted identifiers', () => {
    const diagnostics = diagnosticsFor(`
      import { sql, staticSql, trustedSql } from '@kovojs/drizzle';
      export async function loadProducts(input: { id: string, sort: string, dir: string }, db: any) {
        await db.select().from(products).where(eq(products.id, input.id));
        await db.execute(sql\`select * from products where id = \${input.id}\`);
        await db.query(staticSql\`select * from products\`);
        await db.exec({ text: "select * from products where id = $1", values: [input.id] });
        await db.prepare(staticSql\`select * from products where id = $1\`);
        await db.execute(sql.identifier(input.sort, { allow: ["name", "created_at"] }));
        await db.execute(sql.allow(input.dir, ["asc", "desc"]));
        await db.execute(trustedSql(sql.raw("where archived = false"), { justification: "static report clause" }));
      }
    `);

    expect(diagnostics).toEqual([]);
  });

  it('accepts aliased and namespace-imported Kovo sql tags while still flagging raw helpers', () => {
    const diagnostics = diagnosticsFor(`
      import { sql as sqlTag, staticSql as ddl } from '@kovojs/drizzle';
      import * as kovoDrizzle from '@kovojs/drizzle';
      export async function loadProducts(input: { id: string, sort: string }, db: any) {
        await db.execute(sqlTag\`select * from products where id = \${input.id}\`);
        await db.query(ddl\`select * from products\`);
        await db.prepare(kovoDrizzle.staticSql\`select * from products where id = $1\`);
        await db.execute(kovoDrizzle.sql\`select * from products where id = \${input.id}\`);
        await db.execute(sqlTag.raw(input.sort));
      }
    `);

    expect(diagnostics.map(({ site }) => site)).toEqual(['app.ts:9', 'app.ts:9']);
    expect(diagnostics.map(({ message }) => message)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('execute() receives unknown-provenance SQL text'),
        expect.stringContaining('sql.raw(...) receives request-derived text'),
      ]),
    );
  });

  it('rejects request-controlled SQL allowlists and joined request-derived SQL parts', () => {
    const diagnostics = diagnosticsFor(`
      import { sql } from '@kovojs/drizzle';
      export async function report(input: { sort: string, dir: string, clause: string }, db: any) {
        await db.execute(sql.identifier(input.sort, { allow: [input.sort] }));
        await db.execute(sql.allow(input.dir, [input.dir]));
        await db.execute(sql.join([sql.raw("where active = true"), input.clause], sql.raw(" ")));
      }
    `);

    expect(diagnostics.map(({ code }) => code)).toEqual(
      expect.arrayContaining(['KV422', 'KV422', 'KV422']),
    );
    expect(diagnostics.map(({ message }) => message)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('sql.identifier(...) receives request-derived text'),
        expect.stringContaining('execute() receives request-derived SQL text'),
      ]),
    );
  });

  it('allows sql.join only when every part is statically safe', () => {
    const diagnostics = diagnosticsFor(`
      import { sql } from '@kovojs/drizzle';
      export async function report(input: { sort: string, dir: string }, db: any) {
        await db.execute(sql.join([
          sql.identifier(input.sort, { allow: ["name", "created_at"] }),
          sql.allow(input.dir, ["asc", "desc"])
        ], sql.raw(" ")));
      }
    `);

    expect(diagnostics).toEqual([]);
  });

  it('keeps trustedSql auditable by flagging dynamic executable raw chunks', () => {
    expect(
      diagnosticsFor(`
        import { sql, trustedSql } from '@kovojs/drizzle';
        export async function report(input: { clause: string }, db: any) {
          await db.execute(trustedSql(sql.raw(input.clause), { justification: "reviewed dynamic report clause" }));
          await db.execute(trustedSql(sql\`where status = \${input.clause}\`, { justification: "parameterized report clause" }));
        }
      `),
    ).toMatchObject([
      {
        code: 'KV422',
        message: expect.stringContaining('sql.raw(...) receives request-derived text'),
      },
    ]);
  });

  it('does not let a local trustedSql shadow waive SQL text safety', () => {
    expect(
      diagnosticsFor(`
        function trustedSql<T>(value: T, _options: { justification: string }): T { return value; }
        export async function report(input: { clause: string }, db: any) {
          await db.execute(trustedSql("select * from reports where " + input.clause, { justification: "fake local wrapper" }));
        }
      `),
    ).toMatchObject([
      {
        code: 'KV422',
        message: expect.stringContaining('execute() receives unknown-provenance SQL text'),
      },
    ]);
  });

  it('flags raw string literals on managed handles so staticSql is the visible literal path', () => {
    expect(
      diagnosticsFor(`
        export async function migrate(db: any) {
          await db.exec("create table cart_items (id text primary key)");
        }
      `),
    ).toMatchObject([
      {
        code: 'KV422',
        message: expect.stringContaining('unbranded literal'),
      },
    ]);
  });

  it('flags raw string literals across pglite, SQLite, and computed SQL sinks', () => {
    const diagnostics = diagnosticsFor(`
      export async function migrate(input: { method: string }, db: any) {
        await db.execute("delete from orders");
        await db.run("delete from orders");
        await db.get("delete from orders returning id");
        await db.all("delete from orders returning id");
        await db.values("delete from orders returning id");
        await db.futureStatement("delete from orders");
        await db[input.method]("delete from orders");
        await db.insert(orders).values({ id: input.method });
      }
    `);

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'KV422',
      'KV422',
      'KV422',
      'KV422',
      'KV422',
      'KV422',
      'KV422',
    ]);
    expect(diagnostics.map((diagnostic) => diagnostic.message)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('execute() receives unbranded literal SQL text'),
        expect.stringContaining('run() receives unbranded literal SQL text'),
        expect.stringContaining('get() receives unbranded literal SQL text'),
        expect.stringContaining('all() receives unbranded literal SQL text'),
        expect.stringContaining('values() receives unbranded literal SQL text'),
        expect.stringContaining('futureStatement() receives unbranded literal SQL text'),
        expect.stringContaining('<computed-sql-method>() receives unbranded literal SQL text'),
      ]),
    );
  });

  it('treats unknown future driver methods on managed receivers as SQL sinks by construction', () => {
    const diagnostics = diagnosticsFor(`
      import { staticSql } from '@kovojs/drizzle';
      export async function loadProducts(db: any) {
        await db.futureStatement({ mode: "read" }, "select * from products");
        await db.futureStatement({ mode: "read" }, staticSql\`select * from products\`);
      }
    `);

    expect(diagnostics).toMatchObject([
      {
        code: 'KV422',
        message: expect.stringContaining('futureStatement() receives unbranded literal SQL text'),
        site: 'app.ts:4',
      },
    ]);
  });

  it('does not classify reusable write-definition run methods as SQLite SQL sinks', () => {
    const diagnostics = diagnosticsFor(`
      export async function handler(input: { id: string }, request: { db: unknown }) {
        const insertTxProof = {
          async run(db: unknown, id: string) {
            void db;
            void id;
          },
        };
        await insertTxProof.run(request.db, input.id);
      }
    `);

    expect(diagnostics).toEqual([]);
  });

  it('bans native drizzle-orm raw helpers so Kovo-owned helpers carry audit metadata', () => {
    const diagnostics = diagnosticsFor(`
      import { sql as drizzleSql } from 'drizzle-orm';
      import * as drizzle from 'drizzle-orm';
      export async function loadProducts(db: any) {
        await db.execute(drizzleSql.raw("select * from products"));
        await db.execute(drizzle.sql.identifier("products"));
      }
    `);

    expect(diagnostics.map(({ message }) => message)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Direct drizzle-orm sql.raw(...) is not accepted'),
        expect.stringContaining('Direct drizzle-orm sql.identifier(...) is not accepted'),
      ]),
    );
  });

  // SPEC §10.2/§6.6 (KV422): the Kovo raw-SQL helper must be recognized through its
  // RESOLVED `@kovojs/drizzle` binding, not a literal `receiver === 'sql'` compare, so an
  // aliased `import { sql as s }` or a namespace `import * as k` cannot smuggle a raw chunk
  // through the query builder (orderBy/where) past the gate — the inner `s.raw(...)` /
  // `k.sql.raw(...)` call is flagged wherever it appears, before it can reach the builder.
  it('flags aliased and namespace-imported Kovo sql.raw through the query builder (KV422)', () => {
    const aliased = diagnosticsFor(`
      import { sql as s } from '@kovojs/drizzle';
      export async function loadProducts(input: { sort: string }, db: any) {
        return db.select().from(products).orderBy(s.raw(input.sort));
      }
    `);
    expect(aliased.map(({ code }) => code)).toEqual(['KV422']);
    expect(aliased[0]?.message).toContain('sql.raw(...) receives request-derived text');

    const namespace = diagnosticsFor(`
      import * as k from '@kovojs/drizzle';
      export async function loadProducts(input: { sort: string }, db: any) {
        return db.select().from(products).orderBy(k.sql.raw(input.sort));
      }
    `);
    expect(namespace.map(({ code }) => code)).toEqual(['KV422']);

    // Baseline: bare `sql.raw` of a request value is still flagged.
    const bare = diagnosticsFor(`
      import { sql } from '@kovojs/drizzle';
      export async function loadProducts(input: { sort: string }, db: any) {
        return db.select().from(products).orderBy(sql.raw(input.sort));
      }
    `);
    expect(bare.map(({ code }) => code)).toEqual(['KV422']);

    // No false positive: an aliased raw chunk of a static literal stays accepted.
    const aliasedLiteral = diagnosticsFor(`
      import { sql as s } from '@kovojs/drizzle';
      export async function loadProducts(db: any) {
        return db.select().from(products).orderBy(s.raw("created_at desc"));
      }
    `);
    expect(aliasedLiteral).toEqual([]);
  });
});
