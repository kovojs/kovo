import { describe, expect, it } from 'vitest';

import {
  extractOwnerAuditFromProject,
  scopeAuditsFromQueryFacts,
  type QueryFact,
} from '@kovojs/drizzle/internal/static';
import { pgDatabaseTypes, withPgDatabaseTypes } from './test-helpers.js';

// PgAsyncDatabase surface for write fixtures: `update().set().where()`,
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
  it('extracts ownerDomains + scopeAudits from a project, flagging arg-keyed and unproven owner reads', () => {
    const audit = extractOwnerAuditFromProject(
      withPgDatabaseTypes({
        files: [
          pgDatabaseTypes([
            'select(value?: unknown): { from(table: unknown): { where(value: unknown): Promise<unknown[]> } };',
          ]),
          {
            fileName: 'order.queries.ts',
            source: [
              'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
              '',
              'export const orders = pgTable("orders", { id: text("id").primaryKey(), userId: text("user_id").notNull() }, kovo({ domain: "order", key: (t) => t.id, owner: (t) => t.userId }));',
              '',
              'export const orderById = query("order", {',
              '  output: s.object({ id: s.string() }),',
              '  async load(input, db: PgAsyncDatabase<any, any>) {',
              '    return db.select({ id: orders.id }).from(orders).where(eq(orders.id, input.id));',
              '  },',
              '});',
              '',
              'export const orderMine = query("orderMine", {',
              '  output: s.object({ id: s.string() }),',
              '  async load(input, db: PgAsyncDatabase<any, any>) {',
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
    expect(
      audit.scopeAudits
        .map((a) => ({ name: a.name, domain: a.domain, scope: a.scope }))
        .sort((x, y) => x.name.localeCompare(y.name)),
    ).toEqual([
      { name: 'order', domain: 'order', scope: 'args' },
      { name: 'orderMine', domain: 'order', scope: 'unknown' },
    ]);
    expect(audit.scopeAudits.find((a) => a.name === 'orderMine')?.detail).toContain(
      'narrow Authorization-gates-DATA subset',
    );
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
              'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
              '',
              'export const orders = pgTable("orders", { id: text("id").primaryKey(), userId: text("user_id").notNull() }, kovo({ domain: "order", key: (t) => t.id, owner: (t) => t.userId }));',
              '',
              'export async function cancelOrder(db: PgAsyncDatabase<any, any>, input: { id: string }) {',
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
              'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
              '',
              'export const orders = pgTable("orders", { id: text("id").primaryKey(), userId: text("user_id").notNull() }, kovo({ domain: "order", key: (t) => t.id, owner: (t) => t.userId }));',
              '',
              'export async function clearMine(db: PgAsyncDatabase<any, any>, req: { session: { userId: string } }) {',
              '  await db.delete(orders).where(eq(orders.userId, req.session.userId));',
              '}',
            ].join('\n'),
          },
        ],
      }),
    );

    expect(auditScopes(audit)).toEqual([{ domain: 'order', kind: 'write', scope: 'session' }]);
  });

  // OPP-28 write-side DATA proof: the shared predicate normalizer treats only
  // `inArray(ownerColumn, [same session/principal])` as equality-equivalent for
  // writes too. Non-singleton, mutable, computed, client, or wrong-column forms
  // stay outside the proof subset and fail closed.
  it('OPP-28: proves only singleton inArray owner-column principal write predicates', () => {
    const audit = extractOwnerAuditFromProject(
      withPgDatabaseTypes({
        files: [
          pgDatabaseTypes(WRITE_DB_METHODS),
          {
            fileName: 'order.mutations.ts',
            source: [
              'import { inArray } from "drizzle-orm";',
              'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
              'import { kovoAnalyzerSummary } from "@kovojs/drizzle";',
              '',
              'export const orders = pgTable("orders", { id: text("id").primaryKey(), userId: text("user_id").notNull(), status: text("status").notNull() }, kovo({ domain: "order", key: (t) => t.id, owner: (t) => t.userId }));',
              '',
              'function currentGuardUser(ctx: { guard: { userId: string } }) { return ctx.guard.userId; }',
              'kovoAnalyzerSummary(currentGuardUser, { returns: { kind: "guard", path: "userId" } });',
              '',
              'export async function closeByInput(db: PgAsyncDatabase<any, any>, input: { userId: string }) {',
              '  await db.update(orders).set({ status: "closed" }).where(inArray(orders.userId, [input.userId]));',
              '}',
              '',
              'export async function closeByInputList(db: PgAsyncDatabase<any, any>, input: { userIds: string[] }) {',
              '  await db.update(orders).set({ status: "closed" }).where(inArray(orders.userId, input.userIds));',
              '}',
              '',
              'export async function closeMine(db: PgAsyncDatabase<any, any>, req: { session: { userId: string; otherUserId: string } }) {',
              '  await db.update(orders).set({ status: "closed" }).where(inArray(orders.userId, [req.session.userId]));',
              '}',
              '',
              'export async function closeMineReadonlyTuple(db: PgAsyncDatabase<any, any>, req: { session: { userId: string } }) {',
              '  const principals = [req.session.userId] as const;',
              '  await db.update(orders).set({ status: "closed" }).where(inArray(orders.userId, principals));',
              '}',
              '',
              'export async function closeMineReadonlyObjectTuple(db: PgAsyncDatabase<any, any>, req: { session: { userId: string } }) {',
              '  const principal = { userIds: [req.session.userId] as const } as const;',
              '  await db.update(orders).set({ status: "closed" }).where(inArray(orders.userId, principal.userIds));',
              '}',
              '',
              'export async function closeGuardReadonlyObjectTuple(db: PgAsyncDatabase<any, any>, ctx: { guard: { userId: string } }) {',
              '  const principal = { userIds: [currentGuardUser(ctx)] as const } as const;',
              '  await db.update(orders).set({ status: "closed" }).where(inArray(orders.userId, principal.userIds));',
              '}',
              '',
              'export async function closeMineMutableObjectTuple(db: PgAsyncDatabase<any, any>, req: { session: { userId: string } }) {',
              '  let principal = { userIds: [req.session.userId] as const };',
              '  await db.update(orders).set({ status: "closed" }).where(inArray(orders.userId, principal.userIds));',
              '}',
              '',
              'export async function closeMineMutatedObjectTuple(db: PgAsyncDatabase<any, any>, input: { userId: string }, req: { session: { userId: string } }) {',
              '  const principal = { userIds: [req.session.userId] as const } as const;',
              '  (principal as { userIds: readonly [string] }).userIds = [input.userId] as const;',
              '  await db.update(orders).set({ status: "closed" }).where(inArray(orders.userId, principal.userIds));',
              '}',
              '',
              'export async function closeMineSpreadObjectTuple(db: PgAsyncDatabase<any, any>, req: { session: { userId: string } }, override: { userIds: readonly [string] }) {',
              '  const principal = { userIds: [req.session.userId] as const, ...override } as const;',
              '  await db.update(orders).set({ status: "closed" }).where(inArray(orders.userId, principal.userIds));',
              '}',
              '',
              'export async function closeMineComputedObjectTuple(db: PgAsyncDatabase<any, any>, req: { session: { userId: string } }) {',
              '  const principal = { userIds: [req.session.userId] as const } as const;',
              '  const key = "userIds";',
              '  await db.update(orders).set({ status: "closed" }).where(inArray(orders.userId, principal[key]));',
              '}',
              '',
              'export async function closeByReadonlyObjectTupleSessionId(db: PgAsyncDatabase<any, any>, req: { session: { userId: string } }) {',
              '  const principal = { userIds: [req.session.userId] as const } as const;',
              '  await db.update(orders).set({ status: "closed" }).where(inArray(orders.id, principal.userIds));',
              '}',
              '',
              'export async function closeMineFrozenTuple(db: PgAsyncDatabase<any, any>, req: { session: { userId: string } }) {',
              '  await db.update(orders).set({ status: "closed" }).where(inArray(orders.userId, Object.freeze([req.session.userId] as const)));',
              '}',
              '',
              'export async function closeMineFrozenTupleAlias(db: PgAsyncDatabase<any, any>, req: { session: { userId: string } }) {',
              '  const principals = [req.session.userId] as const;',
              '  await db.update(orders).set({ status: "closed" }).where(inArray(orders.userId, Object.freeze(principals)));',
              '}',
              '',
              'export async function closeMineMutatedReadonlyTuple(db: PgAsyncDatabase<any, any>, input: { userId: string }, req: { session: { userId: string } }) {',
              '  const principals = [req.session.userId] as const;',
              '  (principals as unknown as string[])[0] = input.userId;',
              '  await db.update(orders).set({ status: "closed" }).where(inArray(orders.userId, principals));',
              '}',
              '',
              'export async function closeMineFrozenTupleSpread(db: PgAsyncDatabase<any, any>, req: { session: { userId: string } }) {',
              '  const principals = [req.session.userId] as const;',
              '  await db.update(orders).set({ status: "closed" }).where(inArray(orders.userId, Object.freeze([...principals] as const)));',
              '}',
              '',
              'export async function closeMineShadowedObjectFreeze(db: PgAsyncDatabase<any, any>, req: { session: { userId: string } }) {',
              '  const Object = { freeze<T>(value: T): T { return value; } };',
              '  await db.update(orders).set({ status: "closed" }).where(inArray(orders.userId, Object.freeze([req.session.userId] as const)));',
              '}',
              '',
              'export async function closeMineSessionList(db: PgAsyncDatabase<any, any>, req: { session: { userIds: string[] } }) {',
              '  await db.update(orders).set({ status: "closed" }).where(inArray(orders.userId, req.session.userIds));',
              '}',
              '',
              'export async function closeGuardMine(db: PgAsyncDatabase<any, any>, ctx: { guard: { userId: string } }) {',
              '  await db.update(orders).set({ status: "closed" }).where(inArray(orders.userId, [currentGuardUser(ctx)]));',
              '}',
              '',
              'export async function closeMineMulti(db: PgAsyncDatabase<any, any>, req: { session: { userId: string; otherUserId: string } }) {',
              '  await db.update(orders).set({ status: "closed" }).where(inArray(orders.userId, [req.session.userId, req.session.otherUserId]));',
              '}',
              '',
              'export async function closeMineMixed(db: PgAsyncDatabase<any, any>, input: { userId: string }, req: { session: { userId: string } }) {',
              '  await db.update(orders).set({ status: "closed" }).where(inArray(orders.userId, [req.session.userId, input.userId]));',
              '}',
              '',
              'export async function closeBySessionId(db: PgAsyncDatabase<any, any>, req: { session: { userId: string } }) {',
              '  await db.update(orders).set({ status: "closed" }).where(inArray(orders.id, [req.session.userId]));',
              '}',
              '',
              'export async function closeByReadonlyTupleSessionId(db: PgAsyncDatabase<any, any>, req: { session: { userId: string } }) {',
              '  const principals = [req.session.userId] as const;',
              '  await db.update(orders).set({ status: "closed" }).where(inArray(orders.id, principals));',
              '}',
              '',
              'export async function closeMineMutable(db: PgAsyncDatabase<any, any>, req: { session: { userId: string } }) {',
              '  let principals = [req.session.userId];',
              '  await db.update(orders).set({ status: "closed" }).where(inArray(orders.userId, principals));',
              '}',
              '',
              'export async function closeMineComputed(db: PgAsyncDatabase<any, any>, req: { session: { userId: string } }) {',
              '  await db.update(orders).set({ status: "closed" }).where(inArray(orders.userId, Array.of(req.session.userId)));',
              '}',
              '',
              'export async function closeMineShadowedArrayOf(db: PgAsyncDatabase<any, any>, req: { session: { userId: string } }) {',
              '  const Array = { of<T>(value: T): T[] { return [value]; } };',
              '  await db.update(orders).set({ status: "closed" }).where(inArray(orders.userId, Array.of(req.session.userId)));',
              '}',
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
      { name: 'closeByInput', scope: 'args' },
      { name: 'closeByInputList', scope: 'args' },
      { name: 'closeByReadonlyObjectTupleSessionId', scope: 'unknown' },
      { name: 'closeByReadonlyTupleSessionId', scope: 'unknown' },
      { name: 'closeBySessionId', scope: 'unknown' },
      { name: 'closeGuardMine', scope: 'session' },
      { name: 'closeGuardReadonlyObjectTuple', scope: 'session' },
      { name: 'closeMine', scope: 'session' },
      { name: 'closeMineComputed', scope: 'session' },
      { name: 'closeMineComputedObjectTuple', scope: 'unknown' },
      { name: 'closeMineFrozenTuple', scope: 'session' },
      { name: 'closeMineFrozenTupleAlias', scope: 'session' },
      { name: 'closeMineFrozenTupleSpread', scope: 'unknown' },
      { name: 'closeMineMixed', scope: 'unknown' },
      { name: 'closeMineMulti', scope: 'unknown' },
      { name: 'closeMineMutable', scope: 'unknown' },
      { name: 'closeMineMutableObjectTuple', scope: 'unknown' },
      { name: 'closeMineMutatedObjectTuple', scope: 'unknown' },
      { name: 'closeMineMutatedReadonlyTuple', scope: 'unknown' },
      { name: 'closeMineReadonlyObjectTuple', scope: 'session' },
      { name: 'closeMineReadonlyTuple', scope: 'session' },
      { name: 'closeMineSessionList', scope: 'unknown' },
      { name: 'closeMineShadowedArrayOf', scope: 'unknown' },
      { name: 'closeMineShadowedObjectFreeze', scope: 'unknown' },
      { name: 'closeMineSpreadObjectTuple', scope: 'unknown' },
    ]);
    expect(audit.scopeAudits.find((a) => a.name === 'closeMine')?.detail).toContain(
      'owner column compared to session:userId',
    );
    expect(audit.scopeAudits.find((a) => a.name === 'closeGuardMine')?.detail).toContain(
      'owner column compared to guard:userId',
    );
  });

  it('OPP-28: treats non-equality write predicates as args without proving session scope', () => {
    const audit = extractOwnerAuditFromProject(
      withPgDatabaseTypes({
        files: [
          pgDatabaseTypes(WRITE_DB_METHODS),
          {
            fileName: 'order.mutations.ts',
            source: [
              'import { between, gt, gte, inArray, lt, lte, ne, not, notInArray, eq } from "drizzle-orm";',
              'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
              'import { kovoAnalyzerSummary } from "@kovojs/drizzle";',
              '',
              'export const orders = pgTable("orders", { id: text("id").primaryKey(), userId: text("user_id").notNull(), status: text("status").notNull() }, kovo({ domain: "order", key: (t) => t.id, owner: (t) => t.userId }));',
              '',
              'function currentGuardUser(ctx: { guard: { userId: string } }) { return ctx.guard.userId; }',
              'kovoAnalyzerSummary(currentGuardUser, { returns: { kind: "guard", path: "userId" } });',
              '',
              'export async function closeExceptInput(db: PgAsyncDatabase<any, any>, input: { userId: string }) {',
              '  await db.update(orders).set({ status: "closed" }).where(ne(orders.userId, input.userId));',
              '}',
              '',
              'export async function closeNotInput(db: PgAsyncDatabase<any, any>, input: { userId: string }) {',
              '  await db.update(orders).set({ status: "closed" }).where(not(eq(orders.userId, input.userId)));',
              '}',
              '',
              'export async function closeNotInInput(db: PgAsyncDatabase<any, any>, input: { userId: string }) {',
              '  await db.update(orders).set({ status: "closed" }).where(not(inArray(orders.userId, [input.userId])));',
              '}',
              '',
              'export async function closeNotInArrayInput(db: PgAsyncDatabase<any, any>, input: { userId: string }) {',
              '  await db.update(orders).set({ status: "closed" }).where(notInArray(orders.userId, [input.userId]));',
              '}',
              '',
              'export async function closeNotInArrayInputList(db: PgAsyncDatabase<any, any>, input: { userIds: string[] }) {',
              '  await db.update(orders).set({ status: "closed" }).where(notInArray(orders.userId, input.userIds));',
              '}',
              '',
              'export async function closeNotInMixed(db: PgAsyncDatabase<any, any>, input: { userId: string }, req: { session: { userId: string } }) {',
              '  await db.update(orders).set({ status: "closed" }).where(not(inArray(orders.userId, [req.session.userId, input.userId])));',
              '}',
              '',
              'export async function closeNotInMine(db: PgAsyncDatabase<any, any>, req: { session: { userId: string } }) {',
              '  await db.update(orders).set({ status: "closed" }).where(not(inArray(orders.userId, [req.session.userId])));',
              '}',
              '',
              'export async function closeNotInGuard(db: PgAsyncDatabase<any, any>, ctx: { guard: { userId: string } }) {',
              '  await db.update(orders).set({ status: "closed" }).where(notInArray(orders.userId, [currentGuardUser(ctx)]));',
              '}',
              '',
              'export async function closeNotInArrayMineList(db: PgAsyncDatabase<any, any>, req: { session: { userIds: string[] } }) {',
              '  await db.update(orders).set({ status: "closed" }).where(notInArray(orders.userId, req.session.userIds));',
              '}',
              '',
              'export async function closeExceptMine(db: PgAsyncDatabase<any, any>, req: { session: { userId: string } }) {',
              '  await db.update(orders).set({ status: "closed" }).where(ne(orders.userId, req.session.userId));',
              '}',
              '',
              'export async function closeGtInput(db: PgAsyncDatabase<any, any>, input: { userId: string }) {',
              '  await db.update(orders).set({ status: "closed" }).where(gt(orders.userId, input.userId));',
              '}',
              '',
              'export async function closeNotGtInput(db: PgAsyncDatabase<any, any>, input: { userId: string }) {',
              '  await db.update(orders).set({ status: "closed" }).where(not(gt(orders.userId, input.userId)));',
              '}',
              '',
              'export async function closeGteMine(db: PgAsyncDatabase<any, any>, req: { session: { userId: string } }) {',
              '  await db.update(orders).set({ status: "closed" }).where(gte(orders.userId, req.session.userId));',
              '}',
              '',
              'export async function closeNotGteMine(db: PgAsyncDatabase<any, any>, req: { session: { userId: string } }) {',
              '  await db.update(orders).set({ status: "closed" }).where(not(gte(orders.userId, req.session.userId)));',
              '}',
              '',
              'export async function closeLtInput(db: PgAsyncDatabase<any, any>, input: { userId: string }) {',
              '  await db.update(orders).set({ status: "closed" }).where(lt(orders.userId, input.userId));',
              '}',
              '',
              'export async function closeLteMine(db: PgAsyncDatabase<any, any>, req: { session: { userId: string } }) {',
              '  await db.update(orders).set({ status: "closed" }).where(lte(orders.userId, req.session.userId));',
              '}',
              '',
              'export async function closeBetweenInput(db: PgAsyncDatabase<any, any>, input: { lowerUserId: string; upperUserId: string }) {',
              '  await db.update(orders).set({ status: "closed" }).where(between(orders.userId, input.lowerUserId, input.upperUserId));',
              '}',
              '',
              'export async function closeNotBetweenInput(db: PgAsyncDatabase<any, any>, input: { lowerUserId: string; upperUserId: string }) {',
              '  await db.update(orders).set({ status: "closed" }).where(not(between(orders.userId, input.lowerUserId, input.upperUserId)));',
              '}',
              '',
              'export async function closeBetweenMine(db: PgAsyncDatabase<any, any>, req: { session: { userId: string; otherUserId: string } }) {',
              '  await db.update(orders).set({ status: "closed" }).where(between(orders.userId, req.session.userId, req.session.otherUserId));',
              '}',
              '',
              'export async function closeNotBetweenMine(db: PgAsyncDatabase<any, any>, req: { session: { userId: string; otherUserId: string } }) {',
              '  await db.update(orders).set({ status: "closed" }).where(not(between(orders.userId, req.session.userId, req.session.otherUserId)));',
              '}',
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
      { name: 'closeBetweenInput', scope: 'args' },
      { name: 'closeBetweenInput', scope: 'args' },
      { name: 'closeBetweenMine', scope: 'unknown' },
      { name: 'closeExceptInput', scope: 'args' },
      { name: 'closeExceptMine', scope: 'unknown' },
      { name: 'closeGteMine', scope: 'unknown' },
      { name: 'closeGtInput', scope: 'args' },
      { name: 'closeLteMine', scope: 'unknown' },
      { name: 'closeLtInput', scope: 'args' },
      { name: 'closeNotBetweenInput', scope: 'args' },
      { name: 'closeNotBetweenInput', scope: 'args' },
      { name: 'closeNotBetweenMine', scope: 'unknown' },
      { name: 'closeNotGteMine', scope: 'unknown' },
      { name: 'closeNotGtInput', scope: 'args' },
      { name: 'closeNotInArrayInput', scope: 'args' },
      { name: 'closeNotInArrayInputList', scope: 'args' },
      { name: 'closeNotInArrayMineList', scope: 'unknown' },
      { name: 'closeNotInGuard', scope: 'unknown' },
      { name: 'closeNotInInput', scope: 'args' },
      { name: 'closeNotInMine', scope: 'unknown' },
      { name: 'closeNotInMixed', scope: 'args' },
      { name: 'closeNotInput', scope: 'args' },
    ]);
    expect(audit.scopeAudits.find((a) => a.name === 'closeExceptMine')?.detail).toContain(
      'no owner-column session/principal predicate was proven',
    );
    expect(audit.scopeAudits.find((a) => a.name === 'closeGteMine')?.detail).toContain(
      'no owner-column session/principal predicate was proven',
    );
    expect(audit.scopeAudits.find((a) => a.name === 'closeNotGteMine')?.detail).toContain(
      'no owner-column session/principal predicate was proven',
    );
  });

  // H5 (SPEC §6.5/§10.3, KV414 IDOR): a NESTED client-input value whose field name happens
  // to be `session`/`guard` (`input.session.userId`) is byte-identical in shape/type to the
  // trusted `req.session.userId` above — but it is client-controlled, so the owner predicate
  // must surface scope:args (KV414), never be laundered into the safe scope:session branch.
  it('A1: flags an owner-table mutation keyed by a nested input.session/guard value scope:args (H5)', () => {
    for (const value of ['input.session.userId', 'input.guard.userId']) {
      const audit = extractOwnerAuditFromProject(
        withPgDatabaseTypes({
          files: [
            pgDatabaseTypes(WRITE_DB_METHODS),
            {
              fileName: 'order.mutations.ts',
              source: [
                'import { eq } from "drizzle-orm";',
                'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
                '',
                'export const orders = pgTable("orders", { id: text("id").primaryKey(), userId: text("user_id").notNull() }, kovo({ domain: "order", key: (t) => t.id, owner: (t) => t.userId }));',
                '',
                'export async function delMine(db: PgAsyncDatabase<any, any>, input: { session: { userId: string }; guard: { userId: string } }) {',
                `  await db.delete(orders).where(eq(orders.userId, ${value}));`,
                '}',
              ].join('\n'),
            },
          ],
        }),
      );

      expect(auditScopes(audit)).toEqual([{ domain: 'order', kind: 'write', scope: 'args' }]);
    }
  });

  it('accepts a write guarded by a summarized principal on the owner-column predicate', () => {
    const audit = extractOwnerAuditFromProject(
      withPgDatabaseTypes({
        files: [
          pgDatabaseTypes(WRITE_DB_METHODS),
          {
            fileName: 'order.mutations.ts',
            source: [
              'import { eq } from "drizzle-orm";',
              'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
              'import { kovoAnalyzerSummary } from "@kovojs/drizzle";',
              '',
              'export const orders = pgTable("orders", { id: text("id").primaryKey(), userId: text("user_id").notNull(), status: text("status").notNull() }, kovo({ domain: "order", key: (t) => t.id, owner: (t) => t.userId }));',
              '',
              'function currentGuardUser(ctx: { guard: { userId: string } }) { return ctx.guard.userId; }',
              'kovoAnalyzerSummary(currentGuardUser, { returns: { kind: "guard", path: "userId" } });',
              '',
              'export async function cancelMine(db: PgAsyncDatabase<any, any>, ctx: { guard: { userId: string } }) {',
              '  await db.update(orders).set({ status: "cancelled" }).where(eq(orders.userId, currentGuardUser(ctx)));',
              '}',
            ].join('\n'),
          },
        ],
      }),
    );

    expect(
      audit.scopeAudits.map((a) => ({
        detail: a.detail,
        domain: a.domain,
        kind: a.kind,
        scope: a.scope,
      })),
    ).toEqual([
      {
        detail:
          'narrow Authorization-gates-DATA subset: owner=userId; owner column compared to guard:userId',
        domain: 'order',
        kind: 'write',
        scope: 'session',
      },
    ]);
  });

  it('keeps a write with a mismatched session predicate scope:unknown', () => {
    const audit = extractOwnerAuditFromProject(
      withPgDatabaseTypes({
        files: [
          pgDatabaseTypes(WRITE_DB_METHODS),
          {
            fileName: 'order.mutations.ts',
            source: [
              'import { eq } from "drizzle-orm";',
              'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
              '',
              'export const orders = pgTable("orders", { id: text("id").primaryKey(), userId: text("user_id").notNull() }, kovo({ domain: "order", key: (t) => t.id, owner: (t) => t.userId }));',
              '',
              'export async function cancelBySessionId(db: PgAsyncDatabase<any, any>, req: { session: { userId: string } }) {',
              '  await db.update(orders).set({ status: "cancelled" }).where(eq(orders.id, req.session.userId));',
              '}',
            ].join('\n'),
          },
        ],
      }),
    );

    expect(
      audit.scopeAudits.map((a) => ({
        detail: a.detail,
        domain: a.domain,
        kind: a.kind,
        scope: a.scope,
      })),
    ).toEqual([
      {
        detail:
          'narrow Authorization-gates-DATA subset: owner=userId; session predicate does not compare the owner column to the matching session/principal symbol',
        domain: 'order',
        kind: 'write',
        scope: 'unknown',
      },
    ]);
  });

  it('keeps a write with an unsummarized guard helper scope:unknown', () => {
    const audit = extractOwnerAuditFromProject(
      withPgDatabaseTypes({
        files: [
          pgDatabaseTypes(WRITE_DB_METHODS),
          {
            fileName: 'order.mutations.ts',
            source: [
              'import { eq } from "drizzle-orm";',
              'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
              '',
              'export const orders = pgTable("orders", { id: text("id").primaryKey(), userId: text("user_id").notNull() }, kovo({ domain: "order", key: (t) => t.id, owner: (t) => t.userId }));',
              '',
              'function currentGuardUser(ctx: { guard: { userId: string } }) { return ctx.guard.userId; }',
              '',
              'export async function cancelMine(db: PgAsyncDatabase<any, any>, ctx: { guard: { userId: string } }) {',
              '  await db.update(orders).set({ status: "cancelled" }).where(eq(orders.userId, currentGuardUser(ctx)));',
              '}',
            ].join('\n'),
          },
        ],
      }),
    );

    expect(auditScopes(audit)).toEqual([{ domain: 'order', kind: 'write', scope: 'unknown' }]);
  });

  it('flags scope:args for an owner-table write keyed only through a non-owner table arg', () => {
    const audit = extractOwnerAuditFromProject(
      withPgDatabaseTypes({
        files: [
          pgDatabaseTypes([
            'update(table: unknown): { set(value: unknown): { from(table: unknown): { where(value: unknown): Promise<void> } } };',
          ]),
          {
            fileName: 'order.mutations.ts',
            source: [
              'import { eq } from "drizzle-orm";',
              'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
              '',
              'export const orders = pgTable("orders", { id: text("id").primaryKey(), userId: text("user_id").notNull(), status: text("status").notNull() }, kovo({ domain: "order", key: (t) => t.id, owner: (t) => t.userId }));',
              'export const items = pgTable("items", { id: text("id").primaryKey(), orderId: text("order_id").notNull() }, kovo({ domain: "item", key: (t) => t.id }));',
              '',
              'export async function closeOrderViaItem(db: PgAsyncDatabase<any, any>, input: { itemId: string }) {',
              '  await db.update(orders).set({ status: "closed" }).from(items).where(eq(items.id, input.itemId));',
              '}',
            ].join('\n'),
          },
        ],
      }),
    );

    expect(auditScopes(audit)).toEqual([{ domain: 'order', kind: 'write', scope: 'args' }]);
  });

  it('keeps a from-bearing owner write scope:session when the owner table is session-scoped', () => {
    const audit = extractOwnerAuditFromProject(
      withPgDatabaseTypes({
        files: [
          pgDatabaseTypes([
            'update(table: unknown): { set(value: unknown): { from(table: unknown): { where(value: unknown): Promise<void> } } };',
          ]),
          {
            fileName: 'order.mutations.ts',
            source: [
              'import { and, eq } from "drizzle-orm";',
              'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
              '',
              'export const orders = pgTable("orders", { id: text("id").primaryKey(), userId: text("user_id").notNull(), status: text("status").notNull() }, kovo({ domain: "order", key: (t) => t.id, owner: (t) => t.userId }));',
              'export const items = pgTable("items", { id: text("id").primaryKey(), orderId: text("order_id").notNull() }, kovo({ domain: "item", key: (t) => t.id }));',
              '',
              'export async function closeMyOrderViaItem(db: PgAsyncDatabase<any, any>, input: { itemId: string }, req: { session: { userId: string } }) {',
              '  await db.update(orders).set({ status: "closed" }).from(items).where(and(eq(orders.userId, req.session.userId), eq(items.id, input.itemId)));',
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
              'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
              '',
              'export const orders = pgTable("orders", { id: text("id").primaryKey(), userId: text("user_id").notNull(), status: text("status").notNull() }, kovo({ domain: "order", key: (t) => t.id, owner: (t) => t.userId }));',
              '',
              'export const orderById = query("orderById", {',
              '  output: s.object({ id: s.string() }),',
              '  async load(input: { id: string }, db: PgAsyncDatabase<any, any>) {',
              '    return db.select({ id: orders.id }).from(orders).where(and(eq(orders.id, input.id), eq(orders.status, "open")));',
              '  },',
              '});',
              '',
              'export const orderMine = query("orderMine", {',
              '  output: s.object({ id: s.string() }),',
              '  async load(_input: unknown, db: PgAsyncDatabase<any, any>, req: { session: { userId: string } }) {',
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
              'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
              '',
              'export const orders = pgTable("orders", { id: text("id").primaryKey(), userId: text("user_id").notNull() }, kovo({ domain: "order", key: (t) => t.id, owner: (t) => t.userId }));',
              '',
              'export const ordersForUser = query("ordersForUser", {',
              '  output: s.object({ id: s.string() }),',
              '  async load(input: { userId: string }, db: PgAsyncDatabase<any, any>) {',
              '    return db.select({ id: orders.id }).from(orders).where(eq(orders.userId, input.userId));',
              '  },',
              '});',
              '',
              'export const ordersMine = query("ordersMine", {',
              '  output: s.object({ id: s.string() }),',
              '  async load(_input: unknown, db: PgAsyncDatabase<any, any>, req: { session: { userId: string } }) {',
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

  it('OPP-28: uses static relational query where predicates for owner-column proof', () => {
    const audit = extractOwnerAuditFromProject(
      withPgDatabaseTypes({
        files: [
          pgDatabaseTypes([
            'query: { orders: { findMany(value?: unknown): Promise<unknown[]>; findFirst(value?: unknown): Promise<unknown> } };',
          ]),
          {
            fileName: 'order.queries.ts',
            source: [
              'import { eq } from "drizzle-orm";',
              'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
              '',
              'export const orders = pgTable("orders", { id: text("id").primaryKey(), userId: text("user_id").notNull(), status: text("status").notNull() }, kovo({ domain: "order", key: (t) => t.id, owner: (t) => t.userId }));',
              '',
              'export const relationalOrdersMine = query("relationalOrdersMine", {',
              '  output: s.object({ id: s.string() }),',
              '  async load(_input: unknown, db: PgAsyncDatabase<any, any>, req: { session: { userId: string } }) {',
              '    return db.query.orders.findMany({ columns: { id: true }, where: eq(orders.userId, req.session.userId) });',
              '  },',
              '});',
              '',
              'export const relationalOrdersCallbackMine = query("relationalOrdersCallbackMine", {',
              '  output: s.object({ id: s.string() }),',
              '  async load(_input: unknown, db: PgAsyncDatabase<any, any>, req: { session: { userId: string } }) {',
              '    return db.query.orders.findMany({ columns: { id: true }, where: (order, { eq }) => eq(order.userId, req.session.userId) });',
              '  },',
              '});',
              '',
              'export const relationalOrdersCallbackBlockMine = query("relationalOrdersCallbackBlockMine", {',
              '  output: s.object({ id: s.string() }),',
              '  async load(_input: unknown, db: PgAsyncDatabase<any, any>, req: { session: { userId: string } }) {',
              '    return db.query.orders.findFirst({ columns: { id: true }, where: (order, { eq }) => { return eq(order.userId, req.session.userId); } });',
              '  },',
              '});',
              '',
              'export const relationalOrdersWrongColumn = query("relationalOrdersWrongColumn", {',
              '  output: s.object({ id: s.string() }),',
              '  async load(_input: unknown, db: PgAsyncDatabase<any, any>, req: { session: { userId: string } }) {',
              '    return db.query.orders.findMany({ columns: { id: true }, where: eq(orders.id, req.session.userId) });',
              '  },',
              '});',
              '',
              'export const relationalOrdersCallbackWrongColumn = query("relationalOrdersCallbackWrongColumn", {',
              '  output: s.object({ id: s.string() }),',
              '  async load(_input: unknown, db: PgAsyncDatabase<any, any>, req: { session: { userId: string } }) {',
              '    return db.query.orders.findMany({ columns: { id: true }, where: (order, { eq }) => eq(order.id, req.session.userId) });',
              '  },',
              '});',
              '',
              'export const relationalOrdersCallbackOpaque = query("relationalOrdersCallbackOpaque", {',
              '  output: s.object({ id: s.string() }),',
              '  async load(_input: unknown, db: PgAsyncDatabase<any, any>, req: { session: { userId: string } }) {',
              '    return db.query.orders.findMany({ columns: { id: true }, where: (order, { eq }) => { const owner = order.userId; return eq(owner, req.session.userId); } });',
              '  },',
              '});',
              '',
              'export const relationalOrdersCallbackRenamedOperatorMine = query("relationalOrdersCallbackRenamedOperatorMine", {',
              '  output: s.object({ id: s.string() }),',
              '  async load(_input: unknown, db: PgAsyncDatabase<any, any>, req: { session: { userId: string } }) {',
              '    return db.query.orders.findMany({ columns: { id: true }, where: (order, { and: both, eq: equals }) => both(equals(order.userId, req.session.userId), equals(order.status, "active")) });',
              '  },',
              '});',
              '',
              'export const relationalOrdersCallbackRenamedOperatorWrongColumn = query("relationalOrdersCallbackRenamedOperatorWrongColumn", {',
              '  output: s.object({ id: s.string() }),',
              '  async load(_input: unknown, db: PgAsyncDatabase<any, any>, req: { session: { userId: string } }) {',
              '    return db.query.orders.findMany({ columns: { id: true }, where: (order, { eq: equals }) => equals(order.id, req.session.userId) });',
              '  },',
              '});',
              '',
              'export const relationalOrdersDestructuredTableMine = query("relationalOrdersDestructuredTableMine", {',
              '  output: s.object({ id: s.string() }),',
              '  async load(_input: unknown, db: PgAsyncDatabase<any, any>, req: { session: { userId: string } }) {',
              '    return db.query.orders.findMany({ columns: { id: true }, where: ({ userId }, { eq }) => eq(userId, req.session.userId) });',
              '  },',
              '});',
              '',
              'export const relationalOrdersRenamedTableColumnMine = query("relationalOrdersRenamedTableColumnMine", {',
              '  output: s.object({ id: s.string() }),',
              '  async load(_input: unknown, db: PgAsyncDatabase<any, any>, req: { session: { userId: string } }) {',
              '    return db.query.orders.findMany({ columns: { id: true }, where: ({ userId: ownerId }, { eq }) => eq(ownerId, req.session.userId) });',
              '  },',
              '});',
              '',
              'export const relationalOrdersDefaultedTableColumn = query("relationalOrdersDefaultedTableColumn", {',
              '  output: s.object({ id: s.string() }),',
              '  async load(_input: unknown, db: PgAsyncDatabase<any, any>, req: { session: { userId: string } }) {',
              '    return db.query.orders.findMany({ columns: { id: true }, where: ({ userId = orders.userId }, { eq }) => eq(userId, req.session.userId) });',
              '  },',
              '});',
              '',
              'export const relationalOrdersOperatorBagMine = query("relationalOrdersOperatorBagMine", {',
              '  output: s.object({ id: s.string() }),',
              '  async load(_input: unknown, db: PgAsyncDatabase<any, any>, req: { session: { userId: string } }) {',
              '    return db.query.orders.findMany({ columns: { id: true }, where: (order, ops) => ops.eq(order.userId, req.session.userId) });',
              '  },',
              '});',
              '',
              'export const relationalOrdersOperatorBagBracketMine = query("relationalOrdersOperatorBagBracketMine", {',
              '  output: s.object({ id: s.string() }),',
              '  async load(_input: unknown, db: PgAsyncDatabase<any, any>, req: { session: { userId: string } }) {',
              '    return db.query.orders.findMany({ columns: { id: true }, where: (order, ops) => ops["eq"](order.userId, req.session.userId) });',
              '  },',
              '});',
              '',
              'export const relationalOrdersOperatorBagShadowed = query("relationalOrdersOperatorBagShadowed", {',
              '  output: s.object({ id: s.string() }),',
              '  async load(_input: unknown, db: PgAsyncDatabase<any, any>, req: { session: { userId: string } }) {',
              '    return db.query.orders.findMany({ columns: { id: true }, where: (order, ops) => { const shadow = { eq: ops.eq }; return shadow.eq(order.userId, req.session.userId); } });',
              '  },',
              '});',
            ].join('\n'),
          },
        ],
      }),
    );

    expect(
      audit.scopeAudits
        .map((a) => ({
          detail: a.detail,
          domain: a.domain,
          name: a.name,
          scope: a.scope,
        }))
        .sort((x, y) => x.name.localeCompare(y.name)),
    ).toEqual([
      {
        detail:
          'narrow Authorization-gates-DATA subset: owner=userId; owner column compared to session:userId',
        domain: 'order',
        name: 'relationalOrdersCallbackBlockMine',
        scope: 'session',
      },
      {
        detail:
          'narrow Authorization-gates-DATA subset: owner=userId; owner column compared to session:userId',
        domain: 'order',
        name: 'relationalOrdersCallbackMine',
        scope: 'session',
      },
      {
        detail:
          'narrow Authorization-gates-DATA subset: owner=userId; no owner-column session/principal predicate was proven',
        domain: 'order',
        name: 'relationalOrdersCallbackOpaque',
        scope: 'unknown',
      },
      {
        detail:
          'narrow Authorization-gates-DATA subset: owner=userId; owner column compared to session:userId',
        domain: 'order',
        name: 'relationalOrdersCallbackRenamedOperatorMine',
        scope: 'session',
      },
      {
        detail:
          'narrow Authorization-gates-DATA subset: owner=userId; session predicate does not compare the owner column to the matching session/principal symbol',
        domain: 'order',
        name: 'relationalOrdersCallbackRenamedOperatorWrongColumn',
        scope: 'unknown',
      },
      {
        detail:
          'narrow Authorization-gates-DATA subset: owner=userId; session predicate does not compare the owner column to the matching session/principal symbol',
        domain: 'order',
        name: 'relationalOrdersCallbackWrongColumn',
        scope: 'unknown',
      },
      {
        detail:
          'narrow Authorization-gates-DATA subset: owner=userId; no owner-column session/principal predicate was proven',
        domain: 'order',
        name: 'relationalOrdersDefaultedTableColumn',
        scope: 'unknown',
      },
      {
        detail:
          'narrow Authorization-gates-DATA subset: owner=userId; owner column compared to session:userId',
        domain: 'order',
        name: 'relationalOrdersDestructuredTableMine',
        scope: 'session',
      },
      {
        detail:
          'narrow Authorization-gates-DATA subset: owner=userId; owner column compared to session:userId',
        domain: 'order',
        name: 'relationalOrdersMine',
        scope: 'session',
      },
      {
        detail:
          'narrow Authorization-gates-DATA subset: owner=userId; owner column compared to session:userId',
        domain: 'order',
        name: 'relationalOrdersOperatorBagBracketMine',
        scope: 'session',
      },
      {
        detail:
          'narrow Authorization-gates-DATA subset: owner=userId; owner column compared to session:userId',
        domain: 'order',
        name: 'relationalOrdersOperatorBagMine',
        scope: 'session',
      },
      {
        detail:
          'narrow Authorization-gates-DATA subset: owner=userId; no owner-column session/principal predicate was proven',
        domain: 'order',
        name: 'relationalOrdersOperatorBagShadowed',
        scope: 'unknown',
      },
      {
        detail:
          'narrow Authorization-gates-DATA subset: owner=userId; owner column compared to session:userId',
        domain: 'order',
        name: 'relationalOrdersRenamedTableColumnMine',
        scope: 'session',
      },
      {
        detail:
          'narrow Authorization-gates-DATA subset: owner=userId; session predicate does not compare the owner column to the matching session/principal symbol',
        domain: 'order',
        name: 'relationalOrdersWrongColumn',
        scope: 'unknown',
      },
    ]);
  });

  // OPP-28 narrow DATA subset: `inArray(ownerColumn, [principal])` is equality-equivalent
  // only for a literal singleton array. Larger, mixed, mutable, computed, or mismatched
  // predicates stay outside the proof subset instead of being laundered into `session`.
  it('OPP-28: proves only singleton inArray owner-column principal predicates', () => {
    const audit = extractOwnerAuditFromProject(
      withPgDatabaseTypes({
        files: [
          pgDatabaseTypes([
            'select(value?: unknown): { from(table: unknown): { where(value: unknown): Promise<unknown[]> } };',
          ]),
          {
            fileName: 'order.queries.ts',
            source: [
              'import { inArray } from "drizzle-orm";',
              'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
              '',
              'export const orders = pgTable("orders", { id: text("id").primaryKey(), userId: text("user_id").notNull() }, kovo({ domain: "order", key: (t) => t.id, owner: (t) => t.userId }));',
              '',
              'export const orderByInput = query("orderByInput", {',
              '  output: s.object({ id: s.string() }),',
              '  async load(input: { userId: string }, db: PgAsyncDatabase<any, any>) {',
              '    return db.select({ id: orders.id }).from(orders).where(inArray(orders.userId, [input.userId]));',
              '  },',
              '});',
              '',
              'export const orderByInputList = query("orderByInputList", {',
              '  output: s.object({ id: s.string() }),',
              '  async load(input: { userIds: string[] }, db: PgAsyncDatabase<any, any>) {',
              '    return db.select({ id: orders.id }).from(orders).where(inArray(orders.userId, input.userIds));',
              '  },',
              '});',
              '',
              'export const ordersMine = query("ordersMine", {',
              '  output: s.object({ id: s.string() }),',
              '  async load(_input: unknown, db: PgAsyncDatabase<any, any>, req: { session: { userId: string; otherUserId: string } }) {',
              '    return db.select({ id: orders.id }).from(orders).where(inArray(orders.userId, [req.session.userId]));',
              '  },',
              '});',
              '',
              'export const ordersMineReadonlyTuple = query("ordersMineReadonlyTuple", {',
              '  output: s.object({ id: s.string() }),',
              '  async load(_input: unknown, db: PgAsyncDatabase<any, any>, req: { session: { userId: string } }) {',
              '    const principals = [req.session.userId] as const;',
              '    return db.select({ id: orders.id }).from(orders).where(inArray(orders.userId, principals));',
              '  },',
              '});',
              '',
              'export const ordersMineFrozenTuple = query("ordersMineFrozenTuple", {',
              '  output: s.object({ id: s.string() }),',
              '  async load(_input: unknown, db: PgAsyncDatabase<any, any>, req: { session: { userId: string } }) {',
              '    return db.select({ id: orders.id }).from(orders).where(inArray(orders.userId, Object.freeze([req.session.userId] as const)));',
              '  },',
              '});',
              '',
              'export const ordersMineFrozenTupleAlias = query("ordersMineFrozenTupleAlias", {',
              '  output: s.object({ id: s.string() }),',
              '  async load(_input: unknown, db: PgAsyncDatabase<any, any>, req: { session: { userId: string } }) {',
              '    const principals = [req.session.userId] as const;',
              '    return db.select({ id: orders.id }).from(orders).where(inArray(orders.userId, Object.freeze(principals)));',
              '  },',
              '});',
              '',
              'export const ordersMineMutatedReadonlyTuple = query("ordersMineMutatedReadonlyTuple", {',
              '  output: s.object({ id: s.string() }),',
              '  async load(input: { userId: string }, db: PgAsyncDatabase<any, any>, req: { session: { userId: string } }) {',
              '    const principals = [req.session.userId] as const;',
              '    (principals as unknown as string[])[0] = input.userId;',
              '    return db.select({ id: orders.id }).from(orders).where(inArray(orders.userId, principals));',
              '  },',
              '});',
              '',
              'export const ordersMineFrozenTupleSpread = query("ordersMineFrozenTupleSpread", {',
              '  output: s.object({ id: s.string() }),',
              '  async load(_input: unknown, db: PgAsyncDatabase<any, any>, req: { session: { userId: string } }) {',
              '    const principals = [req.session.userId] as const;',
              '    return db.select({ id: orders.id }).from(orders).where(inArray(orders.userId, Object.freeze([...principals] as const)));',
              '  },',
              '});',
              '',
              'export const ordersMineShadowedObjectFreeze = query("ordersMineShadowedObjectFreeze", {',
              '  output: s.object({ id: s.string() }),',
              '  async load(_input: unknown, db: PgAsyncDatabase<any, any>, req: { session: { userId: string } }) {',
              '    const Object = { freeze<T>(value: T): T { return value; } };',
              '    return db.select({ id: orders.id }).from(orders).where(inArray(orders.userId, Object.freeze([req.session.userId] as const)));',
              '  },',
              '});',
              '',
              'export const ordersMineSessionList = query("ordersMineSessionList", {',
              '  output: s.object({ id: s.string() }),',
              '  async load(_input: unknown, db: PgAsyncDatabase<any, any>, req: { session: { userIds: string[] } }) {',
              '    return db.select({ id: orders.id }).from(orders).where(inArray(orders.userId, req.session.userIds));',
              '  },',
              '});',
              '',
              'export const ordersMineMulti = query("ordersMineMulti", {',
              '  output: s.object({ id: s.string() }),',
              '  async load(_input: unknown, db: PgAsyncDatabase<any, any>, req: { session: { userId: string; otherUserId: string } }) {',
              '    return db.select({ id: orders.id }).from(orders).where(inArray(orders.userId, [req.session.userId, req.session.otherUserId]));',
              '  },',
              '});',
              '',
              'export const ordersMineMixed = query("ordersMineMixed", {',
              '  output: s.object({ id: s.string() }),',
              '  async load(input: { userId: string }, db: PgAsyncDatabase<any, any>, req: { session: { userId: string } }) {',
              '    return db.select({ id: orders.id }).from(orders).where(inArray(orders.userId, [req.session.userId, input.userId]));',
              '  },',
              '});',
              '',
              'export const orderBySessionId = query("orderBySessionId", {',
              '  output: s.object({ id: s.string() }),',
              '  async load(_input: unknown, db: PgAsyncDatabase<any, any>, req: { session: { userId: string } }) {',
              '    return db.select({ id: orders.id }).from(orders).where(inArray(orders.id, [req.session.userId]));',
              '  },',
              '});',
              '',
              'export const orderByReadonlyTupleSessionId = query("orderByReadonlyTupleSessionId", {',
              '  output: s.object({ id: s.string() }),',
              '  async load(_input: unknown, db: PgAsyncDatabase<any, any>, req: { session: { userId: string } }) {',
              '    const principals = [req.session.userId] as const;',
              '    return db.select({ id: orders.id }).from(orders).where(inArray(orders.id, principals));',
              '  },',
              '});',
              '',
              'export const ordersMineMutable = query("ordersMineMutable", {',
              '  output: s.object({ id: s.string() }),',
              '  async load(_input: unknown, db: PgAsyncDatabase<any, any>, req: { session: { userId: string } }) {',
              '    let principals = [req.session.userId];',
              '    return db.select({ id: orders.id }).from(orders).where(inArray(orders.userId, principals));',
              '  },',
              '});',
              '',
              'export const ordersMineComputed = query("ordersMineComputed", {',
              '  output: s.object({ id: s.string() }),',
              '  async load(_input: unknown, db: PgAsyncDatabase<any, any>, req: { session: { userId: string } }) {',
              '    return db.select({ id: orders.id }).from(orders).where(inArray(orders.userId, Array.of(req.session.userId)));',
              '  },',
              '});',
              '',
              'export const ordersMineShadowedArrayOf = query("ordersMineShadowedArrayOf", {',
              '  output: s.object({ id: s.string() }),',
              '  async load(_input: unknown, db: PgAsyncDatabase<any, any>, req: { session: { userId: string } }) {',
              '    const Array = { of<T>(value: T): T[] { return [value]; } };',
              '    return db.select({ id: orders.id }).from(orders).where(inArray(orders.userId, Array.of(req.session.userId)));',
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
      { name: 'orderByInput', scope: 'args' },
      { name: 'orderByInputList', scope: 'args' },
      { name: 'orderByReadonlyTupleSessionId', scope: 'unknown' },
      { name: 'orderBySessionId', scope: 'unknown' },
      { name: 'ordersMine', scope: 'session' },
      { name: 'ordersMineComputed', scope: 'session' },
      { name: 'ordersMineFrozenTuple', scope: 'session' },
      { name: 'ordersMineFrozenTupleAlias', scope: 'session' },
      { name: 'ordersMineFrozenTupleSpread', scope: 'unknown' },
      { name: 'ordersMineMixed', scope: 'unknown' },
      { name: 'ordersMineMulti', scope: 'unknown' },
      { name: 'ordersMineMutable', scope: 'unknown' },
      { name: 'ordersMineMutatedReadonlyTuple', scope: 'unknown' },
      { name: 'ordersMineReadonlyTuple', scope: 'session' },
      { name: 'ordersMineSessionList', scope: 'unknown' },
      { name: 'ordersMineShadowedArrayOf', scope: 'unknown' },
      { name: 'ordersMineShadowedObjectFreeze', scope: 'unknown' },
    ]);
    expect(audit.scopeAudits.find((a) => a.name === 'ordersMine')?.detail).toContain(
      'owner column compared to session:userId',
    );
  });

  it('OPP-28: treats non-equality read predicates as args without proving session scope', () => {
    const audit = extractOwnerAuditFromProject(
      withPgDatabaseTypes({
        files: [
          pgDatabaseTypes([
            'select(value?: unknown): { from(table: unknown): { where(value: unknown): Promise<unknown[]> } };',
          ]),
          {
            fileName: 'order.queries.ts',
            source: [
              'import { inArray, ne, not, notInArray, eq } from "drizzle-orm";',
              'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
              'import { kovoAnalyzerSummary } from "@kovojs/drizzle";',
              '',
              'export const orders = pgTable("orders", { id: text("id").primaryKey(), userId: text("user_id").notNull() }, kovo({ domain: "order", key: (t) => t.id, owner: (t) => t.userId }));',
              '',
              'function currentGuardUser(ctx: { guard: { userId: string } }) { return ctx.guard.userId; }',
              'kovoAnalyzerSummary(currentGuardUser, { returns: { kind: "guard", path: "userId" } });',
              '',
              'export const ordersExceptInput = query("ordersExceptInput", {',
              '  output: s.object({ id: s.string() }),',
              '  async load(input: { userId: string }, db: PgAsyncDatabase<any, any>) {',
              '    return db.select({ id: orders.id }).from(orders).where(ne(orders.userId, input.userId));',
              '  },',
              '});',
              '',
              'export const ordersNotInput = query("ordersNotInput", {',
              '  output: s.object({ id: s.string() }),',
              '  async load(input: { userId: string }, db: PgAsyncDatabase<any, any>) {',
              '    return db.select({ id: orders.id }).from(orders).where(not(eq(orders.userId, input.userId)));',
              '  },',
              '});',
              '',
              'export const ordersNotInInput = query("ordersNotInInput", {',
              '  output: s.object({ id: s.string() }),',
              '  async load(input: { userId: string }, db: PgAsyncDatabase<any, any>) {',
              '    return db.select({ id: orders.id }).from(orders).where(not(inArray(orders.userId, [input.userId])));',
              '  },',
              '});',
              '',
              'export const ordersNotInArrayInput = query("ordersNotInArrayInput", {',
              '  output: s.object({ id: s.string() }),',
              '  async load(input: { userId: string }, db: PgAsyncDatabase<any, any>) {',
              '    return db.select({ id: orders.id }).from(orders).where(notInArray(orders.userId, [input.userId]));',
              '  },',
              '});',
              '',
              'export const ordersNotInArrayInputList = query("ordersNotInArrayInputList", {',
              '  output: s.object({ id: s.string() }),',
              '  async load(input: { userIds: string[] }, db: PgAsyncDatabase<any, any>) {',
              '    return db.select({ id: orders.id }).from(orders).where(notInArray(orders.userId, input.userIds));',
              '  },',
              '});',
              '',
              'export const ordersNotInMixed = query("ordersNotInMixed", {',
              '  output: s.object({ id: s.string() }),',
              '  async load(input: { userId: string }, db: PgAsyncDatabase<any, any>, req: { session: { userId: string } }) {',
              '    return db.select({ id: orders.id }).from(orders).where(not(inArray(orders.userId, [req.session.userId, input.userId])));',
              '  },',
              '});',
              '',
              'export const ordersNotInMine = query("ordersNotInMine", {',
              '  output: s.object({ id: s.string() }),',
              '  async load(_input: unknown, db: PgAsyncDatabase<any, any>, req: { session: { userId: string } }) {',
              '    return db.select({ id: orders.id }).from(orders).where(not(inArray(orders.userId, [req.session.userId])));',
              '  },',
              '});',
              '',
              'export const ordersNotInGuard = query("ordersNotInGuard", {',
              '  output: s.object({ id: s.string() }),',
              '  async load(_input: unknown, db: PgAsyncDatabase<any, any>, ctx: { guard: { userId: string } }) {',
              '    return db.select({ id: orders.id }).from(orders).where(notInArray(orders.userId, [currentGuardUser(ctx)]));',
              '  },',
              '});',
              '',
              'export const ordersNotInArrayMineList = query("ordersNotInArrayMineList", {',
              '  output: s.object({ id: s.string() }),',
              '  async load(_input: unknown, db: PgAsyncDatabase<any, any>, req: { session: { userIds: string[] } }) {',
              '    return db.select({ id: orders.id }).from(orders).where(notInArray(orders.userId, req.session.userIds));',
              '  },',
              '});',
              '',
              'export const ordersExceptMine = query("ordersExceptMine", {',
              '  output: s.object({ id: s.string() }),',
              '  async load(_input: unknown, db: PgAsyncDatabase<any, any>, req: { session: { userId: string } }) {',
              '    return db.select({ id: orders.id }).from(orders).where(ne(orders.userId, req.session.userId));',
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
      { name: 'ordersExceptInput', scope: 'args' },
      { name: 'ordersExceptMine', scope: 'unknown' },
      { name: 'ordersNotInArrayInput', scope: 'args' },
      { name: 'ordersNotInArrayInputList', scope: 'args' },
      { name: 'ordersNotInArrayMineList', scope: 'unknown' },
      { name: 'ordersNotInGuard', scope: 'unknown' },
      { name: 'ordersNotInInput', scope: 'args' },
      { name: 'ordersNotInMine', scope: 'unknown' },
      { name: 'ordersNotInMixed', scope: 'args' },
      { name: 'ordersNotInput', scope: 'args' },
    ]);
    expect(audit.scopeAudits.find((a) => a.name === 'ordersExceptMine')?.detail).toContain(
      'no owner-column session/principal predicate was proven',
    );
  });

  it('carries exact client owner keys for same-domain arg-scoped reads', () => {
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
              'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
              '',
              'export const orders = pgTable("orders", { id: text("id").primaryKey(), alternateId: text("alternate_id").notNull(), userId: text("user_id").notNull() }, kovo({ domain: "order", key: (t) => t.id, owner: (t) => t.userId }));',
              '',
              'export const orderById = query("orderById", {',
              '  output: s.object({ id: s.string() }),',
              '  async load(input: { id: string }, db: PgAsyncDatabase<any, any>) {',
              '    return db.select({ id: orders.id }).from(orders).where(eq(orders.id, input.id));',
              '  },',
              '});',
              '',
              'export const orderByAlternate = query("orderByAlternate", {',
              '  output: s.object({ id: s.string() }),',
              '  async load(input: { alternateId: string }, db: PgAsyncDatabase<any, any>) {',
              '    return db.select({ id: orders.id }).from(orders).where(eq(orders.alternateId, input.alternateId));',
              '  },',
              '});',
            ].join('\n'),
          },
        ],
      }),
    );

    expect(
      audit.scopeAudits
        .map((a) => ({ domain: a.domain, key: a.key, name: a.name, scope: a.scope }))
        .sort((x, y) => x.name.localeCompare(y.name)),
    ).toEqual([
      { domain: 'order', key: 'arg:alternateId', name: 'orderByAlternate', scope: 'args' },
      { domain: 'order', key: 'arg:id', name: 'orderById', scope: 'args' },
    ]);
  });

  it('keeps const-destructured query args as arg-keyed owner reads', () => {
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
              'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
              '',
              'export const orders = pgTable("orders", { id: text("id").primaryKey(), userId: text("user_id").notNull() }, kovo({ domain: "order", key: (t) => t.id, owner: (t) => t.userId }));',
              '',
              'export const orderById = query("orderById", {',
              '  output: s.object({ id: s.string() }),',
              '  async load(input: { id: string }, db: PgAsyncDatabase<any, any>) {',
              '    const { id: orderId } = input;',
              '    return db.select({ id: orders.id }).from(orders).where(eq(orders.id, orderId));',
              '  },',
              '});',
              '',
              'export const ordersForUser = query("ordersForUser", {',
              '  output: s.object({ id: s.string() }),',
              '  async load(input: { userId: string }, db: PgAsyncDatabase<any, any>) {',
              '    const { userId } = input;',
              '    return db.select({ id: orders.id }).from(orders).where(eq(orders.userId, userId));',
              '  },',
              '});',
            ].join('\n'),
          },
        ],
      }),
    );

    expect(
      audit.scopeAudits
        .map((a) => ({ domain: a.domain, key: a.key, name: a.name, scope: a.scope }))
        .sort((x, y) => x.name.localeCompare(y.name)),
    ).toEqual([
      { domain: 'order', key: 'arg:id', name: 'orderById', scope: 'args' },
      { domain: 'order', key: 'arg:userId', name: 'ordersForUser', scope: 'args' },
    ]);
  });

  it('does not treat non-input destructured locals as query args', () => {
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
              'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
              '',
              'export const orders = pgTable("orders", { id: text("id").primaryKey(), userId: text("user_id").notNull() }, kovo({ domain: "order", key: (t) => t.id, owner: (t) => t.userId }));',
              '',
              'export const orderMine = query("orderMine", {',
              '  output: s.object({ id: s.string() }),',
              '  async load(_input: unknown, db: PgAsyncDatabase<any, any>) {',
              '    const source = { userId: "u1" };',
              '    const { userId } = source;',
              '    return db.select({ id: orders.id }).from(orders).where(eq(orders.userId, userId));',
              '  },',
              '});',
            ].join('\n'),
          },
        ],
      }),
    );

    expect(audit.scopeAudits.map((a) => ({ domain: a.domain, scope: a.scope }))).toEqual([
      { domain: 'order', scope: 'unknown' },
    ]);
  });

  // KV414 join-keyed bypass (SPEC §10.3, fail-closed). Reading an owner table through a
  // JOIN keyed on the JOINED (non-owner) table emitted NO scope audit and shipped green:
  // the arg predicate (`input.itemId`) resolves to `items` (non-owner), so the owner read
  // of `order` was neither arg-keyed nor session-scoped → no fact. An authenticated
  // attacker supplies any item id and reads another principal's order rows. The owner read
  // must now fail closed to scope:'args' (→ KV414).
  it('flags scope:args for an owner read joined in and keyed only through a non-owner table arg', () => {
    const audit = extractOwnerAuditFromProject(
      withPgDatabaseTypes({
        files: [
          pgDatabaseTypes([
            'select(value?: unknown): { from(table: unknown): { innerJoin(table: unknown, on: unknown): { where(value: unknown): Promise<unknown[]> } } };',
          ]),
          {
            fileName: 'order.queries.ts',
            source: [
              'import { eq } from "drizzle-orm";',
              'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
              '',
              'export const orders = pgTable("orders", { id: text("id").primaryKey(), userId: text("user_id").notNull() }, kovo({ domain: "order", key: (t) => t.id, owner: (t) => t.userId }));',
              'export const items = pgTable("items", { id: text("id").primaryKey(), orderId: text("order_id").notNull() }, kovo({ domain: "item", key: (t) => t.id }));',
              '',
              'export const orderViaItem = query("orderViaItem", {',
              '  output: s.object({ id: s.string() }),',
              '  async load(input: { itemId: string }, db: PgAsyncDatabase<any, any>) {',
              '    return db.select({ id: orders.id }).from(orders).innerJoin(items, eq(items.orderId, orders.id)).where(eq(items.id, input.itemId));',
              '  },',
              '});',
            ].join('\n'),
          },
        ],
      }),
    );

    expect(audit.ownerDomains).toEqual([{ domain: 'order', owner: 'userId' }]);
    expect(auditScopes(audit)).toContainEqual({ domain: 'order', kind: 'query', scope: 'args' });
  });

  // Positive (no regression): the SAME owner read scoped by `eq(orders.userId, req.session.userId)`
  // — even when the query also joins/filters by a client arg — stays session-scoped (no KV414).
  it('keeps a join-bearing owner read scope:session when the owner table is session-scoped', () => {
    const audit = extractOwnerAuditFromProject(
      withPgDatabaseTypes({
        files: [
          pgDatabaseTypes([
            'select(value?: unknown): { from(table: unknown): { innerJoin(table: unknown, on: unknown): { where(value: unknown): Promise<unknown[]> } } };',
          ]),
          {
            fileName: 'order.queries.ts',
            source: [
              'import { and, eq } from "drizzle-orm";',
              'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
              '',
              'export const orders = pgTable("orders", { id: text("id").primaryKey(), userId: text("user_id").notNull() }, kovo({ domain: "order", key: (t) => t.id, owner: (t) => t.userId }));',
              'export const items = pgTable("items", { id: text("id").primaryKey(), orderId: text("order_id").notNull() }, kovo({ domain: "item", key: (t) => t.id }));',
              '',
              'export const orderViaItem = query("orderViaItem", {',
              '  output: s.object({ id: s.string() }),',
              '  async load(input: { itemId: string }, db: PgAsyncDatabase<any, any>, req: { session: { userId: string } }) {',
              '    return db.select({ id: orders.id }).from(orders).innerJoin(items, eq(items.orderId, orders.id)).where(and(eq(orders.userId, req.session.userId), eq(items.id, input.itemId)));',
              '  },',
              '});',
            ].join('\n'),
          },
        ],
      }),
    );

    expect(audit.scopeAudits.map((a) => ({ domain: a.domain, scope: a.scope }))).toEqual([
      { domain: 'order', scope: 'session' },
    ]);
  });

  // Session-via-local-variable tracing (SPEC §11.1, KV414). A non-nullable session value
  // bound to a local `const` and then used in the scoping predicate must be recognized as
  // session-scoped — otherwise the join-keyed bypass branch above would false-positive the
  // app's own correct fix. `const uid = req.session.userId; …eq(orders.userId, uid)` → session.
  it('traces a non-nullable session value through a local const so the read stays scope:session', () => {
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
              'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
              '',
              'export const orders = pgTable("orders", { id: text("id").primaryKey(), userId: text("user_id").notNull() }, kovo({ domain: "order", key: (t) => t.id, owner: (t) => t.userId }));',
              '',
              'export const ordersMine = query("ordersMine", {',
              '  output: s.object({ id: s.string() }),',
              '  async load(_input: unknown, db: PgAsyncDatabase<any, any>, req: { session: { userId: string } }) {',
              '    const uid = req.session.userId;',
              '    return db.select({ id: orders.id }).from(orders).where(eq(orders.userId, uid));',
              '  },',
              '});',
            ].join('\n'),
          },
        ],
      }),
    );

    expect(audit.scopeAudits.map((a) => ({ domain: a.domain, scope: a.scope }))).toEqual([
      { domain: 'order', scope: 'session' },
    ]);
  });

  it('accepts an explicitly summarized guard principal on the owner-column predicate', () => {
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
              'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
              'import { kovoAnalyzerSummary } from "@kovojs/drizzle";',
              '',
              'export const orders = pgTable("orders", { id: text("id").primaryKey(), userId: text("user_id").notNull() }, kovo({ domain: "order", key: (t) => t.id, owner: (t) => t.userId }));',
              '',
              'function currentGuardUser(ctx: { guard: { userId: string } }) { return ctx.guard.userId; }',
              'kovoAnalyzerSummary(currentGuardUser, { returns: { kind: "guard", path: "userId" } });',
              '',
              'export const ordersForGuard = query("ordersForGuard", {',
              '  output: s.object({ id: s.string() }),',
              '  async load(_input: unknown, db: PgAsyncDatabase<any, any>, ctx: { guard: { userId: string } }) {',
              '    const guardUserId = currentGuardUser(ctx);',
              '    return db.select({ id: orders.id }).from(orders).where(eq(orders.userId, guardUserId));',
              '  },',
              '});',
            ].join('\n'),
          },
        ],
      }),
    );

    expect(
      audit.scopeAudits.map((a) => ({ detail: a.detail, domain: a.domain, scope: a.scope })),
    ).toEqual([
      {
        detail:
          'narrow Authorization-gates-DATA subset: owner=userId; owner column compared to guard:userId',
        domain: 'order',
        scope: 'session',
      },
    ]);
  });

  it('accepts awaited summarized guard principals on the owner-column predicate only', () => {
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
              'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
              'import { kovoAnalyzerSummary } from "@kovojs/drizzle";',
              '',
              'export const orders = pgTable("orders", { id: text("id").primaryKey(), userId: text("user_id").notNull() }, kovo({ domain: "order", key: (t) => t.id, owner: (t) => t.userId }));',
              '',
              'async function currentGuardUser(ctx: { guard: { userId: string } }) { return ctx.guard.userId; }',
              'async function unsummarizedGuardUser(ctx: { guard: { userId: string } }) { return ctx.guard.userId; }',
              'kovoAnalyzerSummary(currentGuardUser, { returns: { kind: "guard", path: "userId" } });',
              '',
              'export const ordersForAwaitedGuard = query("ordersForAwaitedGuard", {',
              '  output: s.object({ id: s.string() }),',
              '  async load(_input: unknown, db: PgAsyncDatabase<any, any>, ctx: { guard: { userId: string } }) {',
              '    return db.select({ id: orders.id }).from(orders).where(eq(orders.userId, await currentGuardUser(ctx)));',
              '  },',
              '});',
              '',
              'export const ordersForAwaitedGuardAlias = query("ordersForAwaitedGuardAlias", {',
              '  output: s.object({ id: s.string() }),',
              '  async load(_input: unknown, db: PgAsyncDatabase<any, any>, ctx: { guard: { userId: string } }) {',
              '    const guardUserId = await currentGuardUser(ctx);',
              '    return db.select({ id: orders.id }).from(orders).where(eq(orders.userId, guardUserId));',
              '  },',
              '});',
              '',
              'export const ordersForUnsummarizedAwaitedGuard = query("ordersForUnsummarizedAwaitedGuard", {',
              '  output: s.object({ id: s.string() }),',
              '  async load(_input: unknown, db: PgAsyncDatabase<any, any>, ctx: { guard: { userId: string } }) {',
              '    return db.select({ id: orders.id }).from(orders).where(eq(orders.userId, await unsummarizedGuardUser(ctx)));',
              '  },',
              '});',
            ].join('\n'),
          },
        ],
      }),
    );

    expect(
      audit.scopeAudits.map((a) => ({
        detail: a.detail,
        domain: a.domain,
        name: a.name,
        scope: a.scope,
      })),
    ).toEqual([
      {
        detail:
          'narrow Authorization-gates-DATA subset: owner=userId; owner column compared to guard:userId',
        domain: 'order',
        name: 'ordersForAwaitedGuard',
        scope: 'session',
      },
      {
        detail:
          'narrow Authorization-gates-DATA subset: owner=userId; owner column compared to guard:userId',
        domain: 'order',
        name: 'ordersForAwaitedGuardAlias',
        scope: 'session',
      },
      {
        detail:
          'narrow Authorization-gates-DATA subset: owner=userId; no owner-column session/principal predicate was proven',
        domain: 'order',
        name: 'ordersForUnsummarizedAwaitedGuard',
        scope: 'unknown',
      },
    ]);
  });

  it('accepts an explicitly summarized property-call guard principal on the owner-column predicate', () => {
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
              'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
              'import { kovoAnalyzerSummary } from "@kovojs/drizzle";',
              '',
              'export const orders = pgTable("orders", { id: text("id").primaryKey(), userId: text("user_id").notNull() }, kovo({ domain: "order", key: (t) => t.id, owner: (t) => t.userId }));',
              '',
              'const guardFns = {',
              '  currentGuardUser(ctx: { guard: { userId: string } }) { return ctx.guard.userId; },',
              '};',
              'kovoAnalyzerSummary(guardFns.currentGuardUser, { returns: { kind: "guard", path: "userId" } });',
              '',
              'export const ordersForGuard = query("ordersForGuard", {',
              '  output: s.object({ id: s.string() }),',
              '  async load(_input: unknown, db: PgAsyncDatabase<any, any>, ctx: { guard: { userId: string } }) {',
              '    return db.select({ id: orders.id }).from(orders).where(eq(orders.userId, guardFns.currentGuardUser(ctx)));',
              '  },',
              '});',
            ].join('\n'),
          },
        ],
      }),
    );

    expect(
      audit.scopeAudits.map((a) => ({ detail: a.detail, domain: a.domain, scope: a.scope })),
    ).toEqual([
      {
        detail:
          'narrow Authorization-gates-DATA subset: owner=userId; owner column compared to guard:userId',
        domain: 'order',
        scope: 'session',
      },
    ]);
  });

  it('accepts a local alias to a summarized property-call guard principal', () => {
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
              'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
              'import { kovoAnalyzerSummary } from "@kovojs/drizzle";',
              '',
              'export const orders = pgTable("orders", { id: text("id").primaryKey(), userId: text("user_id").notNull() }, kovo({ domain: "order", key: (t) => t.id, owner: (t) => t.userId }));',
              '',
              'const guardFns = {',
              '  currentGuardUser(ctx: { guard: { userId: string } }) { return ctx.guard.userId; },',
              '};',
              'kovoAnalyzerSummary(guardFns.currentGuardUser, { returns: { kind: "guard", path: "userId" } });',
              'const guardUser = guardFns.currentGuardUser;',
              '',
              'export const ordersForGuard = query("ordersForGuard", {',
              '  output: s.object({ id: s.string() }),',
              '  async load(_input: unknown, db: PgAsyncDatabase<any, any>, ctx: { guard: { userId: string } }) {',
              '    return db.select({ id: orders.id }).from(orders).where(eq(orders.userId, guardUser(ctx)));',
              '  },',
              '});',
            ].join('\n'),
          },
        ],
      }),
    );

    expect(
      audit.scopeAudits.map((a) => ({ detail: a.detail, domain: a.domain, scope: a.scope })),
    ).toEqual([
      {
        detail:
          'narrow Authorization-gates-DATA subset: owner=userId; owner column compared to guard:userId',
        domain: 'order',
        scope: 'session',
      },
    ]);
  });

  it('accepts a conditional guard principal when both branches prove the same owner symbol', () => {
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
              'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
              'import { kovoAnalyzerSummary } from "@kovojs/drizzle";',
              '',
              'export const orders = pgTable("orders", { id: text("id").primaryKey(), userId: text("user_id").notNull() }, kovo({ domain: "order", key: (t) => t.id, owner: (t) => t.userId }));',
              '',
              'const guardFns = {',
              '  currentGuardUser(ctx: { guard: { userId: string } }) { return ctx.guard.userId; },',
              '};',
              'kovoAnalyzerSummary(guardFns.currentGuardUser, { returns: { kind: "guard", path: "userId" } });',
              '',
              'export const ordersForGuard = query("ordersForGuard", {',
              '  output: s.object({ id: s.string() }),',
              '  async load(_input: unknown, db: PgAsyncDatabase<any, any>, ctx: { guard: { userId: string } }, preferPrimary: boolean) {',
              '    const guardUserId = preferPrimary ? guardFns.currentGuardUser(ctx) : guardFns.currentGuardUser(ctx);',
              '    return db.select({ id: orders.id }).from(orders).where(eq(orders.userId, guardUserId));',
              '  },',
              '});',
            ].join('\n'),
          },
        ],
      }),
    );

    expect(
      audit.scopeAudits.map((a) => ({ detail: a.detail, domain: a.domain, scope: a.scope })),
    ).toEqual([
      {
        detail:
          'narrow Authorization-gates-DATA subset: owner=userId; owner column compared to guard:userId',
        domain: 'order',
        scope: 'session',
      },
    ]);
  });

  it('keeps ambiguous conditional guard principals scope:unknown', () => {
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
              'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
              'import { kovoAnalyzerSummary } from "@kovojs/drizzle";',
              '',
              'export const orders = pgTable("orders", { id: text("id").primaryKey(), userId: text("user_id").notNull() }, kovo({ domain: "order", key: (t) => t.id, owner: (t) => t.userId }));',
              '',
              'const guardFns = {',
              '  currentGuardUser(ctx: { guard: { userId: string; actorId: string } }) { return ctx.guard.userId; },',
              '  currentActor(ctx: { guard: { userId: string; actorId: string } }) { return ctx.guard.actorId; },',
              '};',
              'kovoAnalyzerSummary(guardFns.currentGuardUser, { returns: { kind: "guard", path: "userId" } });',
              'kovoAnalyzerSummary(guardFns.currentActor, { returns: { kind: "guard", path: "actorId" } });',
              '',
              'export const ordersForGuard = query("ordersForGuard", {',
              '  output: s.object({ id: s.string() }),',
              '  async load(_input: unknown, db: PgAsyncDatabase<any, any>, ctx: { guard: { userId: string; actorId: string } }, preferPrimary: boolean) {',
              '    const guardUserId = preferPrimary ? guardFns.currentGuardUser(ctx) : guardFns.currentActor(ctx);',
              '    return db.select({ id: orders.id }).from(orders).where(eq(orders.userId, guardUserId));',
              '  },',
              '});',
            ].join('\n'),
          },
        ],
      }),
    );

    expect(
      audit.scopeAudits.map((a) => ({ detail: a.detail, domain: a.domain, scope: a.scope })),
    ).toEqual([
      {
        detail:
          'narrow Authorization-gates-DATA subset: owner=userId; no owner-column session/principal predicate was proven',
        domain: 'order',
        scope: 'unknown',
      },
    ]);
  });

  it('accepts a static property read from an explicitly summarized guard object', () => {
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
              'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
              'import { kovoAnalyzerSummary } from "@kovojs/drizzle";',
              '',
              'export const orders = pgTable("orders", { id: text("id").primaryKey(), userId: text("user_id").notNull() }, kovo({ domain: "order", key: (t) => t.id, owner: (t) => t.userId }));',
              '',
              'function currentPrincipal(ctx: { guard: { userId: string } }) { return ctx.guard; }',
              'kovoAnalyzerSummary(currentPrincipal, { returns: { kind: "guard", path: "" } });',
              '',
              'export const ordersForPrincipal = query("ordersForPrincipal", {',
              '  output: s.object({ id: s.string() }),',
              '  async load(_input: unknown, db: PgAsyncDatabase<any, any>, ctx: { guard: { userId: string } }) {',
              '    const principal = currentPrincipal(ctx);',
              '    return db.select({ id: orders.id }).from(orders).where(eq(orders.userId, principal.userId));',
              '  },',
              '});',
            ].join('\n'),
          },
        ],
      }),
    );

    expect(
      audit.scopeAudits.map((a) => ({ detail: a.detail, domain: a.domain, scope: a.scope })),
    ).toEqual([
      {
        detail:
          'narrow Authorization-gates-DATA subset: owner=userId; owner column compared to guard:userId',
        domain: 'order',
        scope: 'session',
      },
    ]);
  });

  it('accepts a nested readonly wrapper around an explicitly summarized guard object', () => {
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
              'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
              'import { kovoAnalyzerSummary } from "@kovojs/drizzle";',
              '',
              'export const orders = pgTable("orders", { id: text("id").primaryKey(), userId: text("user_id").notNull() }, kovo({ domain: "order", key: (t) => t.id, owner: (t) => t.userId }));',
              '',
              'function currentPrincipal(ctx: { guard: { userId: string } }) { return ctx.guard; }',
              'kovoAnalyzerSummary(currentPrincipal, { returns: { kind: "guard", path: "" } });',
              '',
              'export const ordersForPrincipal = query("ordersForPrincipal", {',
              '  output: s.object({ id: s.string() }),',
              '  async load(_input: unknown, db: PgAsyncDatabase<any, any>, ctx: { guard: { userId: string } }) {',
              '    const wrapper: Readonly<{ principal: Readonly<{ userId: string }> }> = { principal: currentPrincipal(ctx) };',
              '    return db.select({ id: orders.id }).from(orders).where(eq(orders.userId, wrapper.principal.userId));',
              '  },',
              '});',
            ].join('\n'),
          },
        ],
      }),
    );

    expect(
      audit.scopeAudits.map((a) => ({ detail: a.detail, domain: a.domain, scope: a.scope })),
    ).toEqual([
      {
        detail:
          'narrow Authorization-gates-DATA subset: owner=userId; owner column compared to guard:userId',
        domain: 'order',
        scope: 'session',
      },
    ]);
  });

  it('accepts a const alias to a readonly nested guard-object wrapper', () => {
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
              'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
              'import { kovoAnalyzerSummary } from "@kovojs/drizzle";',
              '',
              'export const orders = pgTable("orders", { id: text("id").primaryKey(), userId: text("user_id").notNull() }, kovo({ domain: "order", key: (t) => t.id, owner: (t) => t.userId }));',
              '',
              'function currentPrincipal(ctx: { guard: { userId: string } }) { return ctx.guard; }',
              'kovoAnalyzerSummary(currentPrincipal, { returns: { kind: "guard", path: "" } });',
              '',
              'export const ordersForPrincipal = query("ordersForPrincipal", {',
              '  output: s.object({ id: s.string() }),',
              '  async load(_input: unknown, db: PgAsyncDatabase<any, any>, ctx: { guard: { userId: string } }) {',
              '    const principal = { userId: currentPrincipal(ctx).userId } as const;',
              '    const wrapper = { principal } as const;',
              '    return db.select({ id: orders.id }).from(orders).where(eq(orders.userId, wrapper.principal.userId));',
              '  },',
              '});',
            ].join('\n'),
          },
        ],
      }),
    );

    expect(
      audit.scopeAudits.map((a) => ({ detail: a.detail, domain: a.domain, scope: a.scope })),
    ).toEqual([
      {
        detail:
          'narrow Authorization-gates-DATA subset: owner=userId; owner column compared to guard:userId',
        domain: 'order',
        scope: 'session',
      },
    ]);
  });

  it('keeps a mutable conditional guard principal alias scope:unknown', () => {
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
              'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
              'import { kovoAnalyzerSummary } from "@kovojs/drizzle";',
              '',
              'export const orders = pgTable("orders", { id: text("id").primaryKey(), userId: text("user_id").notNull() }, kovo({ domain: "order", key: (t) => t.id, owner: (t) => t.userId }));',
              '',
              'const guardFns = {',
              '  currentGuardUser(ctx: { guard: { userId: string } }) { return ctx.guard.userId; },',
              '};',
              'kovoAnalyzerSummary(guardFns.currentGuardUser, { returns: { kind: "guard", path: "userId" } });',
              '',
              'export const ordersForGuard = query("ordersForGuard", {',
              '  output: s.object({ id: s.string() }),',
              '  async load(_input: unknown, db: PgAsyncDatabase<any, any>, ctx: { guard: { userId: string } }, preferPrimary: boolean) {',
              '    let guardUserId = preferPrimary ? guardFns.currentGuardUser(ctx) : guardFns.currentGuardUser(ctx);',
              '    return db.select({ id: orders.id }).from(orders).where(eq(orders.userId, guardUserId));',
              '  },',
              '});',
            ].join('\n'),
          },
        ],
      }),
    );

    expect(
      audit.scopeAudits.map((a) => ({ detail: a.detail, domain: a.domain, scope: a.scope })),
    ).toEqual([
      {
        detail:
          'narrow Authorization-gates-DATA subset: owner=userId; no owner-column session/principal predicate was proven',
        domain: 'order',
        scope: 'unknown',
      },
    ]);
  });

  it('keeps unsafe const-alias guard-object wrappers scope:unknown', () => {
    const cases = [
      {
        helper: [
          'function currentPrincipal(ctx: { guard: { actorId: string } }) { return ctx.guard; }',
          'kovoAnalyzerSummary(currentPrincipal, { returns: { kind: "guard", path: "" } });',
        ],
        predicate: 'eq(orders.userId, wrapper.principal.actorId)',
        wrapper: [
          'const principal = { actorId: currentPrincipal(ctx).actorId } as const;',
          'const wrapper = { principal } as const;',
        ],
      },
      {
        helper: [
          'function currentPrincipal(ctx: { guard: { userId: string } }) { return ctx.guard; }',
        ],
        predicate: 'eq(orders.userId, wrapper.principal.userId)',
        wrapper: [
          'const principal = { userId: currentPrincipal(ctx).userId } as const;',
          'const wrapper = { principal } as const;',
        ],
      },
      {
        helper: [
          'function currentPrincipal(ctx: { guard: { userId: string } }) { return ctx.guard; }',
          'kovoAnalyzerSummary(currentPrincipal, { returns: { kind: "guard", path: "" } });',
        ],
        predicate: 'eq(orders.userId, wrapper.principal.userId)',
        wrapper: [
          'let principal = { userId: currentPrincipal(ctx).userId } as const;',
          'const wrapper = { principal } as const;',
        ],
      },
      {
        helper: [
          'function currentPrincipal(ctx: { guard: { userId: string } }) { return ctx.guard; }',
          'kovoAnalyzerSummary(currentPrincipal, { returns: { kind: "guard", path: "" } });',
        ],
        predicate: 'eq(orders.userId, wrapper.principal[ownerKey])',
        wrapper: [
          'const principal = { userId: currentPrincipal(ctx).userId } as const;',
          'const wrapper = { principal } as const;',
          'const ownerKey = "userId";',
        ],
      },
    ];

    for (const testCase of cases) {
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
                'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
                'import { kovoAnalyzerSummary } from "@kovojs/drizzle";',
                '',
                'export const orders = pgTable("orders", { id: text("id").primaryKey(), userId: text("user_id").notNull() }, kovo({ domain: "order", key: (t) => t.id, owner: (t) => t.userId }));',
                '',
                ...testCase.helper,
                '',
                'export const ordersForPrincipal = query("ordersForPrincipal", {',
                '  output: s.object({ id: s.string() }),',
                '  async load(_input: unknown, db: PgAsyncDatabase<any, any>, ctx: { guard: Record<string, string> }) {',
                ...testCase.wrapper.map((line) => `    ${line}`),
                `    return db.select({ id: orders.id }).from(orders).where(${testCase.predicate});`,
                '  },',
                '});',
              ].join('\n'),
            },
          ],
        }),
      );

      expect(
        audit.scopeAudits.map((a) => ({ detail: a.detail, domain: a.domain, scope: a.scope })),
      ).toEqual([
        {
          detail:
            'narrow Authorization-gates-DATA subset: owner=userId; no owner-column session/principal predicate was proven',
          domain: 'order',
          scope: 'unknown',
        },
      ]);
    }
  });

  it('accepts an Object.freeze wrapper around an explicitly summarized guard object', () => {
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
              'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
              'import { kovoAnalyzerSummary } from "@kovojs/drizzle";',
              '',
              'export const orders = pgTable("orders", { id: text("id").primaryKey(), userId: text("user_id").notNull() }, kovo({ domain: "order", key: (t) => t.id, owner: (t) => t.userId }));',
              '',
              'function currentPrincipal(ctx: { guard: { userId: string } }) { return ctx.guard; }',
              'kovoAnalyzerSummary(currentPrincipal, { returns: { kind: "guard", path: "" } });',
              '',
              'export const ordersForPrincipal = query("ordersForPrincipal", {',
              '  output: s.object({ id: s.string() }),',
              '  async load(_input: unknown, db: PgAsyncDatabase<any, any>, ctx: { guard: { userId: string } }) {',
              '    const wrapper = Object.freeze({ principal: currentPrincipal(ctx) });',
              '    return db.select({ id: orders.id }).from(orders).where(eq(orders.userId, wrapper.principal.userId));',
              '  },',
              '});',
            ].join('\n'),
          },
        ],
      }),
    );

    expect(
      audit.scopeAudits.map((a) => ({ detail: a.detail, domain: a.domain, scope: a.scope })),
    ).toEqual([
      {
        detail:
          'narrow Authorization-gates-DATA subset: owner=userId; owner column compared to guard:userId',
        domain: 'order',
        scope: 'session',
      },
    ]);
  });

  it('keeps ambiguous Object.freeze guard-object wrappers scope:unknown', () => {
    const cases = [
      {
        extraParam: ', override: { principal: { userId: string } }',
        helper: [
          'function currentPrincipal(ctx: { guard: { userId: string } }) { return ctx.guard; }',
          'kovoAnalyzerSummary(currentPrincipal, { returns: { kind: "guard", path: "" } });',
        ],
        predicate: 'eq(orders.userId, wrapper.principal.userId)',
        wrapper:
          'const wrapper = Object.freeze({ principal: currentPrincipal(ctx), ...override });',
      },
      {
        extraParam: ', principal: { userId: string }',
        helper: [
          'function currentPrincipal(ctx: { guard: { userId: string } }) { return ctx.guard; }',
          'kovoAnalyzerSummary(currentPrincipal, { returns: { kind: "guard", path: "" } });',
        ],
        predicate: 'eq(orders.userId, wrapper.principal.userId)',
        wrapper: 'const wrapper = Object.freeze({ principal: currentPrincipal(ctx), principal });',
      },
      {
        extraParam: '',
        helper: [
          'function currentPrincipal(ctx: { guard: { actorId: string } }) { return ctx.guard; }',
          'kovoAnalyzerSummary(currentPrincipal, { returns: { kind: "guard", path: "" } });',
        ],
        predicate: 'eq(orders.userId, wrapper.principal.actorId)',
        wrapper: 'const wrapper = Object.freeze({ principal: currentPrincipal(ctx) });',
      },
      {
        extraParam: '',
        helper: [
          'function currentPrincipal(ctx: { guard: { userId: string } }) { return ctx.guard; }',
        ],
        predicate: 'eq(orders.userId, wrapper.principal.userId)',
        wrapper: 'const wrapper = Object.freeze({ principal: currentPrincipal(ctx) });',
      },
      {
        extraParam: '',
        helper: [
          'function currentPrincipal(ctx: { guard: { userId: string } }) { return ctx.guard; }',
          'kovoAnalyzerSummary(currentPrincipal, { returns: { kind: "guard", path: "" } });',
        ],
        predicate: 'eq(orders.userId, wrapper.principal.userId)',
        wrapper: 'let wrapper = Object.freeze({ principal: currentPrincipal(ctx) });',
      },
      {
        extraParam: '',
        helper: [
          'function currentPrincipal(ctx: { guard: { userId: string } }) { return ctx.guard; }',
          'kovoAnalyzerSummary(currentPrincipal, { returns: { kind: "guard", path: "" } });',
        ],
        predicate: 'eq(orders.userId, wrapper.principal[ownerKey])',
        wrapper: [
          'const wrapper = Object.freeze({ principal: currentPrincipal(ctx) });',
          'const ownerKey = "userId";',
        ].join('\n'),
      },
    ];

    for (const testCase of cases) {
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
                'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
                'import { kovoAnalyzerSummary } from "@kovojs/drizzle";',
                '',
                'export const orders = pgTable("orders", { id: text("id").primaryKey(), userId: text("user_id").notNull() }, kovo({ domain: "order", key: (t) => t.id, owner: (t) => t.userId }));',
                '',
                ...testCase.helper,
                '',
                'export const ordersForPrincipal = query("ordersForPrincipal", {',
                '  output: s.object({ id: s.string() }),',
                `  async load(_input: unknown, db: PgAsyncDatabase<any, any>, ctx: { guard: Record<string, string> }${testCase.extraParam}) {`,
                `    ${testCase.wrapper}`,
                `    return db.select({ id: orders.id }).from(orders).where(${testCase.predicate});`,
                '  },',
                '});',
              ].join('\n'),
            },
          ],
        }),
      );

      expect(
        audit.scopeAudits.map((a) => ({ detail: a.detail, domain: a.domain, scope: a.scope })),
      ).toEqual([
        {
          detail:
            'narrow Authorization-gates-DATA subset: owner=userId; no owner-column session/principal predicate was proven',
          domain: 'order',
          scope: 'unknown',
        },
      ]);
    }
  });

  it('keeps a spread-overwritten guard-object wrapper scope:unknown', () => {
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
              'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
              'import { kovoAnalyzerSummary } from "@kovojs/drizzle";',
              '',
              'export const orders = pgTable("orders", { id: text("id").primaryKey(), userId: text("user_id").notNull() }, kovo({ domain: "order", key: (t) => t.id, owner: (t) => t.userId }));',
              '',
              'function currentPrincipal(ctx: { guard: { userId: string } }) { return ctx.guard; }',
              'kovoAnalyzerSummary(currentPrincipal, { returns: { kind: "guard", path: "" } });',
              '',
              'export const ordersForPrincipal = query("ordersForPrincipal", {',
              '  output: s.object({ id: s.string() }),',
              '  async load(_input: unknown, db: PgAsyncDatabase<any, any>, ctx: { guard: { userId: string } }, override: { principal: { userId: string } }) {',
              '    const wrapper = { principal: currentPrincipal(ctx), ...override } as const;',
              '    return db.select({ id: orders.id }).from(orders).where(eq(orders.userId, wrapper.principal.userId));',
              '  },',
              '});',
            ].join('\n'),
          },
        ],
      }),
    );

    expect(
      audit.scopeAudits.map((a) => ({ detail: a.detail, domain: a.domain, scope: a.scope })),
    ).toEqual([
      {
        detail:
          'narrow Authorization-gates-DATA subset: owner=userId; no owner-column session/principal predicate was proven',
        domain: 'order',
        scope: 'unknown',
      },
    ]);
  });

  it('keeps a duplicate-property guard-object wrapper scope:unknown', () => {
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
              'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
              'import { kovoAnalyzerSummary } from "@kovojs/drizzle";',
              '',
              'export const orders = pgTable("orders", { id: text("id").primaryKey(), userId: text("user_id").notNull() }, kovo({ domain: "order", key: (t) => t.id, owner: (t) => t.userId }));',
              '',
              'function currentPrincipal(ctx: { guard: { userId: string } }) { return ctx.guard; }',
              'kovoAnalyzerSummary(currentPrincipal, { returns: { kind: "guard", path: "" } });',
              '',
              'export const ordersForPrincipal = query("ordersForPrincipal", {',
              '  output: s.object({ id: s.string() }),',
              '  async load(_input: unknown, db: PgAsyncDatabase<any, any>, ctx: { guard: { userId: string } }, principal: { userId: string }) {',
              '    const wrapper = { principal: currentPrincipal(ctx), principal } as const;',
              '    return db.select({ id: orders.id }).from(orders).where(eq(orders.userId, wrapper.principal.userId));',
              '  },',
              '});',
            ].join('\n'),
          },
        ],
      }),
    );

    expect(
      audit.scopeAudits.map((a) => ({ detail: a.detail, domain: a.domain, scope: a.scope })),
    ).toEqual([
      {
        detail:
          'narrow Authorization-gates-DATA subset: owner=userId; no owner-column session/principal predicate was proven',
        domain: 'order',
        scope: 'unknown',
      },
    ]);
  });

  it('keeps a mutable guard-object wrapper scope:unknown', () => {
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
              'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
              'import { kovoAnalyzerSummary } from "@kovojs/drizzle";',
              '',
              'export const orders = pgTable("orders", { id: text("id").primaryKey(), userId: text("user_id").notNull() }, kovo({ domain: "order", key: (t) => t.id, owner: (t) => t.userId }));',
              '',
              'function currentPrincipal(ctx: { guard: { userId: string } }) { return ctx.guard; }',
              'kovoAnalyzerSummary(currentPrincipal, { returns: { kind: "guard", path: "" } });',
              '',
              'export const ordersForPrincipal = query("ordersForPrincipal", {',
              '  output: s.object({ id: s.string() }),',
              '  async load(_input: unknown, db: PgAsyncDatabase<any, any>, ctx: { guard: { userId: string } }) {',
              '    let wrapper = { principal: currentPrincipal(ctx) };',
              '    return db.select({ id: orders.id }).from(orders).where(eq(orders.userId, wrapper.principal.userId));',
              '  },',
              '});',
            ].join('\n'),
          },
        ],
      }),
    );

    expect(
      audit.scopeAudits.map((a) => ({ detail: a.detail, domain: a.domain, scope: a.scope })),
    ).toEqual([
      {
        detail:
          'narrow Authorization-gates-DATA subset: owner=userId; no owner-column session/principal predicate was proven',
        domain: 'order',
        scope: 'unknown',
      },
    ]);
  });

  it('accepts a literal element read from an explicitly summarized guard object', () => {
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
              'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
              'import { kovoAnalyzerSummary } from "@kovojs/drizzle";',
              '',
              'export const orders = pgTable("orders", { id: text("id").primaryKey(), userId: text("user_id").notNull() }, kovo({ domain: "order", key: (t) => t.id, owner: (t) => t.userId }));',
              '',
              'function currentPrincipal(ctx: { guard: { userId: string } }) { return ctx.guard; }',
              'kovoAnalyzerSummary(currentPrincipal, { returns: { kind: "guard", path: "" } });',
              '',
              'export const ordersForPrincipal = query("ordersForPrincipal", {',
              '  output: s.object({ id: s.string() }),',
              '  async load(_input: unknown, db: PgAsyncDatabase<any, any>, ctx: { guard: { userId: string } }) {',
              '    const principal = currentPrincipal(ctx);',
              '    return db.select({ id: orders.id }).from(orders).where(eq(orders.userId, principal["userId"]));',
              '  },',
              '});',
            ].join('\n'),
          },
        ],
      }),
    );

    expect(
      audit.scopeAudits.map((a) => ({ detail: a.detail, domain: a.domain, scope: a.scope })),
    ).toEqual([
      {
        detail:
          'narrow Authorization-gates-DATA subset: owner=userId; owner column compared to guard:userId',
        domain: 'order',
        scope: 'session',
      },
    ]);
  });

  it('keeps a computed element read from a summarized guard object scope:unknown', () => {
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
              'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
              'import { kovoAnalyzerSummary } from "@kovojs/drizzle";',
              '',
              'export const orders = pgTable("orders", { id: text("id").primaryKey(), userId: text("user_id").notNull() }, kovo({ domain: "order", key: (t) => t.id, owner: (t) => t.userId }));',
              '',
              'function currentPrincipal(ctx: { guard: { userId: string } }) { return ctx.guard; }',
              'kovoAnalyzerSummary(currentPrincipal, { returns: { kind: "guard", path: "" } });',
              '',
              'export const ordersForPrincipal = query("ordersForPrincipal", {',
              '  output: s.object({ id: s.string() }),',
              '  async load(_input: unknown, db: PgAsyncDatabase<any, any>, ctx: { guard: { userId: string } }) {',
              '    const principal = currentPrincipal(ctx);',
              '    const ownerField = "userId";',
              '    return db.select({ id: orders.id }).from(orders).where(eq(orders.userId, principal[ownerField]));',
              '  },',
              '});',
            ].join('\n'),
          },
        ],
      }),
    );

    expect(
      audit.scopeAudits.map((a) => ({ detail: a.detail, domain: a.domain, scope: a.scope })),
    ).toEqual([
      {
        detail:
          'narrow Authorization-gates-DATA subset: owner=userId; no owner-column session/principal predicate was proven',
        domain: 'order',
        scope: 'unknown',
      },
    ]);
  });

  it('accepts a nested readonly tuple wrapper around a summarized guard principal', () => {
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
              'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
              'import { kovoAnalyzerSummary } from "@kovojs/drizzle";',
              '',
              'export const orders = pgTable("orders", { id: text("id").primaryKey(), userId: text("user_id").notNull() }, kovo({ domain: "order", key: (t) => t.id, owner: (t) => t.userId }));',
              '',
              'const guardFns = {',
              '  currentGuardUser(ctx: { guard: { userId: string } }) { return ctx.guard.userId; },',
              '};',
              'kovoAnalyzerSummary(guardFns.currentGuardUser, { returns: { kind: "guard", path: "userId" } });',
              '',
              'export const ordersForGuard = query("ordersForGuard", {',
              '  output: s.object({ id: s.string() }),',
              '  async load(_input: unknown, db: PgAsyncDatabase<any, any>, ctx: { guard: { userId: string } }) {',
              '    const wrapper = { principal: [guardFns.currentGuardUser(ctx)] } as const;',
              '    return db.select({ id: orders.id }).from(orders).where(eq(orders.userId, wrapper.principal[0]));',
              '  },',
              '});',
            ].join('\n'),
          },
        ],
      }),
    );

    expect(
      audit.scopeAudits.map((a) => ({ detail: a.detail, domain: a.domain, scope: a.scope })),
    ).toEqual([
      {
        detail:
          'narrow Authorization-gates-DATA subset: owner=userId; owner column compared to guard:userId',
        domain: 'order',
        scope: 'session',
      },
    ]);
  });

  it('accepts const aliases to a summarized guard principal inside a readonly object wrapper', () => {
    const cases = [
      [
        'const guardUserId = guardFns.currentGuardUser(ctx);',
        'const wrapper = { principal: { userId: guardUserId } } as const;',
      ],
      [
        'const principal = { userId: guardFns.currentGuardUser(ctx) } as const;',
        'const wrapper = { principal: { userId: principal.userId } } as const;',
      ],
    ];

    for (const wrapperLines of cases) {
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
                'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
                'import { kovoAnalyzerSummary } from "@kovojs/drizzle";',
                '',
                'export const orders = pgTable("orders", { id: text("id").primaryKey(), userId: text("user_id").notNull() }, kovo({ domain: "order", key: (t) => t.id, owner: (t) => t.userId }));',
                '',
                'const guardFns = {',
                '  currentGuardUser(ctx: { guard: { userId: string } }) { return ctx.guard.userId; },',
                '};',
                'kovoAnalyzerSummary(guardFns.currentGuardUser, { returns: { kind: "guard", path: "userId" } });',
                '',
                'export const ordersForGuard = query("ordersForGuard", {',
                '  output: s.object({ id: s.string() }),',
                '  async load(_input: unknown, db: PgAsyncDatabase<any, any>, ctx: { guard: { userId: string } }) {',
                ...wrapperLines.map((line) => `    ${line}`),
                '    return db.select({ id: orders.id }).from(orders).where(eq(orders.userId, wrapper.principal.userId));',
                '  },',
                '});',
              ].join('\n'),
            },
          ],
        }),
      );

      expect(
        audit.scopeAudits.map((a) => ({ detail: a.detail, domain: a.domain, scope: a.scope })),
      ).toEqual([
        {
          detail:
            'narrow Authorization-gates-DATA subset: owner=userId; owner column compared to guard:userId',
          domain: 'order',
          scope: 'session',
        },
      ]);
    }
  });

  it('keeps mutable aliases inside a readonly object wrapper scope:unknown', () => {
    const cases = [
      [
        'let guardUserId = guardFns.currentGuardUser(ctx);',
        'const wrapper = { principal: { userId: guardUserId } } as const;',
      ],
      [
        'let principal = { userId: guardFns.currentGuardUser(ctx) };',
        'const wrapper = { principal: { userId: principal.userId } } as const;',
      ],
    ];

    for (const wrapperLines of cases) {
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
                'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
                'import { kovoAnalyzerSummary } from "@kovojs/drizzle";',
                '',
                'export const orders = pgTable("orders", { id: text("id").primaryKey(), userId: text("user_id").notNull() }, kovo({ domain: "order", key: (t) => t.id, owner: (t) => t.userId }));',
                '',
                'const guardFns = {',
                '  currentGuardUser(ctx: { guard: { userId: string } }) { return ctx.guard.userId; },',
                '};',
                'kovoAnalyzerSummary(guardFns.currentGuardUser, { returns: { kind: "guard", path: "userId" } });',
                '',
                'export const ordersForGuard = query("ordersForGuard", {',
                '  output: s.object({ id: s.string() }),',
                '  async load(_input: unknown, db: PgAsyncDatabase<any, any>, ctx: { guard: { userId: string } }) {',
                ...wrapperLines.map((line) => `    ${line}`),
                '    return db.select({ id: orders.id }).from(orders).where(eq(orders.userId, wrapper.principal.userId));',
                '  },',
                '});',
              ].join('\n'),
            },
          ],
        }),
      );

      expect(
        audit.scopeAudits.map((a) => ({ detail: a.detail, domain: a.domain, scope: a.scope })),
      ).toEqual([
        {
          detail:
            'narrow Authorization-gates-DATA subset: owner=userId; no owner-column session/principal predicate was proven',
          domain: 'order',
          scope: 'unknown',
        },
      ]);
    }
  });

  it('keeps a spread-backed nested tuple wrapper scope:unknown', () => {
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
              'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
              'import { kovoAnalyzerSummary } from "@kovojs/drizzle";',
              '',
              'export const orders = pgTable("orders", { id: text("id").primaryKey(), userId: text("user_id").notNull() }, kovo({ domain: "order", key: (t) => t.id, owner: (t) => t.userId }));',
              '',
              'const guardFns = {',
              '  currentGuardUser(ctx: { guard: { userId: string } }) { return ctx.guard.userId; },',
              '};',
              'kovoAnalyzerSummary(guardFns.currentGuardUser, { returns: { kind: "guard", path: "userId" } });',
              '',
              'export const ordersForGuard = query("ordersForGuard", {',
              '  output: s.object({ id: s.string() }),',
              '  async load(_input: unknown, db: PgAsyncDatabase<any, any>, ctx: { guard: { userId: string } }) {',
              '    const principal = [guardFns.currentGuardUser(ctx)] as const;',
              '    const wrapper = { principal: [...principal] } as const;',
              '    return db.select({ id: orders.id }).from(orders).where(eq(orders.userId, wrapper.principal[0]));',
              '  },',
              '});',
            ].join('\n'),
          },
        ],
      }),
    );

    expect(
      audit.scopeAudits.map((a) => ({ detail: a.detail, domain: a.domain, scope: a.scope })),
    ).toEqual([
      {
        detail:
          'narrow Authorization-gates-DATA subset: owner=userId; no owner-column session/principal predicate was proven',
        domain: 'order',
        scope: 'unknown',
      },
    ]);
  });

  it('keeps a mismatched property read from a summarized guard object scope:unknown', () => {
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
              'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
              'import { kovoAnalyzerSummary } from "@kovojs/drizzle";',
              '',
              'export const orders = pgTable("orders", { id: text("id").primaryKey(), userId: text("user_id").notNull() }, kovo({ domain: "order", key: (t) => t.id, owner: (t) => t.userId }));',
              '',
              'function currentActor(ctx: { guard: { actorId: string } }) { return ctx.guard; }',
              'kovoAnalyzerSummary(currentActor, { returns: { kind: "guard", path: "" } });',
              '',
              'export const ordersForActor = query("ordersForActor", {',
              '  output: s.object({ id: s.string() }),',
              '  async load(_input: unknown, db: PgAsyncDatabase<any, any>, ctx: { guard: { actorId: string } }) {',
              '    const principal = currentActor(ctx);',
              '    return db.select({ id: orders.id }).from(orders).where(eq(orders.userId, principal.actorId));',
              '  },',
              '});',
            ].join('\n'),
          },
        ],
      }),
    );

    expect(
      audit.scopeAudits.map((a) => ({ detail: a.detail, domain: a.domain, scope: a.scope })),
    ).toEqual([
      {
        detail:
          'narrow Authorization-gates-DATA subset: owner=userId; no owner-column session/principal predicate was proven',
        domain: 'order',
        scope: 'unknown',
      },
    ]);
  });

  it('accepts a prefixed property read from an explicitly summarized guard object', () => {
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
              'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
              'import { kovoAnalyzerSummary } from "@kovojs/drizzle";',
              '',
              'export const orders = pgTable("orders", { id: text("id").primaryKey(), "profile.userId": text("profile_user_id").notNull() }, kovo({ domain: "order", key: (t) => t.id, owner: "profile.userId" }));',
              '',
              'function currentProfile(ctx: { guard: { profile: { userId: string } } }) { return ctx.guard.profile; }',
              'kovoAnalyzerSummary(currentProfile, { returns: { kind: "guard", path: "profile" } });',
              '',
              'export const ordersForProfile = query("ordersForProfile", {',
              '  output: s.object({ id: s.string() }),',
              '  async load(_input: unknown, db: PgAsyncDatabase<any, any>, ctx: { guard: { profile: { userId: string } } }) {',
              '    const profile = currentProfile(ctx);',
              '    return db.select({ id: orders.id }).from(orders).where(eq(orders["profile.userId"], profile.userId));',
              '  },',
              '});',
            ].join('\n'),
          },
        ],
      }),
    );

    expect(
      audit.scopeAudits.map((a) => ({ detail: a.detail, domain: a.domain, scope: a.scope })),
    ).toEqual([
      {
        detail:
          'narrow Authorization-gates-DATA subset: owner=profile.userId; owner column compared to guard:profile.userId',
        domain: 'order',
        scope: 'session',
      },
    ]);
  });

  it('keeps a mismatched prefixed summarized guard-object field scope:unknown', () => {
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
              'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
              'import { kovoAnalyzerSummary } from "@kovojs/drizzle";',
              '',
              'export const orders = pgTable("orders", { id: text("id").primaryKey(), "profile.userId": text("profile_user_id").notNull() }, kovo({ domain: "order", key: (t) => t.id, owner: "profile.userId" }));',
              '',
              'function currentProfile(ctx: { guard: { profile: { actorId: string } } }) { return ctx.guard.profile; }',
              'kovoAnalyzerSummary(currentProfile, { returns: { kind: "guard", path: "profile" } });',
              '',
              'export const ordersForProfile = query("ordersForProfile", {',
              '  output: s.object({ id: s.string() }),',
              '  async load(_input: unknown, db: PgAsyncDatabase<any, any>, ctx: { guard: { profile: { actorId: string } } }) {',
              '    const profile = currentProfile(ctx);',
              '    return db.select({ id: orders.id }).from(orders).where(eq(orders["profile.userId"], profile.actorId));',
              '  },',
              '});',
            ].join('\n'),
          },
        ],
      }),
    );

    expect(
      audit.scopeAudits.map((a) => ({ detail: a.detail, domain: a.domain, scope: a.scope })),
    ).toEqual([
      {
        detail:
          'narrow Authorization-gates-DATA subset: owner=profile.userId; no owner-column session/principal predicate was proven',
        domain: 'order',
        scope: 'unknown',
      },
    ]);
  });

  it('accepts a nested destructured guard principal on the owner-column predicate', () => {
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
              'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
              '',
              'export const orders = pgTable("orders", { id: text("id").primaryKey(), userId: text("user_id").notNull() }, kovo({ domain: "order", key: (t) => t.id, owner: (t) => t.userId }));',
              '',
              'export const ordersForGuard = query("ordersForGuard", {',
              '  output: s.object({ id: s.string() }),',
              '  async load(_input: unknown, db: PgAsyncDatabase<any, any>, ctx: { guard: { userId: string } }) {',
              '    const { guard: { userId } } = ctx;',
              '    return db.select({ id: orders.id }).from(orders).where(eq(orders.userId, userId));',
              '  },',
              '});',
            ].join('\n'),
          },
        ],
      }),
    );

    expect(
      audit.scopeAudits.map((a) => ({ detail: a.detail, domain: a.domain, scope: a.scope })),
    ).toEqual([
      {
        detail:
          'narrow Authorization-gates-DATA subset: owner=userId; owner column compared to guard:userId',
        domain: 'order',
        scope: 'session',
      },
    ]);
  });

  it('accepts a const object-property alias of a matching guard principal', () => {
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
              'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
              '',
              'export const orders = pgTable("orders", { id: text("id").primaryKey(), userId: text("user_id").notNull() }, kovo({ domain: "order", key: (t) => t.id, owner: (t) => t.userId }));',
              '',
              'export const ordersForGuard = query("ordersForGuard", {',
              '  output: s.object({ id: s.string() }),',
              '  async load(_input: unknown, db: PgAsyncDatabase<any, any>, ctx: { guard: { userId: string } }) {',
              '    const principal = { userId: ctx.guard.userId };',
              '    return db.select({ id: orders.id }).from(orders).where(eq(orders.userId, principal.userId));',
              '  },',
              '});',
            ].join('\n'),
          },
        ],
      }),
    );

    expect(
      audit.scopeAudits.map((a) => ({ detail: a.detail, domain: a.domain, scope: a.scope })),
    ).toEqual([
      {
        detail:
          'narrow Authorization-gates-DATA subset: owner=userId; owner column compared to guard:userId',
        domain: 'order',
        scope: 'session',
      },
    ]);
  });

  it('accepts a dominated optional-chain guard principal on the owner-column predicate', () => {
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
              'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
              '',
              'export const orders = pgTable("orders", { id: text("id").primaryKey(), userId: text("user_id").notNull() }, kovo({ domain: "order", key: (t) => t.id, owner: (t) => t.userId }));',
              '',
              'export const ordersForGuard = query("ordersForGuard", {',
              '  output: s.object({ id: s.string() }),',
              '  async load(_input: unknown, db: PgAsyncDatabase<any, any>, ctx: { guard?: { userId?: string } }) {',
              '    if (!ctx.guard?.userId) throw new Error("unauthorized");',
              '    return db.select({ id: orders.id }).from(orders).where(eq(orders.userId, ctx.guard?.userId));',
              '  },',
              '});',
            ].join('\n'),
          },
        ],
      }),
    );

    expect(
      audit.scopeAudits.map((a) => ({ detail: a.detail, domain: a.domain, scope: a.scope })),
    ).toEqual([
      {
        detail:
          'narrow Authorization-gates-DATA subset: owner=userId; owner column compared to guard:userId',
        domain: 'order',
        scope: 'session',
      },
    ]);
  });

  it('keeps an unguarded optional-chain guard principal scope:unknown', () => {
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
              'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
              '',
              'export const orders = pgTable("orders", { id: text("id").primaryKey(), userId: text("user_id").notNull() }, kovo({ domain: "order", key: (t) => t.id, owner: (t) => t.userId }));',
              '',
              'export const ordersForGuard = query("ordersForGuard", {',
              '  output: s.object({ id: s.string() }),',
              '  async load(_input: unknown, db: PgAsyncDatabase<any, any>, ctx: { guard?: { userId?: string } }) {',
              '    return db.select({ id: orders.id }).from(orders).where(eq(orders.userId, ctx.guard?.userId));',
              '  },',
              '});',
            ].join('\n'),
          },
        ],
      }),
    );

    expect(
      audit.scopeAudits.map((a) => ({ detail: a.detail, domain: a.domain, scope: a.scope })),
    ).toEqual([
      {
        detail:
          'narrow Authorization-gates-DATA subset: owner=userId; no owner-column session/principal predicate was proven',
        domain: 'order',
        scope: 'unknown',
      },
    ]);
  });

  it('accepts a readonly object wrapper around a summarized property-call guard principal', () => {
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
              'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
              'import { kovoAnalyzerSummary } from "@kovojs/drizzle";',
              '',
              'export const orders = pgTable("orders", { id: text("id").primaryKey(), userId: text("user_id").notNull() }, kovo({ domain: "order", key: (t) => t.id, owner: (t) => t.userId }));',
              '',
              'const guardFns = {',
              '  currentGuardUser(ctx: { guard: { userId: string } }) { return ctx.guard.userId; },',
              '};',
              'kovoAnalyzerSummary(guardFns.currentGuardUser, { returns: { kind: "guard", path: "userId" } });',
              '',
              'export const ordersForGuard = query("ordersForGuard", {',
              '  output: s.object({ id: s.string() }),',
              '  async load(_input: unknown, db: PgAsyncDatabase<any, any>, ctx: { guard: { userId: string } }) {',
              '    const principal: Readonly<{ userId: string }> = { userId: guardFns.currentGuardUser(ctx) };',
              '    return db.select({ id: orders.id }).from(orders).where(eq(orders.userId, principal.userId));',
              '  },',
              '});',
            ].join('\n'),
          },
        ],
      }),
    );

    expect(
      audit.scopeAudits.map((a) => ({ detail: a.detail, domain: a.domain, scope: a.scope })),
    ).toEqual([
      {
        detail:
          'narrow Authorization-gates-DATA subset: owner=userId; owner column compared to guard:userId',
        domain: 'order',
        scope: 'session',
      },
    ]);
  });

  it('accepts a literal element read from a const object wrapper around a summarized guard principal', () => {
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
              'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
              'import { kovoAnalyzerSummary } from "@kovojs/drizzle";',
              '',
              'export const orders = pgTable("orders", { id: text("id").primaryKey(), userId: text("user_id").notNull() }, kovo({ domain: "order", key: (t) => t.id, owner: (t) => t.userId }));',
              '',
              'const guardFns = {',
              '  currentGuardUser(ctx: { guard: { userId: string } }) { return ctx.guard.userId; },',
              '};',
              'kovoAnalyzerSummary(guardFns.currentGuardUser, { returns: { kind: "guard", path: "userId" } });',
              '',
              'export const ordersForGuard = query("ordersForGuard", {',
              '  output: s.object({ id: s.string() }),',
              '  async load(_input: unknown, db: PgAsyncDatabase<any, any>, ctx: { guard: { userId: string } }) {',
              '    const principal = { userId: guardFns.currentGuardUser(ctx) };',
              '    return db.select({ id: orders.id }).from(orders).where(eq(orders.userId, principal["userId"]));',
              '  },',
              '});',
            ].join('\n'),
          },
        ],
      }),
    );

    expect(
      audit.scopeAudits.map((a) => ({ detail: a.detail, domain: a.domain, scope: a.scope })),
    ).toEqual([
      {
        detail:
          'narrow Authorization-gates-DATA subset: owner=userId; owner column compared to guard:userId',
        domain: 'order',
        scope: 'session',
      },
    ]);
  });

  it('accepts an Object.freeze scalar alias of a summarized guard principal', () => {
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
              'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
              'import { kovoAnalyzerSummary } from "@kovojs/drizzle";',
              '',
              'export const orders = pgTable("orders", { id: text("id").primaryKey(), userId: text("user_id").notNull() }, kovo({ domain: "order", key: (t) => t.id, owner: (t) => t.userId }));',
              '',
              'function currentGuardUser(ctx: { guard: { userId: string } }) { return ctx.guard.userId; }',
              'kovoAnalyzerSummary(currentGuardUser, { returns: { kind: "guard", path: "userId" } });',
              '',
              'export const ordersForGuard = query("ordersForGuard", {',
              '  output: s.object({ id: s.string() }),',
              '  async load(_input: unknown, db: PgAsyncDatabase<any, any>, ctx: { guard: { userId: string } }) {',
              '    const guardUserId = currentGuardUser(ctx);',
              '    const principal = Object.freeze(guardUserId);',
              '    return db.select({ id: orders.id }).from(orders).where(eq(orders.userId, principal));',
              '  },',
              '});',
            ].join('\n'),
          },
        ],
      }),
    );

    expect(
      audit.scopeAudits.map((a) => ({ detail: a.detail, domain: a.domain, scope: a.scope })),
    ).toEqual([
      {
        detail:
          'narrow Authorization-gates-DATA subset: owner=userId; owner column compared to guard:userId',
        domain: 'order',
        scope: 'session',
      },
    ]);
  });

  it('keeps unproven Object.freeze scalar guard aliases scope:unknown', () => {
    const cases = [
      {
        binding: 'const guardUserId = currentGuardUser(ctx);',
        helper:
          'function currentGuardUser(ctx: { guard: { userId: string } }) { return ctx.guard.userId; }',
        summary: '',
      },
      {
        binding: 'const guardUserId = currentGuardOrg(ctx);',
        helper:
          'function currentGuardOrg(ctx: { guard: { orgId: string } }) { return ctx.guard.orgId; }',
        summary:
          'kovoAnalyzerSummary(currentGuardOrg, { returns: { kind: "guard", path: "orgId" } });',
      },
      {
        binding: 'let guardUserId = currentGuardUser(ctx);',
        helper:
          'function currentGuardUser(ctx: { guard: { userId: string } }) { return ctx.guard.userId; }',
        summary:
          'kovoAnalyzerSummary(currentGuardUser, { returns: { kind: "guard", path: "userId" } });',
      },
    ];

    for (const testCase of cases) {
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
                'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
                'import { kovoAnalyzerSummary } from "@kovojs/drizzle";',
                '',
                'export const orders = pgTable("orders", { id: text("id").primaryKey(), userId: text("user_id").notNull() }, kovo({ domain: "order", key: (t) => t.id, owner: (t) => t.userId }));',
                '',
                testCase.helper,
                testCase.summary,
                '',
                'export const ordersForGuard = query("ordersForGuard", {',
                '  output: s.object({ id: s.string() }),',
                '  async load(_input: unknown, db: PgAsyncDatabase<any, any>, ctx: { guard: { userId: string; orgId: string } }) {',
                `    ${testCase.binding}`,
                '    const principal = Object.freeze(guardUserId);',
                '    return db.select({ id: orders.id }).from(orders).where(eq(orders.userId, principal));',
                '  },',
                '});',
              ].join('\n'),
            },
          ],
        }),
      );

      expect(
        audit.scopeAudits.map((a) => ({ detail: a.detail, domain: a.domain, scope: a.scope })),
      ).toEqual([
        {
          detail:
            'narrow Authorization-gates-DATA subset: owner=userId; no owner-column session/principal predicate was proven',
          domain: 'order',
          scope: 'unknown',
        },
      ]);
    }
  });

  it('accepts an Object.freeze object wrapper around a summarized guard scalar alias', () => {
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
              'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
              'import { kovoAnalyzerSummary } from "@kovojs/drizzle";',
              '',
              'export const orders = pgTable("orders", { id: text("id").primaryKey(), userId: text("user_id").notNull() }, kovo({ domain: "order", key: (t) => t.id, owner: (t) => t.userId }));',
              '',
              'function currentGuardUser(ctx: { guard: { userId: string } }) { return ctx.guard.userId; }',
              'kovoAnalyzerSummary(currentGuardUser, { returns: { kind: "guard", path: "userId" } });',
              '',
              'export const ordersForGuard = query("ordersForGuard", {',
              '  output: s.object({ id: s.string() }),',
              '  async load(_input: unknown, db: PgAsyncDatabase<any, any>, ctx: { guard: { userId: string } }) {',
              '    const guardUserId = currentGuardUser(ctx);',
              '    const wrapper = Object.freeze({ userId: guardUserId });',
              '    return db.select({ id: orders.id }).from(orders).where(eq(orders.userId, wrapper.userId));',
              '  },',
              '});',
            ].join('\n'),
          },
        ],
      }),
    );

    expect(
      audit.scopeAudits.map((a) => ({ detail: a.detail, domain: a.domain, scope: a.scope })),
    ).toEqual([
      {
        detail:
          'narrow Authorization-gates-DATA subset: owner=userId; owner column compared to guard:userId',
        domain: 'order',
        scope: 'session',
      },
    ]);
  });

  it('keeps unproven Object.freeze object-wrapped guard scalar aliases scope:unknown', () => {
    const cases = [
      {
        lines: [
          'const guardUserId = currentGuardUser(ctx);',
          'const wrapper = Object.freeze({ userId: guardUserId });',
        ],
        summary: '',
      },
      {
        lines: [
          'const guardUserId = currentGuardOrg(ctx);',
          'const wrapper = Object.freeze({ userId: guardUserId });',
        ],
        summary:
          'kovoAnalyzerSummary(currentGuardOrg, { returns: { kind: "guard", path: "orgId" } });',
      },
      {
        lines: [
          'let guardUserId = currentGuardUser(ctx);',
          'const wrapper = Object.freeze({ userId: guardUserId });',
        ],
        summary:
          'kovoAnalyzerSummary(currentGuardUser, { returns: { kind: "guard", path: "userId" } });',
      },
      {
        extraParam: ', override: { userId: string }',
        lines: [
          'const guardUserId = currentGuardUser(ctx);',
          'const wrapper = Object.freeze({ userId: guardUserId, ...override });',
        ],
        summary:
          'kovoAnalyzerSummary(currentGuardUser, { returns: { kind: "guard", path: "userId" } });',
      },
      {
        lines: [
          'const guardUserId = currentGuardUser(ctx);',
          'let wrapper = Object.freeze({ userId: guardUserId });',
        ],
        summary:
          'kovoAnalyzerSummary(currentGuardUser, { returns: { kind: "guard", path: "userId" } });',
      },
      {
        lines: [
          'const guardUserId = currentGuardUser(ctx);',
          'const wrapper = Object.freeze({ userId: guardUserId });',
          'const ownerKey = "userId";',
        ],
        predicate: 'eq(orders.userId, wrapper[ownerKey])',
        summary:
          'kovoAnalyzerSummary(currentGuardUser, { returns: { kind: "guard", path: "userId" } });',
      },
    ];

    for (const testCase of cases) {
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
                'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
                'import { kovoAnalyzerSummary } from "@kovojs/drizzle";',
                '',
                'export const orders = pgTable("orders", { id: text("id").primaryKey(), userId: text("user_id").notNull() }, kovo({ domain: "order", key: (t) => t.id, owner: (t) => t.userId }));',
                '',
                'function currentGuardUser(ctx: { guard: { userId: string } }) { return ctx.guard.userId; }',
                'function currentGuardOrg(ctx: { guard: { orgId: string } }) { return ctx.guard.orgId; }',
                testCase.summary,
                '',
                'export const ordersForGuard = query("ordersForGuard", {',
                '  output: s.object({ id: s.string() }),',
                `  async load(_input: unknown, db: PgAsyncDatabase<any, any>, ctx: { guard: { userId: string; orgId: string } }${testCase.extraParam ?? ''}) {`,
                ...testCase.lines.map((line) => `    ${line}`),
                `    return db.select({ id: orders.id }).from(orders).where(${testCase.predicate ?? 'eq(orders.userId, wrapper.userId)'});`,
                '  },',
                '});',
              ].join('\n'),
            },
          ],
        }),
      );

      expect(
        audit.scopeAudits.map((a) => ({ detail: a.detail, domain: a.domain, scope: a.scope })),
      ).toEqual([
        {
          detail:
            'narrow Authorization-gates-DATA subset: owner=userId; no owner-column session/principal predicate was proven',
          domain: 'order',
          scope: 'unknown',
        },
      ]);
    }
  });

  it('accepts a const tuple alias of a summarized guard principal', () => {
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
              'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
              'import { kovoAnalyzerSummary } from "@kovojs/drizzle";',
              '',
              'export const orders = pgTable("orders", { id: text("id").primaryKey(), userId: text("user_id").notNull() }, kovo({ domain: "order", key: (t) => t.id, owner: (t) => t.userId }));',
              '',
              'const guardFns = {',
              '  currentGuardUser(ctx: { guard: { userId: string } }) { return ctx.guard.userId; },',
              '};',
              'kovoAnalyzerSummary(guardFns.currentGuardUser, { returns: { kind: "guard", path: "userId" } });',
              '',
              'export const ordersForGuard = query("ordersForGuard", {',
              '  output: s.object({ id: s.string() }),',
              '  async load(_input: unknown, db: PgAsyncDatabase<any, any>, ctx: { guard: { userId: string } }) {',
              '    const principal = [guardFns.currentGuardUser(ctx)] as const;',
              '    return db.select({ id: orders.id }).from(orders).where(eq(orders.userId, principal[0]));',
              '  },',
              '});',
            ].join('\n'),
          },
        ],
      }),
    );

    expect(
      audit.scopeAudits.map((a) => ({ detail: a.detail, domain: a.domain, scope: a.scope })),
    ).toEqual([
      {
        detail:
          'narrow Authorization-gates-DATA subset: owner=userId; owner column compared to guard:userId',
        domain: 'order',
        scope: 'session',
      },
    ]);
  });

  it('accepts a const tuple destructuring alias of a summarized guard principal', () => {
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
              'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
              'import { kovoAnalyzerSummary } from "@kovojs/drizzle";',
              '',
              'export const orders = pgTable("orders", { id: text("id").primaryKey(), userId: text("user_id").notNull() }, kovo({ domain: "order", key: (t) => t.id, owner: (t) => t.userId }));',
              '',
              'const guardFns = {',
              '  currentGuardUser(ctx: { guard: { userId: string } }) { return ctx.guard.userId; },',
              '};',
              'kovoAnalyzerSummary(guardFns.currentGuardUser, { returns: { kind: "guard", path: "userId" } });',
              '',
              'export const ordersForGuard = query("ordersForGuard", {',
              '  output: s.object({ id: s.string() }),',
              '  async load(_input: unknown, db: PgAsyncDatabase<any, any>, ctx: { guard: { userId: string } }) {',
              '    const [guardUserId] = [guardFns.currentGuardUser(ctx)] as const;',
              '    return db.select({ id: orders.id }).from(orders).where(eq(orders.userId, guardUserId));',
              '  },',
              '});',
            ].join('\n'),
          },
        ],
      }),
    );

    expect(
      audit.scopeAudits.map((a) => ({ detail: a.detail, domain: a.domain, scope: a.scope })),
    ).toEqual([
      {
        detail:
          'narrow Authorization-gates-DATA subset: owner=userId; owner column compared to guard:userId',
        domain: 'order',
        scope: 'session',
      },
    ]);
  });

  it('accepts a const object destructuring alias of a summarized guard principal', () => {
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
              'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
              'import { kovoAnalyzerSummary } from "@kovojs/drizzle";',
              '',
              'export const orders = pgTable("orders", { id: text("id").primaryKey(), userId: text("user_id").notNull() }, kovo({ domain: "order", key: (t) => t.id, owner: (t) => t.userId }));',
              '',
              'const guardFns = {',
              '  currentGuardUser(ctx: { guard: { userId: string } }) { return ctx.guard.userId; },',
              '};',
              'kovoAnalyzerSummary(guardFns.currentGuardUser, { returns: { kind: "guard", path: "userId" } });',
              '',
              'export const ordersForGuard = query("ordersForGuard", {',
              '  output: s.object({ id: s.string() }),',
              '  async load(_input: unknown, db: PgAsyncDatabase<any, any>, ctx: { guard: { userId: string } }) {',
              '    const { userId: guardUserId } = { userId: guardFns.currentGuardUser(ctx) } as const;',
              '    return db.select({ id: orders.id }).from(orders).where(eq(orders.userId, guardUserId));',
              '  },',
              '});',
            ].join('\n'),
          },
        ],
      }),
    );

    expect(
      audit.scopeAudits.map((a) => ({ detail: a.detail, domain: a.domain, scope: a.scope })),
    ).toEqual([
      {
        detail:
          'narrow Authorization-gates-DATA subset: owner=userId; owner column compared to guard:userId',
        domain: 'order',
        scope: 'session',
      },
    ]);
  });

  it('accepts a nested const object destructuring alias of a summarized guard object', () => {
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
              'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
              'import { kovoAnalyzerSummary } from "@kovojs/drizzle";',
              '',
              'export const orders = pgTable("orders", { id: text("id").primaryKey(), userId: text("user_id").notNull() }, kovo({ domain: "order", key: (t) => t.id, owner: (t) => t.userId }));',
              '',
              'function currentPrincipal(ctx: { guard: { userId: string } }) { return ctx.guard; }',
              'kovoAnalyzerSummary(currentPrincipal, { returns: { kind: "guard", path: "" } });',
              '',
              'export const ordersForGuard = query("ordersForGuard", {',
              '  output: s.object({ id: s.string() }),',
              '  async load(_input: unknown, db: PgAsyncDatabase<any, any>, ctx: { guard: { userId: string } }) {',
              '    const wrapper = { principal: currentPrincipal(ctx) } as const;',
              '    const { principal: { userId: guardUserId } } = wrapper;',
              '    return db.select({ id: orders.id }).from(orders).where(eq(orders.userId, guardUserId));',
              '  },',
              '});',
            ].join('\n'),
          },
        ],
      }),
    );

    expect(
      audit.scopeAudits.map((a) => ({ detail: a.detail, domain: a.domain, scope: a.scope })),
    ).toEqual([
      {
        detail:
          'narrow Authorization-gates-DATA subset: owner=userId; owner column compared to guard:userId',
        domain: 'order',
        scope: 'session',
      },
    ]);
  });

  it('keeps ambiguous nested object destructuring guard wrappers scope:unknown', () => {
    const cases = [
      {
        extraParam: ', override: { principal: { userId: string } }',
        predicate: 'eq(orders.userId, guardUserId)',
        wrapper: [
          'const wrapper = { principal: currentPrincipal(ctx), ...override } as const;',
          'const { principal: { userId: guardUserId } } = wrapper;',
        ],
      },
      {
        extraParam: ', principal: { userId: string }',
        predicate: 'eq(orders.userId, guardUserId)',
        wrapper: [
          'const wrapper = { principal: currentPrincipal(ctx), principal } as const;',
          'const { principal: { userId: guardUserId } } = wrapper;',
        ],
      },
      {
        extraParam: '',
        predicate: 'eq(orders.userId, guardUserId)',
        wrapper: [
          'const wrapper = { principal: currentPrincipal(ctx) } as const;',
          'const { principal: { [ownerKey]: guardUserId } } = wrapper;',
          'const ownerKey = "userId";',
        ],
      },
      {
        extraParam: '',
        predicate: 'eq(orders.userId, guardUserId)',
        wrapper: [
          'let wrapper = { principal: currentPrincipal(ctx) } as const;',
          'const { principal: { userId: guardUserId } } = wrapper;',
        ],
      },
      {
        extraParam: '',
        predicate: 'eq(orders.userId, guardUserId)',
        wrapper: [
          'const wrapper = { principal: currentPrincipal(ctx) } as const;',
          'const { principal: { userId: guardUserId = "fallback" } } = wrapper;',
        ],
      },
    ];

    for (const testCase of cases) {
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
                'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
                'import { kovoAnalyzerSummary } from "@kovojs/drizzle";',
                '',
                'export const orders = pgTable("orders", { id: text("id").primaryKey(), userId: text("user_id").notNull() }, kovo({ domain: "order", key: (t) => t.id, owner: (t) => t.userId }));',
                '',
                'function currentPrincipal(ctx: { guard: { userId: string } }) { return ctx.guard; }',
                'kovoAnalyzerSummary(currentPrincipal, { returns: { kind: "guard", path: "" } });',
                '',
                'export const ordersForGuard = query("ordersForGuard", {',
                '  output: s.object({ id: s.string() }),',
                `  async load(_input: unknown, db: PgAsyncDatabase<any, any>, ctx: { guard: { userId: string } }${testCase.extraParam}) {`,
                ...testCase.wrapper.map((line) => `    ${line}`),
                `    return db.select({ id: orders.id }).from(orders).where(${testCase.predicate});`,
                '  },',
                '});',
              ].join('\n'),
            },
          ],
        }),
      );

      expect(
        audit.scopeAudits.map((a) => ({ detail: a.detail, domain: a.domain, scope: a.scope })),
      ).toEqual([
        {
          detail:
            'narrow Authorization-gates-DATA subset: owner=userId; no owner-column session/principal predicate was proven',
          domain: 'order',
          scope: 'unknown',
        },
      ]);
    }
  });

  it('accepts nullish and logical expressions when both sides prove the same guard principal', () => {
    const expressions = [
      'guardFns.currentGuardUser(ctx) ?? guardFns.fallbackGuardUser(ctx)',
      'guardFns.currentGuardUser(ctx) || guardFns.fallbackGuardUser(ctx)',
      'guardFns.currentGuardUser(ctx) && guardFns.fallbackGuardUser(ctx)',
    ];

    for (const expression of expressions) {
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
                'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
                'import { kovoAnalyzerSummary } from "@kovojs/drizzle";',
                '',
                'export const orders = pgTable("orders", { id: text("id").primaryKey(), userId: text("user_id").notNull() }, kovo({ domain: "order", key: (t) => t.id, owner: (t) => t.userId }));',
                '',
                'const guardFns = {',
                '  currentGuardUser(ctx: { guard: { userId: string } }) { return ctx.guard.userId; },',
                '  fallbackGuardUser(ctx: { guard: { userId: string } }) { return ctx.guard.userId; },',
                '};',
                'kovoAnalyzerSummary(guardFns.currentGuardUser, { returns: { kind: "guard", path: "userId" } });',
                'kovoAnalyzerSummary(guardFns.fallbackGuardUser, { returns: { kind: "guard", path: "userId" } });',
                '',
                'export const ordersForGuard = query("ordersForGuard", {',
                '  output: s.object({ id: s.string() }),',
                '  async load(_input: unknown, db: PgAsyncDatabase<any, any>, ctx: { guard: { userId: string } }) {',
                `    return db.select({ id: orders.id }).from(orders).where(eq(orders.userId, ${expression}));`,
                '  },',
                '});',
              ].join('\n'),
            },
          ],
        }),
      );

      expect(
        audit.scopeAudits.map((a) => ({ detail: a.detail, domain: a.domain, scope: a.scope })),
      ).toEqual([
        {
          detail:
            'narrow Authorization-gates-DATA subset: owner=userId; owner column compared to guard:userId',
          domain: 'order',
          scope: 'session',
        },
      ]);
    }
  });

  it('keeps nullish and logical expressions with mismatched or ambiguous principals scope:unknown', () => {
    const expressions = [
      'guardFns.currentGuardUser(ctx) ?? guardFns.currentActor(ctx)',
      'guardFns.currentGuardUser(ctx) || input.userId',
      'guardFns.currentGuardUser(ctx) && mutablePrincipal',
    ];

    for (const expression of expressions) {
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
                'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
                'import { kovoAnalyzerSummary } from "@kovojs/drizzle";',
                '',
                'export const orders = pgTable("orders", { id: text("id").primaryKey(), userId: text("user_id").notNull() }, kovo({ domain: "order", key: (t) => t.id, owner: (t) => t.userId }));',
                '',
                'const guardFns = {',
                '  currentGuardUser(ctx: { guard: { userId: string; actorId: string } }) { return ctx.guard.userId; },',
                '  currentActor(ctx: { guard: { userId: string; actorId: string } }) { return ctx.guard.actorId; },',
                '};',
                'kovoAnalyzerSummary(guardFns.currentGuardUser, { returns: { kind: "guard", path: "userId" } });',
                'kovoAnalyzerSummary(guardFns.currentActor, { returns: { kind: "guard", path: "actorId" } });',
                '',
                'export const ordersForGuard = query("ordersForGuard", {',
                '  output: s.object({ id: s.string() }),',
                '  async load(input: { userId: string }, db: PgAsyncDatabase<any, any>, ctx: { guard: { userId: string; actorId: string } }) {',
                '    let mutablePrincipal = guardFns.currentGuardUser(ctx);',
                `    return db.select({ id: orders.id }).from(orders).where(eq(orders.userId, ${expression}));`,
                '  },',
                '});',
              ].join('\n'),
            },
          ],
        }),
      );

      expect(
        audit.scopeAudits.map((a) => ({ detail: a.detail, domain: a.domain, scope: a.scope })),
      ).toEqual([
        {
          detail:
            'narrow Authorization-gates-DATA subset: owner=userId; no owner-column session/principal predicate was proven',
          domain: 'order',
          scope: 'unknown',
        },
      ]);
    }
  });

  it('keeps a defaulted object destructuring guard principal scope:unknown', () => {
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
              'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
              'import { kovoAnalyzerSummary } from "@kovojs/drizzle";',
              '',
              'export const orders = pgTable("orders", { id: text("id").primaryKey(), userId: text("user_id").notNull() }, kovo({ domain: "order", key: (t) => t.id, owner: (t) => t.userId }));',
              '',
              'const guardFns = {',
              '  currentGuardUser(ctx: { guard: { userId: string } }) { return ctx.guard.userId; },',
              '};',
              'kovoAnalyzerSummary(guardFns.currentGuardUser, { returns: { kind: "guard", path: "userId" } });',
              '',
              'export const ordersForGuard = query("ordersForGuard", {',
              '  output: s.object({ id: s.string() }),',
              '  async load(_input: unknown, db: PgAsyncDatabase<any, any>, ctx: { guard: { userId: string } }) {',
              '    const { userId: guardUserId = guardFns.currentGuardUser(ctx) } = {} as { userId?: string };',
              '    return db.select({ id: orders.id }).from(orders).where(eq(orders.userId, guardUserId));',
              '  },',
              '});',
            ].join('\n'),
          },
        ],
      }),
    );

    expect(
      audit.scopeAudits.map((a) => ({ detail: a.detail, domain: a.domain, scope: a.scope })),
    ).toEqual([
      {
        detail:
          'narrow Authorization-gates-DATA subset: owner=userId; no owner-column session/principal predicate was proven',
        domain: 'order',
        scope: 'unknown',
      },
    ]);
  });

  it('keeps a spread-backed object destructuring guard principal scope:unknown', () => {
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
              'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
              'import { kovoAnalyzerSummary } from "@kovojs/drizzle";',
              '',
              'export const orders = pgTable("orders", { id: text("id").primaryKey(), userId: text("user_id").notNull() }, kovo({ domain: "order", key: (t) => t.id, owner: (t) => t.userId }));',
              '',
              'const guardFns = {',
              '  currentGuardUser(ctx: { guard: { userId: string } }) { return ctx.guard.userId; },',
              '};',
              'kovoAnalyzerSummary(guardFns.currentGuardUser, { returns: { kind: "guard", path: "userId" } });',
              '',
              'export const ordersForGuard = query("ordersForGuard", {',
              '  output: s.object({ id: s.string() }),',
              '  async load(_input: unknown, db: PgAsyncDatabase<any, any>, ctx: { guard: { userId: string } }) {',
              '    const principal = { userId: guardFns.currentGuardUser(ctx) } as const;',
              '    const { userId: guardUserId } = { ...principal } as const;',
              '    return db.select({ id: orders.id }).from(orders).where(eq(orders.userId, guardUserId));',
              '  },',
              '});',
            ].join('\n'),
          },
        ],
      }),
    );

    expect(
      audit.scopeAudits.map((a) => ({ detail: a.detail, domain: a.domain, scope: a.scope })),
    ).toEqual([
      {
        detail:
          'narrow Authorization-gates-DATA subset: owner=userId; no owner-column session/principal predicate was proven',
        domain: 'order',
        scope: 'unknown',
      },
    ]);
  });

  it('rejects a guard principal that does not match the owner column symbol', () => {
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
              'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
              'import { kovoAnalyzerSummary } from "@kovojs/drizzle";',
              '',
              'export const orders = pgTable("orders", { id: text("id").primaryKey(), userId: text("user_id").notNull() }, kovo({ domain: "order", key: (t) => t.id, owner: (t) => t.userId }));',
              '',
              'function currentActor(ctx: { guard: { actorId: string } }) { return ctx.guard.actorId; }',
              'kovoAnalyzerSummary(currentActor, { returns: { kind: "guard", path: "actorId" } });',
              '',
              'export const ordersForActor = query("ordersForActor", {',
              '  output: s.object({ id: s.string() }),',
              '  async load(_input: unknown, db: PgAsyncDatabase<any, any>, ctx: { guard: { actorId: string } }) {',
              '    const actorId = currentActor(ctx);',
              '    return db.select({ id: orders.id }).from(orders).where(eq(orders.userId, actorId));',
              '  },',
              '});',
            ].join('\n'),
          },
        ],
      }),
    );

    expect(
      audit.scopeAudits.map((a) => ({ detail: a.detail, domain: a.domain, scope: a.scope })),
    ).toEqual([
      {
        detail:
          'narrow Authorization-gates-DATA subset: owner=userId; no owner-column session/principal predicate was proven',
        domain: 'order',
        scope: 'unknown',
      },
    ]);
  });

  it('keeps a mismatched tuple destructuring guard principal scope:unknown', () => {
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
              'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
              'import { kovoAnalyzerSummary } from "@kovojs/drizzle";',
              '',
              'export const orders = pgTable("orders", { id: text("id").primaryKey(), userId: text("user_id").notNull() }, kovo({ domain: "order", key: (t) => t.id, owner: (t) => t.userId }));',
              '',
              'const guardFns = {',
              '  currentActor(ctx: { guard: { actorId: string } }) { return ctx.guard.actorId; },',
              '};',
              'kovoAnalyzerSummary(guardFns.currentActor, { returns: { kind: "guard", path: "actorId" } });',
              '',
              'export const ordersForActor = query("ordersForActor", {',
              '  output: s.object({ id: s.string() }),',
              '  async load(_input: unknown, db: PgAsyncDatabase<any, any>, ctx: { guard: { actorId: string } }) {',
              '    const [actorId] = [guardFns.currentActor(ctx)] as const;',
              '    return db.select({ id: orders.id }).from(orders).where(eq(orders.userId, actorId));',
              '  },',
              '});',
            ].join('\n'),
          },
        ],
      }),
    );

    expect(
      audit.scopeAudits.map((a) => ({ detail: a.detail, domain: a.domain, scope: a.scope })),
    ).toEqual([
      {
        detail:
          'narrow Authorization-gates-DATA subset: owner=userId; no owner-column session/principal predicate was proven',
        domain: 'order',
        scope: 'unknown',
      },
    ]);
  });

  it('keeps an unsummarized tuple destructuring guard helper scope:unknown', () => {
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
              'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
              '',
              'export const orders = pgTable("orders", { id: text("id").primaryKey(), userId: text("user_id").notNull() }, kovo({ domain: "order", key: (t) => t.id, owner: (t) => t.userId }));',
              '',
              'function currentGuardUser(ctx: { guard: { userId: string } }) { return ctx.guard.userId; }',
              '',
              'export const ordersForGuard = query("ordersForGuard", {',
              '  output: s.object({ id: s.string() }),',
              '  async load(_input: unknown, db: PgAsyncDatabase<any, any>, ctx: { guard: { userId: string } }) {',
              '    const [guardUserId] = [currentGuardUser(ctx)] as const;',
              '    return db.select({ id: orders.id }).from(orders).where(eq(orders.userId, guardUserId));',
              '  },',
              '});',
            ].join('\n'),
          },
        ],
      }),
    );

    expect(
      audit.scopeAudits.map((a) => ({ detail: a.detail, domain: a.domain, scope: a.scope })),
    ).toEqual([
      {
        detail:
          'narrow Authorization-gates-DATA subset: owner=userId; no owner-column session/principal predicate was proven',
        domain: 'order',
        scope: 'unknown',
      },
    ]);
  });

  it('keeps a computed tuple index guard principal scope:unknown', () => {
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
              'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
              'import { kovoAnalyzerSummary } from "@kovojs/drizzle";',
              '',
              'export const orders = pgTable("orders", { id: text("id").primaryKey(), userId: text("user_id").notNull() }, kovo({ domain: "order", key: (t) => t.id, owner: (t) => t.userId }));',
              '',
              'const guardFns = {',
              '  currentGuardUser(ctx: { guard: { userId: string } }) { return ctx.guard.userId; },',
              '};',
              'kovoAnalyzerSummary(guardFns.currentGuardUser, { returns: { kind: "guard", path: "userId" } });',
              '',
              'export const ordersForGuard = query("ordersForGuard", {',
              '  output: s.object({ id: s.string() }),',
              '  async load(_input: unknown, db: PgAsyncDatabase<any, any>, ctx: { guard: { userId: string } }) {',
              '    const principal = [guardFns.currentGuardUser(ctx)] as const;',
              '    const ownerIndex = 0;',
              '    return db.select({ id: orders.id }).from(orders).where(eq(orders.userId, principal[ownerIndex]));',
              '  },',
              '});',
            ].join('\n'),
          },
        ],
      }),
    );

    expect(
      audit.scopeAudits.map((a) => ({ detail: a.detail, domain: a.domain, scope: a.scope })),
    ).toEqual([
      {
        detail:
          'narrow Authorization-gates-DATA subset: owner=userId; no owner-column session/principal predicate was proven',
        domain: 'order',
        scope: 'unknown',
      },
    ]);
  });

  it('keeps a mutable object wrapper around a summarized guard principal scope:unknown', () => {
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
              'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
              'import { kovoAnalyzerSummary } from "@kovojs/drizzle";',
              '',
              'export const orders = pgTable("orders", { id: text("id").primaryKey(), userId: text("user_id").notNull() }, kovo({ domain: "order", key: (t) => t.id, owner: (t) => t.userId }));',
              '',
              'const guardFns = {',
              '  currentGuardUser(ctx: { guard: { userId: string } }) { return ctx.guard.userId; },',
              '};',
              'kovoAnalyzerSummary(guardFns.currentGuardUser, { returns: { kind: "guard", path: "userId" } });',
              '',
              'export const ordersForGuard = query("ordersForGuard", {',
              '  output: s.object({ id: s.string() }),',
              '  async load(_input: unknown, db: PgAsyncDatabase<any, any>, ctx: { guard: { userId: string } }) {',
              '    let principal = { userId: guardFns.currentGuardUser(ctx) };',
              '    return db.select({ id: orders.id }).from(orders).where(eq(orders.userId, principal["userId"]));',
              '  },',
              '});',
            ].join('\n'),
          },
        ],
      }),
    );

    expect(
      audit.scopeAudits.map((a) => ({ detail: a.detail, domain: a.domain, scope: a.scope })),
    ).toEqual([
      {
        detail:
          'narrow Authorization-gates-DATA subset: owner=userId; no owner-column session/principal predicate was proven',
        domain: 'order',
        scope: 'unknown',
      },
    ]);
  });

  it('keeps a mismatched tuple-wrapped guard principal scope:unknown', () => {
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
              'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
              'import { kovoAnalyzerSummary } from "@kovojs/drizzle";',
              '',
              'export const orders = pgTable("orders", { id: text("id").primaryKey(), userId: text("user_id").notNull() }, kovo({ domain: "order", key: (t) => t.id, owner: (t) => t.userId }));',
              '',
              'const guardFns = {',
              '  currentActor(ctx: { guard: { actorId: string } }) { return ctx.guard.actorId; },',
              '};',
              'kovoAnalyzerSummary(guardFns.currentActor, { returns: { kind: "guard", path: "actorId" } });',
              '',
              'export const ordersForActor = query("ordersForActor", {',
              '  output: s.object({ id: s.string() }),',
              '  async load(_input: unknown, db: PgAsyncDatabase<any, any>, ctx: { guard: { actorId: string } }) {',
              '    const principal = [guardFns.currentActor(ctx)] as const;',
              '    return db.select({ id: orders.id }).from(orders).where(eq(orders.userId, principal[0]));',
              '  },',
              '});',
            ].join('\n'),
          },
        ],
      }),
    );

    expect(
      audit.scopeAudits.map((a) => ({ detail: a.detail, domain: a.domain, scope: a.scope })),
    ).toEqual([
      {
        detail:
          'narrow Authorization-gates-DATA subset: owner=userId; no owner-column session/principal predicate was proven',
        domain: 'order',
        scope: 'unknown',
      },
    ]);
  });

  it('keeps an unsummarized tuple-wrapped guard helper scope:unknown', () => {
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
              'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
              '',
              'export const orders = pgTable("orders", { id: text("id").primaryKey(), userId: text("user_id").notNull() }, kovo({ domain: "order", key: (t) => t.id, owner: (t) => t.userId }));',
              '',
              'function currentGuardUser(ctx: { guard: { userId: string } }) { return ctx.guard.userId; }',
              '',
              'export const ordersForGuard = query("ordersForGuard", {',
              '  output: s.object({ id: s.string() }),',
              '  async load(_input: unknown, db: PgAsyncDatabase<any, any>, ctx: { guard: { userId: string } }) {',
              '    const principal = [currentGuardUser(ctx)] as const;',
              '    return db.select({ id: orders.id }).from(orders).where(eq(orders.userId, principal[0]));',
              '  },',
              '});',
            ].join('\n'),
          },
        ],
      }),
    );

    expect(
      audit.scopeAudits.map((a) => ({ detail: a.detail, domain: a.domain, scope: a.scope })),
    ).toEqual([
      {
        detail:
          'narrow Authorization-gates-DATA subset: owner=userId; no owner-column session/principal predicate was proven',
        domain: 'order',
        scope: 'unknown',
      },
    ]);
  });

  it('keeps a mismatched readonly object-wrapped property-call guard principal scope:unknown', () => {
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
              'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
              'import { kovoAnalyzerSummary } from "@kovojs/drizzle";',
              '',
              'export const orders = pgTable("orders", { id: text("id").primaryKey(), userId: text("user_id").notNull() }, kovo({ domain: "order", key: (t) => t.id, owner: (t) => t.userId }));',
              '',
              'const guardFns = {',
              '  currentActor(ctx: { guard: { actorId: string } }) { return ctx.guard.actorId; },',
              '};',
              'kovoAnalyzerSummary(guardFns.currentActor, { returns: { kind: "guard", path: "actorId" } });',
              '',
              'export const ordersForActor = query("ordersForActor", {',
              '  output: s.object({ id: s.string() }),',
              '  async load(_input: unknown, db: PgAsyncDatabase<any, any>, ctx: { guard: { actorId: string } }) {',
              '    const principal: Readonly<{ userId: string }> = { userId: guardFns.currentActor(ctx) };',
              '    return db.select({ id: orders.id }).from(orders).where(eq(orders.userId, principal.userId));',
              '  },',
              '});',
            ].join('\n'),
          },
        ],
      }),
    );

    expect(
      audit.scopeAudits.map((a) => ({ detail: a.detail, domain: a.domain, scope: a.scope })),
    ).toEqual([
      {
        detail:
          'narrow Authorization-gates-DATA subset: owner=userId; no owner-column session/principal predicate was proven',
        domain: 'order',
        scope: 'unknown',
      },
    ]);
  });

  it('keeps a mismatched const object-property guard alias scope:unknown', () => {
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
              'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
              '',
              'export const orders = pgTable("orders", { id: text("id").primaryKey(), userId: text("user_id").notNull() }, kovo({ domain: "order", key: (t) => t.id, owner: (t) => t.userId }));',
              '',
              'export const ordersForActor = query("ordersForActor", {',
              '  output: s.object({ id: s.string() }),',
              '  async load(_input: unknown, db: PgAsyncDatabase<any, any>, ctx: { guard: { actorId: string } }) {',
              '    const principal = { userId: ctx.guard.actorId };',
              '    return db.select({ id: orders.id }).from(orders).where(eq(orders.userId, principal.userId));',
              '  },',
              '});',
            ].join('\n'),
          },
        ],
      }),
    );

    expect(
      audit.scopeAudits.map((a) => ({ detail: a.detail, domain: a.domain, scope: a.scope })),
    ).toEqual([
      {
        detail:
          'narrow Authorization-gates-DATA subset: owner=userId; no owner-column session/principal predicate was proven',
        domain: 'order',
        scope: 'unknown',
      },
    ]);
  });

  it('keeps a mismatched nested destructured guard principal scope:unknown', () => {
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
              'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
              '',
              'export const orders = pgTable("orders", { id: text("id").primaryKey(), userId: text("user_id").notNull() }, kovo({ domain: "order", key: (t) => t.id, owner: (t) => t.userId }));',
              '',
              'export const ordersForActor = query("ordersForActor", {',
              '  output: s.object({ id: s.string() }),',
              '  async load(_input: unknown, db: PgAsyncDatabase<any, any>, ctx: { guard: { actorId: string } }) {',
              '    const { guard: { actorId } } = ctx;',
              '    return db.select({ id: orders.id }).from(orders).where(eq(orders.userId, actorId));',
              '  },',
              '});',
            ].join('\n'),
          },
        ],
      }),
    );

    expect(
      audit.scopeAudits.map((a) => ({ detail: a.detail, domain: a.domain, scope: a.scope })),
    ).toEqual([
      {
        detail:
          'narrow Authorization-gates-DATA subset: owner=userId; no owner-column session/principal predicate was proven',
        domain: 'order',
        scope: 'unknown',
      },
    ]);
  });

  it('keeps an unsummarized guard helper visible as an unknown owner read', () => {
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
              'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
              '',
              'export const orders = pgTable("orders", { id: text("id").primaryKey(), userId: text("user_id").notNull() }, kovo({ domain: "order", key: (t) => t.id, owner: (t) => t.userId }));',
              '',
              'function currentGuardUser(ctx: { guard: { userId: string } }) { return ctx.guard.userId; }',
              '',
              'export const ordersForGuard = query("ordersForGuard", {',
              '  output: s.object({ id: s.string() }),',
              '  async load(_input: unknown, db: PgAsyncDatabase<any, any>, ctx: { guard: { userId: string } }) {',
              '    const guardUserId = currentGuardUser(ctx);',
              '    return db.select({ id: orders.id }).from(orders).where(eq(orders.userId, guardUserId));',
              '  },',
              '});',
            ].join('\n'),
          },
        ],
      }),
    );

    expect(audit.scopeAudits.map((a) => ({ domain: a.domain, scope: a.scope }))).toEqual([
      { domain: 'order', scope: 'unknown' },
    ]);
  });

  it('keeps a local alias to an unsummarized property-call guard helper scope:unknown', () => {
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
              'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
              '',
              'export const orders = pgTable("orders", { id: text("id").primaryKey(), userId: text("user_id").notNull() }, kovo({ domain: "order", key: (t) => t.id, owner: (t) => t.userId }));',
              '',
              'const guardFns = {',
              '  currentGuardUser(ctx: { guard: { userId: string } }) { return ctx.guard.userId; },',
              '};',
              'const guardUser = guardFns.currentGuardUser;',
              '',
              'export const ordersForGuard = query("ordersForGuard", {',
              '  output: s.object({ id: s.string() }),',
              '  async load(_input: unknown, db: PgAsyncDatabase<any, any>, ctx: { guard: { userId: string } }) {',
              '    return db.select({ id: orders.id }).from(orders).where(eq(orders.userId, guardUser(ctx)));',
              '  },',
              '});',
            ].join('\n'),
          },
        ],
      }),
    );

    expect(audit.scopeAudits.map((a) => ({ domain: a.domain, scope: a.scope }))).toEqual([
      { domain: 'order', scope: 'unknown' },
    ]);
  });

  it('keeps a summarized property-call guard principal with a mismatched symbol scope:unknown', () => {
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
              'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
              'import { kovoAnalyzerSummary } from "@kovojs/drizzle";',
              '',
              'export const orders = pgTable("orders", { id: text("id").primaryKey(), userId: text("user_id").notNull() }, kovo({ domain: "order", key: (t) => t.id, owner: (t) => t.userId }));',
              '',
              'const guardFns = {',
              '  currentActor(ctx: { guard: { actorId: string } }) { return ctx.guard.actorId; },',
              '};',
              'kovoAnalyzerSummary(guardFns.currentActor, { returns: { kind: "guard", path: "actorId" } });',
              '',
              'export const ordersForActor = query("ordersForActor", {',
              '  output: s.object({ id: s.string() }),',
              '  async load(_input: unknown, db: PgAsyncDatabase<any, any>, ctx: { guard: { actorId: string } }) {',
              '    return db.select({ id: orders.id }).from(orders).where(eq(orders.userId, guardFns.currentActor(ctx)));',
              '  },',
              '});',
            ].join('\n'),
          },
        ],
      }),
    );

    expect(
      audit.scopeAudits.map((a) => ({ detail: a.detail, domain: a.domain, scope: a.scope })),
    ).toEqual([
      {
        detail:
          'narrow Authorization-gates-DATA subset: owner=userId; no owner-column session/principal predicate was proven',
        domain: 'order',
        scope: 'unknown',
      },
    ]);
  });

  it('keeps an unsummarized property-call guard helper visible as an unknown owner read', () => {
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
              'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
              '',
              'export const orders = pgTable("orders", { id: text("id").primaryKey(), userId: text("user_id").notNull() }, kovo({ domain: "order", key: (t) => t.id, owner: (t) => t.userId }));',
              '',
              'const guardFns = {',
              '  currentGuardUser(ctx: { guard: { userId: string } }) { return ctx.guard.userId; },',
              '};',
              '',
              'export const ordersForGuard = query("ordersForGuard", {',
              '  output: s.object({ id: s.string() }),',
              '  async load(_input: unknown, db: PgAsyncDatabase<any, any>, ctx: { guard: { userId: string } }) {',
              '    return db.select({ id: orders.id }).from(orders).where(eq(orders.userId, guardFns.currentGuardUser(ctx)));',
              '  },',
              '});',
            ].join('\n'),
          },
        ],
      }),
    );

    expect(audit.scopeAudits.map((a) => ({ domain: a.domain, scope: a.scope }))).toEqual([
      { domain: 'order', scope: 'unknown' },
    ]);
  });

  it('OPP-28: treats range read predicates as args without proving session scope', () => {
    const audit = extractOwnerAuditFromProject(
      withPgDatabaseTypes({
        files: [
          pgDatabaseTypes([
            'select(value?: unknown): { from(table: unknown): { where(value: unknown): Promise<unknown[]> } };',
          ]),
          {
            fileName: 'order.queries.ts',
            source: [
              'import { between, gt, gte, lt, lte, not } from "drizzle-orm";',
              'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
              '',
              'export const orders = pgTable("orders", { id: text("id").primaryKey(), userId: text("user_id").notNull() }, kovo({ domain: "order", key: (t) => t.id, owner: (t) => t.userId }));',
              '',
              'export const ordersGtInput = query("ordersGtInput", {',
              '  output: s.object({ id: s.string() }),',
              '  async load(input: { userId: string }, db: PgAsyncDatabase<any, any>) {',
              '    return db.select({ id: orders.id }).from(orders).where(gt(orders.userId, input.userId));',
              '  },',
              '});',
              '',
              'export const ordersNotGtInput = query("ordersNotGtInput", {',
              '  output: s.object({ id: s.string() }),',
              '  async load(input: { userId: string }, db: PgAsyncDatabase<any, any>) {',
              '    return db.select({ id: orders.id }).from(orders).where(not(gt(orders.userId, input.userId)));',
              '  },',
              '});',
              '',
              'export const ordersGteMine = query("ordersGteMine", {',
              '  output: s.object({ id: s.string() }),',
              '  async load(_input: unknown, db: PgAsyncDatabase<any, any>, req: { session: { userId: string } }) {',
              '    return db.select({ id: orders.id }).from(orders).where(gte(orders.userId, req.session.userId));',
              '  },',
              '});',
              '',
              'export const ordersNotGteMine = query("ordersNotGteMine", {',
              '  output: s.object({ id: s.string() }),',
              '  async load(_input: unknown, db: PgAsyncDatabase<any, any>, req: { session: { userId: string } }) {',
              '    return db.select({ id: orders.id }).from(orders).where(not(gte(orders.userId, req.session.userId)));',
              '  },',
              '});',
              '',
              'export const ordersLtInput = query("ordersLtInput", {',
              '  output: s.object({ id: s.string() }),',
              '  async load(input: { userId: string }, db: PgAsyncDatabase<any, any>) {',
              '    return db.select({ id: orders.id }).from(orders).where(lt(orders.userId, input.userId));',
              '  },',
              '});',
              '',
              'export const ordersLteMine = query("ordersLteMine", {',
              '  output: s.object({ id: s.string() }),',
              '  async load(_input: unknown, db: PgAsyncDatabase<any, any>, req: { session: { userId: string } }) {',
              '    return db.select({ id: orders.id }).from(orders).where(lte(orders.userId, req.session.userId));',
              '  },',
              '});',
              '',
              'export const ordersBetweenInput = query("ordersBetweenInput", {',
              '  output: s.object({ id: s.string() }),',
              '  async load(input: { lowerUserId: string; upperUserId: string }, db: PgAsyncDatabase<any, any>) {',
              '    return db.select({ id: orders.id }).from(orders).where(between(orders.userId, input.lowerUserId, input.upperUserId));',
              '  },',
              '});',
              '',
              'export const ordersNotBetweenInput = query("ordersNotBetweenInput", {',
              '  output: s.object({ id: s.string() }),',
              '  async load(input: { lowerUserId: string; upperUserId: string }, db: PgAsyncDatabase<any, any>) {',
              '    return db.select({ id: orders.id }).from(orders).where(not(between(orders.userId, input.lowerUserId, input.upperUserId)));',
              '  },',
              '});',
              '',
              'export const ordersBetweenMine = query("ordersBetweenMine", {',
              '  output: s.object({ id: s.string() }),',
              '  async load(_input: unknown, db: PgAsyncDatabase<any, any>, req: { session: { userId: string; otherUserId: string } }) {',
              '    return db.select({ id: orders.id }).from(orders).where(between(orders.userId, req.session.userId, req.session.otherUserId));',
              '  },',
              '});',
              '',
              'export const ordersNotBetweenMine = query("ordersNotBetweenMine", {',
              '  output: s.object({ id: s.string() }),',
              '  async load(_input: unknown, db: PgAsyncDatabase<any, any>, req: { session: { userId: string; otherUserId: string } }) {',
              '    return db.select({ id: orders.id }).from(orders).where(not(between(orders.userId, req.session.userId, req.session.otherUserId)));',
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
      { name: 'ordersBetweenInput', scope: 'args' },
      { name: 'ordersBetweenInput', scope: 'args' },
      { name: 'ordersBetweenMine', scope: 'unknown' },
      { name: 'ordersGteMine', scope: 'unknown' },
      { name: 'ordersGtInput', scope: 'args' },
      { name: 'ordersLteMine', scope: 'unknown' },
      { name: 'ordersLtInput', scope: 'args' },
      { name: 'ordersNotBetweenInput', scope: 'args' },
      { name: 'ordersNotBetweenInput', scope: 'args' },
      { name: 'ordersNotBetweenMine', scope: 'unknown' },
      { name: 'ordersNotGteMine', scope: 'unknown' },
      { name: 'ordersNotGtInput', scope: 'args' },
    ]);
    expect(audit.scopeAudits.find((a) => a.name === 'ordersGteMine')?.detail).toContain(
      'no owner-column session/principal predicate was proven',
    );
    expect(audit.scopeAudits.find((a) => a.name === 'ordersNotGteMine')?.detail).toContain(
      'no owner-column session/principal predicate was proven',
    );
  });

  it('flags a session predicate on a non-owner column as an unproven DATA authorization subset', () => {
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
              'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
              '',
              'export const orders = pgTable("orders", { id: text("id").primaryKey(), userId: text("user_id").notNull() }, kovo({ domain: "order", key: (t) => t.id, owner: (t) => t.userId }));',
              '',
              'export const orderBySessionId = query("orderBySessionId", {',
              '  output: s.object({ id: s.string() }),',
              '  async load(_input: unknown, db: PgAsyncDatabase<any, any>, req: { session: { userId: string } }) {',
              '    return db.select({ id: orders.id }).from(orders).where(eq(orders.id, req.session.userId));',
              '  },',
              '});',
            ].join('\n'),
          },
        ],
      }),
    );

    expect(audit.scopeAudits.map((a) => ({ domain: a.domain, scope: a.scope }))).toEqual([
      { domain: 'order', scope: 'unknown' },
    ]);
    expect(audit.scopeAudits[0]?.detail).toContain(
      'session predicate does not compare the owner column',
    );
  });

  // OPP-28 narrow DATA subset: even without a client arg, a directly reachable owner
  // read must now carry an honest finding unless the owner column is proven scoped to
  // the matching session/principal symbol. The scope is `unknown`, not the arg-keyed
  // join-bypass `args` classification.
  it('flags an owner read keyed only by a literal local as unproven for the narrow DATA subset', () => {
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
              'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
              '',
              'export const orders = pgTable("orders", { id: text("id").primaryKey(), userId: text("user_id").notNull() }, kovo({ domain: "order", key: (t) => t.id, owner: (t) => t.userId }));',
              '',
              'export const orderMine = query("orderMine", {',
              '  output: s.object({ id: s.string() }),',
              '  async load(_input: unknown, db: PgAsyncDatabase<any, any>) {',
              '    const mineId = "u1";',
              '    return db.select({ id: orders.id }).from(orders).where(eq(orders.userId, mineId));',
              '  },',
              '});',
            ].join('\n'),
          },
        ],
      }),
    );

    expect(audit.scopeAudits.map((a) => ({ domain: a.domain, scope: a.scope }))).toEqual([
      { domain: 'order', scope: 'unknown' },
    ]);
    expect(audit.scopeAudits[0]?.detail).toContain(
      'no owner-column session/principal predicate was proven',
    );
  });
});
