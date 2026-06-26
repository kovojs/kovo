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

  function ordersQueryFile(importLine: string, callee: string): SourceFileInput {
    return {
      fileName: 'order.queries.ts',
      source: [
        importLine,
        'import { eq } from "drizzle-orm";',
        'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
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

  const forms: { label: string; importLine: string; callee: string }[] = [
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
  ];

  for (const form of forms) {
    it(`recognizes the loader and fires KV435 + the args scope audit for ${form.label}`, () => {
      const options = withPgDatabaseTypes(
        { files: [dbTypes, ordersQueryFile(form.importLine, form.callee)] },
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
  ): SourceFileInput {
    return {
      fileName: 'cart.domain.ts',
      source: [
        importLine,
        'import { eq } from "drizzle-orm";',
        'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
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
  ];

  for (const form of aliasedForms) {
    it(`extracts the same touch graph for ${form.label} (was silently {})`, () => {
      const graph = extractTouchGraphFromProject({
        files: [dbTypes, cartDomainFile(form.importLine, form.domainCallee, form.writeCallee)],
      });
      // KEY ASSERTION: the aliased/namespaced legacy form no longer collapses to an empty graph.
      expect(Object.keys(graph)).toEqual(['cart.addItem']);
      expect(stripSites(graph)).toEqual(stripSites(literalGraph));
    });
  }
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
