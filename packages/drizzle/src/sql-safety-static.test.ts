import { describe, expect, it } from 'vitest';

import { analyzeSqlSafetyFromProject } from '@kovojs/drizzle/internal/static';

function diagnosticsFor(source: string) {
  return analyzeSqlSafetyFromProject({
    files: [
      {
        fileName: 'app.ts',
        source,
      },
    ],
  });
}

describe('@kovojs/drizzle SQL safety static analysis', () => {
  it('flags request-derived raw SQL construction at managed sinks', () => {
    const diagnostics = diagnosticsFor(`
      export async function loadProducts(input: { id: string }, req: { search: Record<string, string>, params: Record<string, string> }, db: any) {
        await db.execute("select * from products where id = '" + input.id + "'");
        await db.query(\`select * from products order by \${req.search.sort} \${req.search.dir}\`);
        const status = "where status = '" + req.search.status + "'";
        await db.exec("select * from products " + status);
        await db.prepare("select * from products where q like '%" + req.search.q + "%'");
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
    ]);
    expect(diagnostics.map((diagnostic) => diagnostic.message)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('execute() receives request-derived SQL text'),
        expect.stringContaining('query() receives request-derived SQL text'),
        expect.stringContaining('exec() receives request-derived SQL text'),
        expect.stringContaining('prepare() receives request-derived SQL text'),
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
