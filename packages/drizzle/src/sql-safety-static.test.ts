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
        await db.execute(sql\`select * from products where id = \${input.id}\`);
        await db.query(staticSql\`select * from products\`);
        await db.exec({ text: "select * from products where id = $1", values: [input.id] });
        await db.execute(sql.identifier(input.sort, { allow: ["name", "created_at"] }));
        await db.execute(sql.allow(input.dir, ["asc", "desc"]));
        await db.execute(trustedSql(sql.raw("where archived = false"), { justification: "static report clause" }));
      }
    `);

    expect(diagnostics).toEqual([]);
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
});
