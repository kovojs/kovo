import { describe, expect, it } from 'vitest';

import {
  diagnosticsForTouchGraph,
  extractSymbolicEffectsFromProject,
  extractTouchGraphFromProject,
  extractQueryFactsFromProject as extractQueryFactsFromProjectBase,
} from '@kovojs/drizzle/internal/static';
import { pgDatabaseTypes, sqliteDatabaseTypes, withPgDatabaseTypes } from './test-helpers.js';

const extractQueryFactsFromProject = (
  options: Parameters<typeof extractQueryFactsFromProjectBase>[0],
) => extractQueryFactsFromProjectBase(withPgDatabaseTypes(options));

describe('@kovojs/drizzle touch graph helpers', () => {
  it('uses declared analyzer summaries for same-package session helper provenance', () => {
    const files = [
      pgDatabaseTypes([
        'update(table: unknown): { set(value: unknown): { where(value: unknown): Promise<void> } };',
      ]),
      {
        fileName: 'question.domain.ts',
        source: [
          'import { and, eq } from "drizzle-orm";',
          'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
          'import { kovoAnalyzerSummary } from "@kovojs/drizzle";',
          '',
          'export const questions = pgTable("questions", {}, kovo({ domain: "question", key: "sessionId,id" }));',
          '',
          'function requireSessionId(request: { session?: { id?: string } | null }) {',
          '  if (!request.session?.id) throw new Error("auth required");',
          '  return request.session.id;',
          '}',
          '',
          'kovoAnalyzerSummary(requireSessionId, { returns: { kind: "session", path: "id" } });',
          '',
          'export async function voteUp(db: PgAsyncDatabase<any, any>, request: { session?: { id?: string } | null }, targetId: string) {',
          '  const sessionId = requireSessionId(request);',
          '  await db.update(questions).set({ score: 1 }).where(and(eq(questions.sessionId, sessionId), eq(questions.id, targetId)));',
          '}',
        ].join('\n'),
      },
    ];

    const graph = extractTouchGraphFromProject({ files });

    expect(graph.voteUp?.touches).toEqual([
      {
        domain: 'question',
        keys: 'arg:targetId',
        site: 'question.domain.ts:16',
        via: 'questions',
      },
    ]);
    expect(diagnosticsForTouchGraph(graph)).toEqual([]);
    expect(extractSymbolicEffectsFromProject({ files }).map((fact) => fact.effect)).toEqual([
      {
        match: {
          eq: [
            { column: 'sessionId', value: { kind: 'session', path: 'id' } },
            { column: 'id', value: { kind: 'param', path: 'targetId' } },
          ],
          kind: 'keys',
        },
        op: 'update',
        sets: { score: { kind: 'const', value: 1 } },
        table: 'questions',
      },
    ]);
  });

  it('degrades nullable session aliases used before their guard', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes([
          'update(table: unknown): { set(value: unknown): { where(value: unknown): Promise<void> } };',
        ]),
        {
          fileName: 'question.domain.ts',
          source: [
            'import { and, eq } from "drizzle-orm";',
            'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const questions = pgTable("questions", {}, kovo({ domain: "question", key: "sessionId,id" }));',
            '',
            'export async function voteUp(db: PgAsyncDatabase<any, any>, request: { session?: { id?: string } | null }, targetId: string) {',
            '  const sessionId = request.session?.id;',
            '  const observed = sessionId;',
            '  if (!sessionId) throw new Error("auth required");',
            '  await db.update(questions).set({ score: 1 }).where(and(eq(questions.sessionId, sessionId), eq(questions.id, targetId)));',
            '}',
          ].join('\n'),
        },
      ],
    });

    expect(graph.voteUp?.touches).toEqual([
      {
        domain: 'question',
        keys: null,
        predicate: 'non-eq',
        site: 'question.domain.ts:10',
        via: 'questions',
      },
    ]);
  });

  it('degrades unsummarized helpers returning private scope with a named opaque match', () => {
    const files = [
      pgDatabaseTypes([
        'update(table: unknown): { set(value: unknown): { where(value: unknown): Promise<void> } };',
      ]),
      {
        fileName: 'question.domain.ts',
        source: [
          'import { and, eq } from "drizzle-orm";',
          'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
          '',
          'export const questions = pgTable("questions", {}, kovo({ domain: "question", key: "sessionId,id" }));',
          '',
          'function requireSessionId(request: { session?: { id?: string } | null }) {',
          '  if (!request.session?.id) throw new Error("auth required");',
          '  return request.session.id;',
          '}',
          '',
          'export async function voteUp(db: PgAsyncDatabase<any, any>, request: { session?: { id?: string } | null }, targetId: string) {',
          '  const sessionId = requireSessionId(request);',
          '  await db.update(questions).set({ score: 1 }).where(and(eq(questions.sessionId, sessionId), eq(questions.id, targetId)));',
          '}',
        ].join('\n'),
      },
    ];

    const graph = extractTouchGraphFromProject({ files });

    expect(graph.voteUp?.touches).toEqual([
      {
        domain: 'question',
        keys: null,
        predicate: 'non-eq',
        site: 'question.domain.ts:13',
        via: 'questions',
      },
    ]);
    expect(diagnosticsForTouchGraph(graph)).toMatchObject([
      { code: 'KV409', site: 'question.domain.ts:13' },
    ]);
    expect(extractSymbolicEffectsFromProject({ files }).map((fact) => fact.effect)).toEqual([
      {
        match: { expr: 'unsummarized-helper:requireSessionId', kind: 'opaque' },
        op: 'update',
        sets: { score: { kind: 'const', value: 1 } },
        table: 'questions',
      },
    ]);
  });

  it('degrades guarded session aliases that escape before use', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes([
          'update(table: unknown): { set(value: unknown): { where(value: unknown): Promise<void> } };',
        ]),
        {
          fileName: 'question.domain.ts',
          source: [
            'import { and, eq } from "drizzle-orm";',
            'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
            'declare function audit(value: string): void;',
            '',
            'export const questions = pgTable("questions", {}, kovo({ domain: "question", key: "sessionId,id" }));',
            '',
            'export async function voteUp(db: PgAsyncDatabase<any, any>, request: { session?: { id?: string } | null }, targetId: string) {',
            '  const sessionId = request.session?.id;',
            '  if (!sessionId) throw new Error("auth required");',
            '  audit(sessionId);',
            '  await db.update(questions).set({ score: 1 }).where(and(eq(questions.sessionId, sessionId), eq(questions.id, targetId)));',
            '}',
          ].join('\n'),
        },
      ],
    });

    expect(graph.voteUp?.touches).toEqual([
      {
        domain: 'question',
        keys: null,
        predicate: 'non-eq',
        site: 'question.domain.ts:11',
        via: 'questions',
      },
    ]);
  });

  it('degrades guarded session aliases passed through async helper opacity', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes([
          'update(table: unknown): { set(value: unknown): { where(value: unknown): Promise<void> } };',
        ]),
        {
          fileName: 'question.domain.ts',
          source: [
            'import { and, eq } from "drizzle-orm";',
            'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
            'declare function normalize(value: string): Promise<string>;',
            '',
            'export const questions = pgTable("questions", {}, kovo({ domain: "question", key: "sessionId,id" }));',
            '',
            'export async function voteUp(db: PgAsyncDatabase<any, any>, request: { session?: { id?: string } | null }, targetId: string) {',
            '  const sessionId = request.session?.id;',
            '  if (!sessionId) throw new Error("auth required");',
            '  await normalize(sessionId);',
            '  await db.update(questions).set({ score: 1 }).where(and(eq(questions.sessionId, sessionId), eq(questions.id, targetId)));',
            '}',
          ].join('\n'),
        },
      ],
    });

    expect(graph.voteUp?.touches).toEqual([
      {
        domain: 'question',
        keys: null,
        predicate: 'non-eq',
        site: 'question.domain.ts:11',
        via: 'questions',
      },
    ]);
  });

  it('erases tenant helper summaries from visible composite keys', () => {
    const files = [
      pgDatabaseTypes([
        'update(table: unknown): { set(value: unknown): { where(value: unknown): Promise<void> } };',
      ]),
      {
        fileName: 'ticket.domain.ts',
        source: [
          'import { and, eq } from "drizzle-orm";',
          'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
          'import { kovoAnalyzerSummary } from "@kovojs/drizzle";',
          '',
          'export const tickets = pgTable("tickets", {}, kovo({ domain: "ticket", key: "tenantId,id" }));',
          '',
          'function tenantId(request: { tenant?: { id?: string } | null }) {',
          '  if (!request.tenant?.id) throw new Error("tenant required");',
          '  return request.tenant.id;',
          '}',
          '',
          'kovoAnalyzerSummary(tenantId, { returns: { kind: "tenant", path: "id" } });',
          '',
          'export async function closeTicket(db: PgAsyncDatabase<any, any>, request: { tenant?: { id?: string } | null }, targetId: string) {',
          '  const currentTenantId = tenantId(request);',
          '  await db.update(tickets).set({ status: "closed" }).where(and(eq(tickets.tenantId, currentTenantId), eq(tickets.id, targetId)));',
          '}',
        ].join('\n'),
      },
    ];

    const graph = extractTouchGraphFromProject({ files });

    expect(graph.closeTicket?.touches).toEqual([
      {
        domain: 'ticket',
        keys: 'arg:targetId',
        site: 'ticket.domain.ts:16',
        via: 'tickets',
      },
    ]);
    expect(diagnosticsForTouchGraph(graph)).toEqual([]);
    expect(extractSymbolicEffectsFromProject({ files }).map((fact) => fact.effect)).toEqual([
      {
        match: {
          eq: [
            { column: 'tenantId', value: { kind: 'tenant', path: 'id' } },
            { column: 'id', value: { kind: 'param', path: 'targetId' } },
          ],
          kind: 'keys',
        },
        op: 'update',
        sets: { status: { kind: 'const', value: 'closed' } },
        table: 'tickets',
      },
    ]);
  });

  it('degrades guarded session aliases that are mutated before use', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes([
          'update(table: unknown): { set(value: unknown): { where(value: unknown): Promise<void> } };',
        ]),
        {
          fileName: 'question.domain.ts',
          source: [
            'import { and, eq } from "drizzle-orm";',
            'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const questions = pgTable("questions", {}, kovo({ domain: "question", key: "sessionId,id" }));',
            '',
            'export async function voteUp(db: PgAsyncDatabase<any, any>, request: { session?: { id?: string } | null }, targetId: string) {',
            '  let sessionId = request.session?.id;',
            '  if (!sessionId) return;',
            '  sessionId += "";',
            '  await db.update(questions).set({ score: 1 }).where(and(eq(questions.sessionId, sessionId), eq(questions.id, targetId)));',
            '}',
          ].join('\n'),
        },
      ],
    });

    expect(graph.voteUp?.touches).toEqual([
      {
        domain: 'question',
        keys: null,
        predicate: 'non-eq',
        site: 'question.domain.ts:10',
        via: 'questions',
      },
    ]);
  });

  it('degrades unguarded nullable session aliases instead of proving row identity', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes([
          'update(table: unknown): { set(value: unknown): { where(value: unknown): Promise<void> } };',
        ]),
        {
          fileName: 'question.domain.ts',
          source: [
            'import { and, eq } from "drizzle-orm";',
            'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const questions = pgTable("questions", {}, kovo({ domain: "question", key: "sessionId,id" }));',
            '',
            'export async function voteUp(db: PgAsyncDatabase<any, any>, request: { session?: { id?: string } | null }, targetId: string) {',
            '  const sessionId = request.session?.id;',
            '  await db.update(questions).set({ score: 1 }).where(and(eq(questions.sessionId, sessionId), eq(questions.id, targetId)));',
            '}',
          ].join('\n'),
        },
      ],
    });

    expect(graph.voteUp?.touches).toEqual([
      {
        domain: 'question',
        keys: null,
        predicate: 'non-eq',
        site: 'question.domain.ts:8',
        via: 'questions',
      },
    ]);
  });

  it('degrades guarded session aliases that are reassigned before use', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes([
          'update(table: unknown): { set(value: unknown): { where(value: unknown): Promise<void> } };',
        ]),
        {
          fileName: 'question.domain.ts',
          source: [
            'import { and, eq } from "drizzle-orm";',
            'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const questions = pgTable("questions", {}, kovo({ domain: "question", key: "sessionId,id" }));',
            '',
            'export async function voteUp(db: PgAsyncDatabase<any, any>, request: { session?: { id?: string } | null }, targetId: string) {',
            '  let sessionId = request.session?.id;',
            '  if (!sessionId) return;',
            '  sessionId = targetId;',
            '  await db.update(questions).set({ score: 1 }).where(and(eq(questions.sessionId, sessionId), eq(questions.id, targetId)));',
            '}',
          ].join('\n'),
        },
      ],
    });

    expect(graph.voteUp?.touches).toEqual([
      {
        domain: 'question',
        keys: null,
        predicate: 'non-eq',
        site: 'question.domain.ts:10',
        via: 'questions',
      },
    ]);
  });

  it('degrades eq predicates with non-parameter values to table-level invalidation', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes([
          'update(table: unknown): { set(value: unknown): { where(value: unknown): Promise<void> } };',
        ]),
        {
          fileName: 'product.domain.ts',
          source: [
            'import { eq } from "drizzle-orm";',
            'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const products = pgTable("products", {}, kovo({ domain: "product", key: "id" }));',
            '',
            'export async function syncProduct(db: PgAsyncDatabase<any, any>) {',
            '  const randomLocal = "p1";',
            '  await db.update(products).set({ reserved: true }).where(eq(products.id, randomLocal));',
            '}',
          ].join('\n'),
        },
      ],
    });

    expect(graph).toEqual({
      syncProduct: {
        reads: [],
        touches: [
          {
            domain: 'product',
            keys: null,
            predicate: 'non-eq',
            site: 'product.domain.ts:8',
            via: 'products',
          },
        ],
        unresolved: [],
      },
    });
    expect(diagnosticsForTouchGraph(graph)).toEqual([
      {
        code: 'KV409',
        message: 'Non-eq predicate degraded to table-level invalidation.',
        severity: 'notice',
        site: 'product.domain.ts:8',
      },
    ]);
  });

  it('marks direct non-equality predicates as KV409 degraded table-level invalidation', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes([
          'update(table: unknown): { set(value: unknown): { where(value: unknown): Promise<void>; from(table: unknown): { where(value: unknown): Promise<void> } } };',
        ]),
        {
          fileName: 'product.domain.ts',
          source: [
            'import { gt } from "drizzle-orm";',
            'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const products = pgTable("products", {}, kovo({ domain: "product", key: "id" }));',
            'export const prices = pgTable("prices", {}, kovo({ domain: "price", key: "productId" }));',
            '',
            'export async function syncProduct(db: PgAsyncDatabase<any, any>, productId: string) {',
            '  await db.update(products).set({ reserved: true }).where(gt(products.id, productId));',
            '  await db.update(products).set({ price: prices.amount }).from(prices).where(gt(prices.productId, productId));',
            '}',
          ].join('\n'),
        },
      ],
    });

    expect(graph).toEqual({
      syncProduct: {
        reads: [
          {
            domain: 'price',
            keys: null,
            predicate: 'non-eq',
            site: 'product.domain.ts:9',
            source: 'update-from',
            via: 'prices',
          },
        ],
        touches: [
          { domain: 'product', keys: null, site: 'product.domain.ts:9', via: 'products' },
          {
            domain: 'product',
            keys: null,
            predicate: 'non-eq',
            site: 'product.domain.ts:8',
            via: 'products',
          },
        ],
        unresolved: [],
      },
    });
    expect(diagnosticsForTouchGraph(graph)).toEqual([
      {
        code: 'KV409',
        message: 'Non-eq predicate degraded to table-level invalidation.',
        severity: 'notice',
        site: 'product.domain.ts:8',
      },
      {
        code: 'KV409',
        message: 'Non-eq predicate degraded to table-level invalidation.',
        severity: 'notice',
        site: 'product.domain.ts:9',
      },
    ]);
  });

  it('resolves local Drizzle table aliases for writes, reads, and predicates', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        {
          fileName: 'packages/drizzle/src/product.domain.ts',
          source: [
            'import { eq, gt } from "drizzle-orm";',
            'import { alias, integer, pgTable, text, type PgAsyncDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const prices = pgTable("prices", {',
            '  amount: integer("amount").notNull(),',
            '  productId: text("product_id").notNull(),',
            '}, kovo({ domain: "price", key: "productId" }));',
            'export const products = pgTable("products", {',
            '  id: text("id").primaryKey(),',
            '}, kovo({ domain: "product", key: "id" }));',
            'const priceAlias = alias(prices, "pr");',
            'const productAlias = alias(products, "p");',
            '',
            'export async function syncProduct(db: PgAsyncDatabase<any, any>, productId: string) {',
            '  await db.update(productAlias).set({ reserved: true }).where(eq(productAlias.id, productId));',
            '  await db.update(products).set({ price: priceAlias.amount }).from(priceAlias).where(gt(priceAlias.productId, productId));',
            '}',
            '',
          ].join('\n'),
        },
      ],
    });

    expect(graph).toEqual({
      syncProduct: {
        reads: [
          {
            domain: 'price',
            keys: null,
            predicate: 'non-eq',
            site: 'packages/drizzle/src/product.domain.ts:16',
            source: 'update-from',
            via: 'prices',
          },
        ],
        touches: [
          {
            domain: 'product',
            keys: 'arg:productId',
            site: 'packages/drizzle/src/product.domain.ts:15',
            via: 'products',
          },
          {
            domain: 'product',
            keys: null,
            site: 'packages/drizzle/src/product.domain.ts:16',
            via: 'products',
          },
        ],
        unresolved: [],
      },
    });
    expect(diagnosticsForTouchGraph(graph)).toEqual([
      {
        code: 'KV409',
        message: 'Non-eq predicate degraded to table-level invalidation.',
        severity: 'notice',
        site: 'packages/drizzle/src/product.domain.ts:16',
      },
    ]);
  });

  it('does not resolve private table declarations through namespace imports', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes([
          'update(table: unknown): { set(value: unknown): { where(value: unknown): Promise<void> } };',
        ]),
        {
          fileName: 'cart.schema.ts',
          source: `
          const hiddenProducts = pgTable("hidden_products", {}, kovo({ domain: "hidden", key: "id" }));
          export const products = pgTable("products", {}, kovo({ domain: "product", key: "id" }));
        `,
        },
        {
          fileName: 'product.domain.ts',
          source: [
            'import { eq } from "drizzle-orm";',
            'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
            'import * as schema from "./cart.schema";',
            '',
            'export async function syncProduct(db: PgAsyncDatabase<any, any>, productId: string) {',
            '  await db.update(schema.hiddenProducts).set({ reserved: true }).where(eq(schema.hiddenProducts.id, productId));',
            '}',
          ].join('\n'),
        },
      ],
    });

    expect(graph).toEqual({
      syncProduct: {
        reads: [],
        touches: [],
        unresolved: [
          {
            code: 'KV406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'product.domain.ts:6',
          },
        ],
      },
    });
  });

  it('resolves project named import and re-export Drizzle schema aliases', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes([
          'update(table: unknown): { set(value: unknown): { where(value: unknown): Promise<void> } };',
          'delete(table: unknown): { where(value: unknown): Promise<void> };',
        ]),
        {
          fileName: 'schema.ts',
          source: `
            export const products = pgTable("products", {}, kovo({ domain: "product", key: "id" }));
          `,
        },
        {
          fileName: 'tables.ts',
          source: `
            export { products as productTable } from "./schema";
          `,
        },
        {
          fileName: 'product.domain.ts',
          source: `
            import type { PgAsyncDatabase } from "drizzle-orm/pg-core";
            import { products as importedProducts } from "./schema";
            import { productTable } from "./tables";

            export async function syncProduct(db: PgAsyncDatabase<any, any>, productId: string) {
              await db.update(importedProducts).set({ reserved: true }).where(eq(importedProducts.id, productId));
              await db.delete(productTable).where(eq(productTable.id, productId));
            }
          `,
        },
      ],
    });

    expect(graph).toEqual({
      syncProduct: {
        reads: [],
        touches: [
          {
            domain: 'product',
            keys: 'arg:productId',
            site: 'product.domain.ts:7',
            via: 'products',
          },
          {
            domain: 'product',
            keys: 'arg:productId',
            site: 'product.domain.ts:8',
            via: 'products',
          },
        ],
        unresolved: [],
      },
    });
  });

  it('does not resolve project Drizzle schema aliases from comments, strings, or templates', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes([
          'update(table: unknown): { set(value: unknown): { where(value: unknown): Promise<void> } };',
        ]),
        {
          fileName: 'schema.ts',
          source: `
            export const products = pgTable("products", {}, kovo({ domain: "product", key: "id" }));
          `,
        },
        {
          fileName: 'product.domain.ts',
          source: `
            import type { PgAsyncDatabase } from "drizzle-orm/pg-core";
            const quoted = "import { products as importedProducts } from './schema';";
            // import * as schema from "./schema";

            export async function syncProduct(db: PgAsyncDatabase<any, any>, productId: string) {
              const templated = \`import * as schema from "./schema";\`;
              await db.update(schema.products).set({ reserved: true }).where(eq(schema.products.id, productId));
              await db.update(importedProducts).set({ reserved: false }).where(eq(importedProducts.id, productId));
              return { quoted, templated };
            }
          `,
        },
      ],
    });

    expect(graph).toEqual({
      syncProduct: {
        reads: [],
        touches: [],
        unresolved: [
          {
            code: 'KV406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'product.domain.ts:8',
          },
          {
            code: 'KV406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'product.domain.ts:9',
          },
        ],
      },
    });
  });
});
