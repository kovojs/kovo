import { describe, expect, it } from 'vitest';

import {
  diagnosticsForQueryFacts,
  extractOwnerAuditFromProject,
  extractQueryFactsFromProject,
  extractTouchGraphFromProject,
  type SourceFileInput,
} from '@kovojs/drizzle/internal/static';
import { pgDatabaseTypes, withPgDatabaseTypes } from './test-helpers.js';

// bugz-3 H1 (SPEC §6.6/§11.1): `query()` loaders must be recognized through their @kovojs/server
// binding (bare / `import { query as q }` alias / `import * as srv` namespace member), not by the
// literal callee text `query`. An aliased or namespaced loader that the old text gate skipped
// silently erased the entire read-side surface (KV435 secret-to-wire + KV414 read IDOR scope audit)
// while the runtime still served the query.
describe('bugz-3 H1: query() loader recognition is alias/namespace hardened', () => {
  const dbTypes = pgDatabaseTypes([
    'select(value?: unknown): { from(table: unknown): { where(value: unknown): Promise<unknown[]> } };',
  ]);

  function ordersQueryFile(importLine: string, callee: string, setupLine = ''): SourceFileInput {
    return {
      fileName: 'order.queries.ts',
      source: [
        importLine,
        'import { eq } from "drizzle-orm";',
        'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
        setupLine,
        '',
        'export const orders = pgTable("orders", {',
        '  id: text("id").primaryKey(),',
        '  ownerId: text("owner_id").notNull(),',
        '  secretToken: text("secret_token").notNull(),',
        '}, kovo({ domain: "order", key: "id", owner: "ownerId", secret: ["secretToken"] }));',
        '',
        `export const orderById = ${callee}("order", {`,
        '  output: s.object({ token: s.string() }),',
        '  reads: [orders],',
        '  load(input, db: PgAsyncDatabase<any, any>) {',
        '    return db',
        '      .select({ token: sql<string>`${orders.secretToken}` })',
        '      .from(orders)',
        '      .where(eq(orders.id, input.id));',
        '  },',
        '});',
      ].join('\n'),
    };
  }

  const forms: { label: string; importLine: string; setupLine?: string; callee: string }[] = [
    { label: 'bare query() (control)', importLine: '', callee: 'query' },
    {
      label: 'aliased import { query as q }',
      importLine: 'import { query as q } from "@kovojs/server";',
      callee: 'q',
    },
    {
      label: 'namespace import * as srv',
      importLine: 'import * as srv from "@kovojs/server";',
      callee: 'srv.query',
    },
    {
      label: 'const alias of imported query',
      importLine: 'import { query } from "@kovojs/server";',
      setupLine: 'const q = query;',
      callee: 'q',
    },
    {
      label: 'const alias of server namespace',
      importLine: 'import * as srv from "@kovojs/server";',
      setupLine: 'const s = srv;',
      callee: 's.query',
    },
  ];

  for (const form of forms) {
    it(`recognizes the loader and fires KV435 + the args scope audit for ${form.label}`, () => {
      const options = withPgDatabaseTypes(
        { files: [dbTypes, ordersQueryFile(form.importLine, form.callee, form.setupLine)] },
        [],
      );

      const facts = extractQueryFactsFromProject(options);
      // KEY ASSERTION: the loader is recognized (old aliased/namespace behavior was `facts === []`).
      expect(facts.map((fact) => fact.query)).toEqual(['order']);

      const kv435 = diagnosticsForQueryFacts(facts).filter(
        (diagnostic) => diagnostic.code === 'KV435',
      );
      // KEY ASSERTION: the secret column reaching the wire fires KV435 for every binding form.
      expect(kv435).toHaveLength(1);
      expect(kv435[0]?.message).toContain('order.token');

      const ownerAudit = extractOwnerAuditFromProject(options);
      expect(ownerAudit.ownerDomains).toEqual([{ domain: 'order', owner: 'ownerId' }]);
      // KEY ASSERTION: the read-side IDOR scope audit (KV414, scope:'args') engages identically.
      expect(
        ownerAudit.scopeAudits.map((audit) => ({
          domain: audit.domain,
          kind: audit.kind,
          name: audit.name,
          scope: audit.scope,
        })),
      ).toContainEqual({ domain: 'order', kind: 'query', name: 'order', scope: 'args' });
    });
  }

  it('recognizes a query imported through a renamed local re-export', () => {
    const options = withPgDatabaseTypes(
      {
        files: [
          dbTypes,
          {
            fileName: 'server-barrel.ts',
            source: 'export { query as q } from "@kovojs/server";',
          },
          ordersQueryFile('import { q } from "./server-barrel";', 'q'),
        ],
      },
      [],
    );

    const facts = extractQueryFactsFromProject(options);
    expect(facts.map((fact) => fact.query)).toEqual(['order']);
    expect(diagnosticsForQueryFacts(facts).some((diagnostic) => diagnostic.code === 'KV435')).toBe(
      true,
    );
    expect(
      extractOwnerAuditFromProject(options).scopeAudits.map((audit) => ({
        domain: audit.domain,
        kind: audit.kind,
        name: audit.name,
        scope: audit.scope,
      })),
    ).toContainEqual({ domain: 'order', kind: 'query', name: 'order', scope: 'args' });
  });
});

// bugz-3 L11 (SPEC §11.1): the legacy `domain({ action: write(...) })` write-surface extractor must
// resolve `domain`/`write` through their @kovojs/server binding too, closing the silent-vs-fail-closed
// asymmetry where an aliased outer `domain(...)` produced an empty touch graph.
describe('bugz-3 L11: domain()/write() recognition is alias/namespace hardened', () => {
  const dbTypes = pgDatabaseTypes([
    'update(table: unknown): { set(value: unknown): { where(value: unknown): Promise<void> } };',
  ]);

  function cartDomainFile(
    importLine: string,
    domainCallee: string,
    writeCallee: string,
    setupLine = '',
  ): SourceFileInput {
    return {
      fileName: 'cart.domain.ts',
      source: [
        importLine,
        'import { eq } from "drizzle-orm";',
        'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
        setupLine,
        '',
        'export const cartItems = pgTable("cart_items", {}, kovo({ domain: "cart", key: "productId" }));',
        '',
        `export const cart = ${domainCallee}({`,
        `  addItem: ${writeCallee}({ touches: [cartItems] }, async (db: PgAsyncDatabase<any, any>, productId: string) => {`,
        '    await db.update(cartItems).set({ productId }).where(eq(cartItems.productId, productId));',
        '  }),',
        '});',
      ].join('\n'),
    };
  }

  // Strip the line-dependent `site` field so the three binding forms compare structurally.
  const stripSites = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(stripSites);
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .filter(([key]) => key !== 'site')
          .map(([key, child]) => [key, stripSites(child)]),
      );
    }
    return value;
  };

  const literalGraph = extractTouchGraphFromProject({
    files: [dbTypes, cartDomainFile('', 'domain', 'write')],
  });

  it('control: literal domain()/write() yields the cart.addItem touch fact', () => {
    expect(Object.keys(literalGraph)).toEqual(['cart.addItem']);
    expect(stripSites(literalGraph)).toEqual({
      'cart.addItem': {
        reads: [],
        touches: [{ domain: 'cart', keys: 'arg:productId', via: 'cart_items' }],
        unresolved: [],
      },
    });
  });

  const aliasedForms: {
    label: string;
    importLine: string;
    setupLine?: string;
    domainCallee: string;
    writeCallee: string;
  }[] = [
    {
      label: 'aliased import { domain as dom, write as wr }',
      importLine: 'import { domain as dom, write as wr } from "@kovojs/server";',
      domainCallee: 'dom',
      writeCallee: 'wr',
    },
    {
      label: 'namespace import * as srv',
      importLine: 'import * as srv from "@kovojs/server";',
      domainCallee: 'srv.domain',
      writeCallee: 'srv.write',
    },
    {
      label: 'const aliases of imported domain/write',
      importLine: 'import { domain, write } from "@kovojs/server";',
      setupLine: 'const dom = domain;\nconst wr = write;',
      domainCallee: 'dom',
      writeCallee: 'wr',
    },
    {
      label: 'const alias of server namespace',
      importLine: 'import * as srv from "@kovojs/server";',
      setupLine: 'const s = srv;',
      domainCallee: 's.domain',
      writeCallee: 's.write',
    },
  ];

  for (const form of aliasedForms) {
    it(`extracts the same touch graph for ${form.label} (was silently {})`, () => {
      const graph = extractTouchGraphFromProject({
        files: [
          dbTypes,
          cartDomainFile(form.importLine, form.domainCallee, form.writeCallee, form.setupLine),
        ],
      });
      // KEY ASSERTION: the aliased/namespaced legacy form no longer collapses to an empty graph.
      expect(Object.keys(graph)).toEqual(['cart.addItem']);
      expect(stripSites(graph)).toEqual(stripSites(literalGraph));
    });
  }

  it('extracts the same touch graph through renamed local re-exports', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        dbTypes,
        {
          fileName: 'server-barrel.ts',
          source: 'export { domain as dom, write as wr } from "@kovojs/server";',
        },
        cartDomainFile('import { dom, wr } from "./server-barrel";', 'dom', 'wr'),
      ],
    });

    expect(Object.keys(graph)).toEqual(['cart.addItem']);
    expect(stripSites(graph)).toEqual(stripSites(literalGraph));
  });
});

// bugz-3 M4 (SPEC §10.2/§11.3): the relational-query projection extractor must parse the `extras`
// key. A secret column raw-projected through `extras` previously escaped KV435/KV439 because `extras`
// was never read — the inferred shape kept only `columns`/`with`.
describe('bugz-3 M4: relational-query extras projections engage the secret backstop', () => {
  function usersQueryFile(loadBody: string): SourceFileInput {
    return {
      fileName: 'user.queries.ts',
      source: [
        'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
        '',
        'export const users = pgTable("users", {',
        '  id: text("id").primaryKey(),',
        '  name: text("name").notNull(),',
        '  passwordHash: text("password_hash").notNull(),',
        '}, kovo({ domain: "user", key: "id", secret: ["passwordHash"] }));',
        '',
        'export const usersQuery = query("user", {',
        '  output: s.object({ id: s.string() }),',
        '  reads: [users],',
        '  load(_input, db: PgAsyncDatabase<any, any>) {',
        `    return ${loadBody};`,
        '  },',
        '});',
      ].join('\n'),
    };
  }

  it('control: a columns-only projection of non-secret fields fires no KV435', () => {
    const facts = extractQueryFactsFromProject({
      files: [usersQueryFile('db.query.users.findMany({ columns: { id: true, name: true } })')],
    });
    expect(facts.map((fact) => fact.query)).toEqual(['user']);
    expect(
      diagnosticsForQueryFacts(facts).filter((diagnostic) => diagnostic.code === 'KV435'),
    ).toEqual([]);
  });

  it('fires KV435 for a secret column raw-projected via extras (the M4 escape)', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        usersQueryFile(
          'db.query.users.findMany({ columns: { id: true, name: true }, extras: { leaked: sql<string>`${users.passwordHash}`.as("leaked") } })',
        ),
      ],
    });

    expect(facts.map((fact) => fact.query)).toEqual(['user']);
    const kv435 = diagnosticsForQueryFacts(facts).filter(
      (diagnostic) => diagnostic.code === 'KV435',
    );
    // KEY ASSERTION: the extras-projected secret column now fires KV435 (was `[]` — silent leak).
    expect(kv435).toHaveLength(1);
    expect(kv435[0]?.message).toContain('user.leaked');
  });

  it('fires KV435 for a secret column raw-projected via a nested with(...) extras', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        {
          fileName: 'post.queries.ts',
          source: [
            'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const users = pgTable("users", {',
            '  id: text("id").primaryKey(),',
            '  passwordHash: text("password_hash").notNull(),',
            '}, kovo({ domain: "user", key: "id", secret: ["passwordHash"] }));',
            'export const posts = pgTable("posts", {',
            '  id: text("id").primaryKey(),',
            '}, kovo({ domain: "post", key: "id" }));',
            'export const postsRelations = relations(posts, ({ one }) => ({ author: one(users) }));',
            '',
            'export const postsQuery = query("post", {',
            '  output: s.object({ id: s.string() }),',
            '  reads: [posts, users],',
            '  load(_input, db: PgAsyncDatabase<any, any>) {',
            '    return db.query.posts.findMany({',
            '      columns: { id: true },',
            '      with: { author: { columns: { id: true }, extras: { leaked: sql<string>`${users.passwordHash}`.as("leaked") } } },',
            '    });',
            '  },',
            '});',
          ].join('\n'),
        },
      ],
    });

    expect(facts.map((fact) => fact.query)).toEqual(['post']);
    const kv435 = diagnosticsForQueryFacts(facts).filter(
      (diagnostic) => diagnostic.code === 'KV435',
    );
    expect(kv435.length).toBeGreaterThanOrEqual(1);
    expect(kv435.some((diagnostic) => diagnostic.message.includes('author.leaked'))).toBe(true);
  });
});

describe('bugz-4 H2/M5: relational-query with() relations contribute read security facts', () => {
  it('folds with-relation owner tables into the KV414 read set', () => {
    const project = withPgDatabaseTypes({
      files: [
        pgDatabaseTypes(['query: { posts: { findMany(value?: unknown): Promise<unknown[]> } };']),
        {
          fileName: 'feed.queries.ts',
          source: [
            'import { eq } from "drizzle-orm";',
            'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const posts = pgTable("posts", { id: text("id").primaryKey() }, kovo({ domain: "post", key: "id" }));',
            'export const comments = pgTable("comments", { id: text("id").primaryKey(), postId: text("post_id").notNull(), authorId: text("author_id").notNull() }, kovo({ domain: "comment", key: "id", owner: "authorId" }));',
            'export const postsRelations = relations(posts, ({ many }) => ({ comments: many(comments) }));',
            '',
            'export const feed = query("feed", {',
            '  output: s.object({ id: s.string() }),',
            '  async load(input: { postId: string }, db: PgAsyncDatabase<any, any>) {',
            '    return db.query.posts.findMany({',
            '      columns: { id: true },',
            '      with: { comments: { columns: { id: true } } },',
            '      where: eq(posts.id, input.postId),',
            '    });',
            '  },',
            '});',
          ].join('\n'),
        },
      ],
    });

    const facts = extractQueryFactsFromProject(project);
    expect(facts.map((fact) => fact.reads)).toEqual([['comment', 'post']]);

    const audit = extractOwnerAuditFromProject(project);
    expect(
      audit.scopeAudits.map((fact) => ({
        domain: fact.domain,
        name: fact.name,
        scope: fact.scope,
      })),
    ).toEqual([{ domain: 'comment', name: 'feed', scope: 'args' }]);
  });

  it('fires KV435 for with-relation extras when reads omits the related secret table', () => {
    const facts = extractQueryFactsFromProject(
      withPgDatabaseTypes({
        files: [
          pgDatabaseTypes(['query: { posts: { findMany(value?: unknown): Promise<unknown[]> } };']),
          {
            fileName: 'post.queries.ts',
            source: [
              'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
              '',
              'export const users = pgTable("users", {',
              '  id: text("id").primaryKey(),',
              '  passwordHash: text("password_hash").notNull(),',
              '}, kovo({ domain: "user", key: "id", secret: ["passwordHash"] }));',
              'export const posts = pgTable("posts", {',
              '  id: text("id").primaryKey(),',
              '}, kovo({ domain: "post", key: "id" }));',
              'export const postsRelations = relations(posts, ({ one }) => ({ author: one(users) }));',
              '',
              'export const postsQuery = query("post", {',
              '  output: s.object({ id: s.string() }),',
              '  reads: [posts],',
              '  load(_input, db: PgAsyncDatabase<any, any>) {',
              '    return db.query.posts.findMany({',
              '      columns: { id: true },',
              '      with: { author: { columns: { id: true }, extras: { leaked: sql<string>`${users.passwordHash}`.as("leaked") } } },',
              '    });',
              '  },',
              '});',
            ].join('\n'),
          },
        ],
      }),
    );

    expect(facts.map((fact) => fact.reads)).toEqual([['post', 'user']]);
    const kv435 = diagnosticsForQueryFacts(facts).filter(
      (diagnostic) => diagnostic.code === 'KV435',
    );
    expect(kv435.some((diagnostic) => diagnostic.message.includes('author.leaked'))).toBe(true);
  });
});
