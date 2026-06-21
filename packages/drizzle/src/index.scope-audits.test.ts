import { describe, expect, it } from 'vitest';

import {
  extractOwnerAuditFromProject,
  scopeAuditsFromQueryFacts,
  type QueryFact,
} from '@kovojs/drizzle/internal/static';
import { pgDatabaseTypes, withPgDatabaseTypes } from './test-helpers.js';

// PgDatabase surface for write fixtures: `update().set().where()`,
// `delete().where()`, plus `select().from().where()` for owner reads.
const WRITE_DB_METHODS = [
  'update(table: unknown): { set(value: unknown): { where(value: unknown): Promise<void> } };',
  'delete(table: unknown): { where(value: unknown): Promise<void> };',
  'select(value?: unknown): { from(table: unknown): { where(value: unknown): Promise<unknown[]> } };',
];

function auditScopes(audit: { scopeAudits: { domain: string; kind: string; scope: string }[] }) {
  return audit.scopeAudits.map((a) => ({ domain: a.domain, kind: a.kind, scope: a.scope }));
}

describe('@kovojs/drizzle owner scope-audit producer (SPEC §10.3 IDOR)', () => {
  // The classifier is the security-critical core: a client-arg-keyed owner read is
  // the IDOR signal (`args`); a directly session-anchored read is safe; anything
  // else (e.g. keyed by a local bound from the session) emits NO fact — so a safe
  // app is never false-positived, without needing session data-flow tracing.
  it('emits a fact only for arg-keyed (IDOR) and direct-session owner reads', () => {
    const facts: QueryFact[] = [
      {
        query: 'orderById',
        reads: ['order'],
        instanceKey: { domain: 'order', key: 'arg:id' },
        shape: {},
        site: 'q.ts:1',
      },
      {
        query: 'orderBySession',
        reads: ['order'],
        sessionAnchoredReads: ['order'],
        shape: {},
        site: 'q.ts:2',
      },
      // keyed by a local var (not input.*) -> not the IDOR pattern -> no fact.
      { query: 'orderMine', reads: ['order'], shape: {}, site: 'q.ts:3' },
      // product is not owner-annotated -> never audited.
      {
        query: 'productGrid',
        reads: ['product'],
        instanceKey: { domain: 'product', key: 'arg:id' },
        shape: {},
        site: 'q.ts:4',
      },
    ];

    expect(
      scopeAuditsFromQueryFacts(facts, ['order']).map((a) => ({ name: a.name, scope: a.scope })),
    ).toEqual([
      { name: 'orderById', scope: 'args' },
      { name: 'orderBySession', scope: 'session' },
    ]);
  });

  // End-to-end producer: project source -> ownerDomains + scopeAudits.
  it('extracts ownerDomains + scopeAudits from a project, flagging only the arg-keyed read', () => {
    const audit = extractOwnerAuditFromProject(
      withPgDatabaseTypes({
        files: [
          pgDatabaseTypes([
            'select(value?: unknown): { from(table: unknown): { where(value: unknown): Promise<unknown[]> } };',
          ]),
          {
            fileName: 'order.queries.ts',
            source: [
              'import type { PgDatabase } from "drizzle-orm/pg-core";',
              '',
              'export const orders = pgTable("orders", { id: text("id").primaryKey(), userId: text("user_id").notNull() }, kovo({ domain: "order", key: (t) => t.id, owner: (t) => t.userId }));',
              '',
              'export const orderById = query("order", {',
              '  output: s.object({ id: s.string() }),',
              '  async load(input, db: PgDatabase<any, any, any>) {',
              '    return db.select({ id: orders.id }).from(orders).where(eq(orders.id, input.id));',
              '  },',
              '});',
              '',
              'export const orderMine = query("orderMine", {',
              '  output: s.object({ id: s.string() }),',
              '  async load(input, db: PgDatabase<any, any, any>) {',
              '    const mineId = "u1";',
              '    return db.select({ id: orders.id }).from(orders).where(eq(orders.userId, mineId));',
              '  },',
              '});',
            ].join('\n'),
          },
        ],
      }),
    );

    expect(audit.ownerDomains).toEqual([{ domain: 'order', owner: 'userId' }]);
    // Only the client-arg-keyed read is flagged; the local-var-keyed read emits nothing.
    expect(
      audit.scopeAudits.map((a) => ({ name: a.name, domain: a.domain, scope: a.scope })),
    ).toEqual([{ name: 'order', domain: 'order', scope: 'args' }]);
  });

  // A1 (SPEC §10.3 / KV414): the IDOR gate covers "a query OR write" reaching an
  // owner table. An owner-table mutation keyed by a client arg must emit a
  // `kind:'write'` scope audit so `kovo check` raises KV414 — the write half the
  // producer previously never emitted (hard-coded `kind:'query'`).
  it('A1: emits a kind:write args scope audit for an owner-table mutation keyed by a client arg', () => {
    const audit = extractOwnerAuditFromProject(
      withPgDatabaseTypes({
        files: [
          pgDatabaseTypes(WRITE_DB_METHODS),
          {
            fileName: 'order.mutations.ts',
            source: [
              'import { eq } from "drizzle-orm";',
              'import type { PgDatabase } from "drizzle-orm/pg-core";',
              '',
              'export const orders = pgTable("orders", { id: text("id").primaryKey(), userId: text("user_id").notNull() }, kovo({ domain: "order", key: (t) => t.id, owner: (t) => t.userId }));',
              '',
              'export async function cancelOrder(db: PgDatabase<any, any, any>, input: { id: string }) {',
              '  await db.update(orders).set({ status: "cancelled" }).where(eq(orders.id, input.id));',
              '}',
            ].join('\n'),
          },
        ],
      }),
    );

    expect(audit.ownerDomains).toEqual([{ domain: 'order', owner: 'userId' }]);
    expect(auditScopes(audit)).toContainEqual({ domain: 'order', kind: 'write', scope: 'args' });
  });

  // A1 negative: a write keyed by `req.session.*` is session-scoped (safe), not KV414.
  it('A1: keeps a session-anchored owner-table mutation scope:session (no KV414)', () => {
    const audit = extractOwnerAuditFromProject(
      withPgDatabaseTypes({
        files: [
          pgDatabaseTypes(WRITE_DB_METHODS),
          {
            fileName: 'order.mutations.ts',
            source: [
              'import { eq } from "drizzle-orm";',
              'import type { PgDatabase } from "drizzle-orm/pg-core";',
              '',
              'export const orders = pgTable("orders", { id: text("id").primaryKey(), userId: text("user_id").notNull() }, kovo({ domain: "order", key: (t) => t.id, owner: (t) => t.userId }));',
              '',
              'export async function clearMine(db: PgDatabase<any, any, any>, req: { session: { userId: string } }) {',
              '  await db.delete(orders).where(eq(orders.userId, req.session.userId));',
              '}',
            ].join('\n'),
          },
        ],
      }),
    );

    expect(auditScopes(audit)).toEqual([{ domain: 'order', kind: 'write', scope: 'session' }]);
  });

  // A2 (SPEC §11.1 / KV414): a combinator-wrapped owner read must not disarm the gate.
  // `and(eq(orders.id, input.id), eq(orders.status, "open"))` keys an owner read by a
  // client arg → scope:'args'; a sibling `and(eq(orders.userId, req.session.userId), …)`
  // stays scope:'session'.
  it('A2: an and()-wrapped arg-keyed owner read is scope:args; a session conjunct stays session', () => {
    const audit = extractOwnerAuditFromProject(
      withPgDatabaseTypes({
        files: [
          pgDatabaseTypes([
            'select(value?: unknown): { from(table: unknown): { where(value: unknown): Promise<unknown[]> } };',
          ]),
          {
            fileName: 'order.queries.ts',
            source: [
              'import { and, eq } from "drizzle-orm";',
              'import type { PgDatabase } from "drizzle-orm/pg-core";',
              '',
              'export const orders = pgTable("orders", { id: text("id").primaryKey(), userId: text("user_id").notNull(), status: text("status").notNull() }, kovo({ domain: "order", key: (t) => t.id, owner: (t) => t.userId }));',
              '',
              'export const orderById = query("orderById", {',
              '  output: s.object({ id: s.string() }),',
              '  async load(input: { id: string }, db: PgDatabase<any, any, any>) {',
              '    return db.select({ id: orders.id }).from(orders).where(and(eq(orders.id, input.id), eq(orders.status, "open")));',
              '  },',
              '});',
              '',
              'export const orderMine = query("orderMine", {',
              '  output: s.object({ id: s.string() }),',
              '  async load(_input: unknown, db: PgDatabase<any, any, any>, req: { session: { userId: string } }) {',
              '    return db.select({ id: orders.id }).from(orders).where(and(eq(orders.userId, req.session.userId), eq(orders.status, "open")));',
              '  },',
              '});',
            ].join('\n'),
          },
        ],
      }),
    );

    expect(
      audit.scopeAudits
        .map((a) => ({ name: a.name, scope: a.scope }))
        .sort((x, y) => x.name.localeCompare(y.name)),
    ).toEqual([
      { name: 'orderById', scope: 'args' },
      { name: 'orderMine', scope: 'session' },
    ]);
  });

  // A3 (SPEC §10.3 / KV414): an owner-table arg key escapes detection when it lands on
  // the `owner:` column instead of the declared `key:` column (the canonical case
  // `key:id, owner:userId`). `where(eq(orders.userId, input.userId))` must be scope:'args';
  // `where(eq(orders.userId, req.session.userId))` must stay scope:'session'.
  it('A3: an owner-column arg key (not the declared key column) is scope:args; session stays session', () => {
    const audit = extractOwnerAuditFromProject(
      withPgDatabaseTypes({
        files: [
          pgDatabaseTypes([
            'select(value?: unknown): { from(table: unknown): { where(value: unknown): Promise<unknown[]> } };',
          ]),
          {
            fileName: 'order.queries.ts',
            source: [
              'import { eq } from "drizzle-orm";',
              'import type { PgDatabase } from "drizzle-orm/pg-core";',
              '',
              'export const orders = pgTable("orders", { id: text("id").primaryKey(), userId: text("user_id").notNull() }, kovo({ domain: "order", key: (t) => t.id, owner: (t) => t.userId }));',
              '',
              'export const ordersForUser = query("ordersForUser", {',
              '  output: s.object({ id: s.string() }),',
              '  async load(input: { userId: string }, db: PgDatabase<any, any, any>) {',
              '    return db.select({ id: orders.id }).from(orders).where(eq(orders.userId, input.userId));',
              '  },',
              '});',
              '',
              'export const ordersMine = query("ordersMine", {',
              '  output: s.object({ id: s.string() }),',
              '  async load(_input: unknown, db: PgDatabase<any, any, any>, req: { session: { userId: string } }) {',
              '    return db.select({ id: orders.id }).from(orders).where(eq(orders.userId, req.session.userId));',
              '  },',
              '});',
            ].join('\n'),
          },
        ],
      }),
    );

    expect(
      audit.scopeAudits
        .map((a) => ({ name: a.name, scope: a.scope }))
        .sort((x, y) => x.name.localeCompare(y.name)),
    ).toEqual([
      { name: 'ordersForUser', scope: 'args' },
      { name: 'ordersMine', scope: 'session' },
    ]);
  });
});
