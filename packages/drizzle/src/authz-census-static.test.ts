import { describe, expect, it } from 'vitest';
import { Node } from 'ts-morph';

import {
  DRIZZLE_SELECT_QUERY_METHODS,
  extractStaticBuildAnalysisFactsFromProject,
} from '@kovojs/drizzle/internal/static';
import { DRIZZLE_TABLE_FACTORY_NAMES } from './drizzle-surface.js';
import { pgDatabaseTypes } from './test-helpers.js';

const DB_TYPES = pgDatabaseTypes([
  'insert(table: unknown): { values(value: unknown): Promise<void> };',
  'select(value?: unknown): { from(table: unknown): Promise<unknown[]> };',
]);

function censusDiagnostics(source: string) {
  return extractStaticBuildAnalysisFactsFromProject({
    files: [
      DB_TYPES,
      {
        fileName: 'src/authz-census.ts',
        source,
      },
    ],
  }).sqlSafetyDiagnostics.filter((diagnostic) => diagnostic.code === 'KV414');
}

describe('@kovojs/drizzle authorization census static gate (DEC-K/C7)', () => {
  it('keeps schema tables in the census when a plugin tries to mutate table-factory policy', () => {
    const mutableNames = DRIZZLE_TABLE_FACTORY_NAMES as Set<string>;
    let removed = false;
    let diagnostics: ReturnType<typeof censusDiagnostics> | undefined;

    try {
      try {
        removed = Set.prototype.delete.call(mutableNames, 'pgTable');
      } catch {
        // The hardened classifier is a frozen closure-backed ReadonlySet facade, not a Set target.
      }
      diagnostics = censusDiagnostics(
        [
          'import { query } from "@kovojs/server";',
          'import { kovo } from "@kovojs/drizzle";',
          'import { pgTable, text } from "drizzle-orm/pg-core";',
          'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
          '',
          'export const payroll = pgTable("payroll", { id: text("id").primaryKey() }, kovo({ domain: "payroll", key: "id" }));',
          '',
          'export const payrollQuery = query("payroll", {',
          '  load(_input: unknown, db: PgAsyncDatabase<any, any>) {',
          '    return db.select({ id: payroll.id }).from(payroll);',
          '  },',
          '});',
        ].join('\n'),
      );
    } finally {
      if (removed) Set.prototype.add.call(mutableNames, 'pgTable');
    }

    expect(diagnostics).toEqual([
      expect.objectContaining({
        message: expect.stringContaining('Authorization census table payroll is request-reachable'),
      }),
    ]);
    expect(removed).toBe(false);
  });

  it('keeps write-reachable tables in the census after late Object.values poisoning', () => {
    const originalValues = Object.values;
    let diagnostics: ReturnType<typeof censusDiagnostics> | undefined;

    try {
      Object.values = (() => []) as typeof Object.values;
      const facts = extractStaticBuildAnalysisFactsFromProject({
        files: [
          DB_TYPES,
          {
            fileName: 'src/authz-census.ts',
            source: [
              'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
              'import { kovo } from "@kovojs/drizzle";',
              'import { pgTable, text } from "drizzle-orm/pg-core";',
              '',
              'export const auditLogs = pgTable("audit_logs", { id: text("id").primaryKey() }, kovo({ domain: "auditLog", key: "id" }));',
              '',
              'export async function appendAudit(db: PgAsyncDatabase<any, any>) {',
              '  await db.insert(auditLogs).values({ id: "a1" });',
              '}',
            ].join('\n'),
          },
        ],
      });
      diagnostics = facts.sqlSafetyDiagnostics as ReturnType<typeof censusDiagnostics>;
    } finally {
      Object.values = originalValues;
    }

    expect(diagnostics?.filter((diagnostic) => diagnostic.code === 'KV414')).toEqual([
      expect.objectContaining({
        message: expect.stringContaining(
          'Authorization census table audit_logs is request-reachable',
        ),
      }),
    ]);
  });

  it('keeps write-reachable tables in the census after late ts-morph classifier poisoning', () => {
    const originalIsCallExpression = Node.isCallExpression;
    let diagnostics: ReturnType<typeof censusDiagnostics> | undefined;
    let replaced = false;

    try {
      replaced = Reflect.set(
        Node,
        'isCallExpression',
        (() => false) as typeof Node.isCallExpression,
      );
      const facts = extractStaticBuildAnalysisFactsFromProject({
        files: [
          DB_TYPES,
          {
            fileName: 'src/authz-census.ts',
            source: [
              'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
              'import { kovo } from "@kovojs/drizzle";',
              'import { pgTable, text } from "drizzle-orm/pg-core";',
              '',
              'export const auditLogs = pgTable("audit_logs", { id: text("id").primaryKey() }, kovo({ domain: "auditLog", key: "id" }));',
              '',
              'export async function appendAudit(db: PgAsyncDatabase<any, any>) {',
              '  await db.insert(auditLogs).values({ id: "a1" });',
              '}',
            ].join('\n'),
          },
        ],
      });
      diagnostics = facts.sqlSafetyDiagnostics as ReturnType<typeof censusDiagnostics>;
    } finally {
      if (replaced) Reflect.set(Node, 'isCallExpression', originalIsCallExpression);
    }

    expect(replaced).toBe(false);
    expect(diagnostics?.filter((diagnostic) => diagnostic.code === 'KV414')).toEqual([
      expect.objectContaining({
        message: expect.stringContaining(
          'Authorization census table audit_logs is request-reachable',
        ),
      }),
    ]);
  });

  it('keeps query-reachable tables in the census when a plugin tries to mutate classifier sets', () => {
    const mutableMethods = DRIZZLE_SELECT_QUERY_METHODS as Set<string>;
    let removed = false;
    let diagnostics: ReturnType<typeof censusDiagnostics> | undefined;

    try {
      try {
        removed = Set.prototype.delete.call(mutableMethods, 'select');
      } catch {
        // The hardened classifier is a frozen closure-backed ReadonlySet facade, not a Set target.
      }
      diagnostics = censusDiagnostics(
        [
          'import { query } from "@kovojs/server";',
          'import { kovo } from "@kovojs/drizzle";',
          'import { pgTable, text } from "drizzle-orm/pg-core";',
          'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
          '',
          'export const drafts = pgTable("drafts", { id: text("id").primaryKey() }, kovo({ domain: "draft", key: "id" }));',
          '',
          'export const draftQuery = query("draft", {',
          '  load(_input: unknown, db: PgAsyncDatabase<any, any>) {',
          '    return db.select({ id: drafts.id }).from(drafts);',
          '  },',
          '});',
        ].join('\n'),
      );
    } finally {
      if (removed) Set.prototype.add.call(mutableMethods, 'select');
    }

    expect(removed).toBe(false);
    expect(diagnostics).toEqual([
      expect.objectContaining({
        message: expect.stringContaining('Authorization census table drafts is request-reachable'),
      }),
    ]);
  });

  it('fails the build aggregate for a request-reachable unclassified schema table', () => {
    const diagnostics = censusDiagnostics(
      [
        'import { query } from "@kovojs/server";',
        'import { kovo } from "@kovojs/drizzle";',
        'import { pgTable, text } from "drizzle-orm/pg-core";',
        'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
        '',
        'export const drafts = pgTable("drafts", { id: text("id").primaryKey() }, kovo({ domain: "draft", key: "id" }));',
        '',
        'export const draftQuery = query("draft", {',
        '  load(_input: unknown, db: PgAsyncDatabase<any, any>) {',
        '    return db.select({ id: drafts.id }).from(drafts);',
        '  },',
        '});',
      ].join('\n'),
    );

    expect(diagnostics).toEqual([
      expect.objectContaining({
        code: 'KV414',
        message: expect.stringContaining(
          'Authorization census table drafts is request-reachable but has no authorization classification',
        ),
        site: 'src/authz-census.ts:8',
      }),
    ]);
  });

  it('requires exactly one DEC-K classification for each request-reachable table', () => {
    const diagnostics = censusDiagnostics(
      [
        'import { query } from "@kovojs/server";',
        'import { kovo } from "@kovojs/drizzle";',
        'import { pgTable, text } from "drizzle-orm/pg-core";',
        'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
        '',
        'export const users = pgTable("users", { id: text("id").primaryKey() }, kovo({ domain: "user", key: "id", reference: true }));',
        'export const teams = pgTable("teams", { id: text("id").primaryKey() }, kovo({ domain: "team", key: "id", public: true, reference: true }));',
        '',
        'export const teamQuery = query("team", {',
        '  load(_input: unknown, db: PgAsyncDatabase<any, any>) {',
        '    return db.select({ id: teams.id }).from(teams);',
        '  },',
        '});',
      ].join('\n'),
    );

    expect(diagnostics).toEqual([
      expect.objectContaining({
        message: expect.stringContaining(
          'Authorization census table teams has multiple authorization classifications (public, reference)',
        ),
        site: 'src/authz-census.ts:9',
      }),
    ]);
  });

  it('accepts owned, ownedVia, authzPolicy, public, and reference classifications', () => {
    const diagnostics = censusDiagnostics(
      [
        'import { sql } from "drizzle-orm";',
        'import { query } from "@kovojs/server";',
        'import { kovo } from "@kovojs/drizzle";',
        'import { pgTable, text } from "drizzle-orm/pg-core";',
        'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
        '',
        'export const users = pgTable("users", { id: text("id").primaryKey() }, kovo({ domain: "user", key: "id", reference: true }));',
        'export const orders = pgTable("orders", { id: text("id").primaryKey(), userId: text("user_id").notNull() }, kovo({ domain: "order", key: "id", owner: "userId" }));',
        'export const orderItems = pgTable("order_items", { id: text("id").primaryKey(), orderId: text("order_id").notNull() }, kovo({ domain: "orderItem", key: "id", ownerVia: { parent: orders, fk: "orderId", parentKey: "id" } }));',
        'export const shares = pgTable("shares", { id: text("id").primaryKey() }, kovo({ domain: "share", key: "id", authzPolicy: sql`owner_id = current_setting(\\\'kovo.principal\\\', true)` }));',
        'export const posts = pgTable("posts", { id: text("id").primaryKey() }, kovo({ domain: "post", key: "id", public: true }));',
        '',
        'export const allTables = query("allTables", {',
        '  load(_input: unknown, db: PgAsyncDatabase<any, any>) {',
        '    return Promise.all([',
        '      db.select({ id: orders.id }).from(orders),',
        '      db.select({ id: orderItems.id }).from(orderItems),',
        '      db.select({ id: shares.id }).from(shares),',
        '      db.select({ id: posts.id }).from(posts),',
        '      db.select({ id: users.id }).from(users),',
        '    ]);',
        '  },',
        '});',
      ].join('\n'),
    );

    expect(diagnostics).toEqual([]);
  });

  it('flags a request-reachable FK child table when ownerVia is missing', () => {
    const diagnostics = censusDiagnostics(
      [
        'import { query } from "@kovojs/server";',
        'import { kovo } from "@kovojs/drizzle";',
        'import { pgTable, text } from "drizzle-orm/pg-core";',
        'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
        '',
        'export const orders = pgTable("orders", { id: text("id").primaryKey(), userId: text("user_id").notNull() }, kovo({ domain: "order", key: "id", owner: "userId" }));',
        'export const orderItems = pgTable("order_items", { id: text("id").primaryKey(), orderId: text("order_id").notNull().references(() => orders.id) }, kovo({ domain: "orderItem", key: "id" }));',
        '',
        'export const childQuery = query("child", {',
        '  load(_input: unknown, db: PgAsyncDatabase<any, any>) {',
        '    return db.select({ id: orderItems.id }).from(orderItems);',
        '  },',
        '});',
      ].join('\n'),
    );

    expect(diagnostics).toEqual([
      expect.objectContaining({
        message: expect.stringContaining(
          'Authorization census table order_items is request-reachable but has no authorization classification',
        ),
        site: 'src/authz-census.ts:9',
      }),
    ]);
  });

  it('includes mutation/write graph tables in the request-reachable denominator', () => {
    const diagnostics = censusDiagnostics(
      [
        'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
        'import { kovo } from "@kovojs/drizzle";',
        'import { pgTable, text } from "drizzle-orm/pg-core";',
        '',
        'export const auditLogs = pgTable("audit_logs", { id: text("id").primaryKey() }, kovo({ domain: "auditLog", key: "id" }));',
        '',
        'export async function appendAudit(db: PgAsyncDatabase<any, any>) {',
        '  await db.insert(auditLogs).values({ id: "a1" });',
        '}',
      ].join('\n'),
    );

    expect(diagnostics).toEqual([
      expect.objectContaining({
        message: expect.stringContaining(
          'Authorization census table audit_logs is request-reachable',
        ),
        site: 'src/authz-census.ts:8',
      }),
    ]);
  });
});
