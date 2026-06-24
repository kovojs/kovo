import { describe, expect, it } from 'vitest';
import { Node, Project, SyntaxKind } from 'ts-morph';

import {
  UNRESOLVED_READ_SOURCE_EXPRESSION,
  atomicityDiagnosticsFromProject,
  extractSymbolicEffectsFromProject,
  governedWriteCapabilityFactsFromProject,
  governedWriteDiagnosticsFromProject,
  joinSymbolProvenance,
  provenInputProvenanceForExpression,
  provenServerProvenanceForExpression,
  symbolProvenanceContextForNodes,
  symbolProvenanceForExpression,
  tableAnnotation,
} from '@kovojs/drizzle/internal/static';
import { pgDatabaseTypes } from './test-helpers.js';

describe('@kovojs/drizzle symbol provenance', () => {
  it('extracts kovo({ version }) column refs for the KV429 lifecycle', () => {
    const sourceFile = source(`
      export const products = pgTable("products", {
        id: text("id").primaryKey(),
        stock: integer("stock").notNull(),
        version: integer("version").notNull(),
      }, kovo({ domain: "product", key: "id", version: (t) => t.version }));
    `);
    const initializer = sourceFile
      .getVariableDeclarationOrThrow('products')
      .getInitializerOrThrow();

    expect(tableAnnotation(initializer)).toMatchObject({
      domain: 'product',
      key: 'id',
      name: 'products',
      version: 'version',
    });
  });

  it('tracks input aliases, destructuring, server aliases, and fail-closed joins', () => {
    const sourceFile = source(`
      export function handler(input: { id: string; ownerId: string }, request: { session: { userId: string } }) {
        const id = input.id;
        const { ownerId } = input;
        const sessionUserId = request.session.userId;
        const literal = "public";
        const mixed = true ? ownerId : sessionUserId;
        const computed = decorate(ownerId);
        const payload = { id, literal };
        return { id, ownerId, sessionUserId, literal, mixed, computed, payload };
      }
    `);
    const body = functionBody(sourceFile, 'handler');
    const input = parameter(sourceFile, 'handler', 'input');
    const request = parameter(sourceFile, 'handler', 'request');
    const context = symbolProvenanceContextForNodes([body], {
      inputRoots: [input.getNameNode()],
      serverRoots: [request.getNameNode()],
    });

    expect(provenance(sourceFile, context, 'id')).toEqual({ kind: 'input', path: 'id' });
    expect(provenance(sourceFile, context, 'ownerId')).toEqual({
      kind: 'input',
      path: 'ownerId',
    });
    expect(provenance(sourceFile, context, 'sessionUserId')).toEqual({
      kind: 'server',
      path: 'session.userId',
    });
    expect(provenance(sourceFile, context, 'literal')).toEqual({ kind: 'literal' });
    expect(provenance(sourceFile, context, 'mixed')).toEqual({ kind: 'input' });
    expect(provenance(sourceFile, context, 'computed')).toEqual({ kind: 'unknown' });
    expect(provenance(sourceFile, context, 'payload')).toEqual({ kind: 'input' });
    expect(provenInputProvenanceForExpression(returned(sourceFile, 'ownerId'), context)).toEqual({
      kind: 'input',
      path: 'ownerId',
    });
    expect(
      provenInputProvenanceForExpression(returned(sourceFile, 'sessionUserId'), context),
    ).toBeUndefined();
    expect(
      provenInputProvenanceForExpression(returned(sourceFile, 'computed'), context),
    ).toBeUndefined();
    expect(
      provenServerProvenanceForExpression(returned(sourceFile, 'sessionUserId'), context),
    ).toEqual({
      kind: 'server',
      path: 'session.userId',
    });
    expect(
      provenServerProvenanceForExpression(returned(sourceFile, 'id'), context),
    ).toBeUndefined();
    expect(
      provenServerProvenanceForExpression(returned(sourceFile, 'computed'), context),
    ).toBeUndefined();
    expect(
      provenServerProvenanceForExpression(returned(sourceFile, 'mixed'), context),
    ).toBeUndefined();
  });

  it('joins unknown as fail-closed and otherwise prefers input over server over literal', () => {
    expect(
      joinSymbolProvenance(
        { kind: 'literal' },
        { kind: 'server', path: 'session.userId' },
        { kind: 'input', path: 'ownerId' },
      ),
    ).toEqual({ kind: 'input' });
    expect(joinSymbolProvenance({ kind: 'server' }, { kind: 'literal' })).toEqual({
      kind: 'server',
    });
    expect(joinSymbolProvenance({ kind: 'input', path: 'id' }, { kind: 'unknown' })).toEqual({
      kind: 'unknown',
    });
  });

  it('feeds symbolic write effects through aliased and destructured input provenance', () => {
    const effects = extractSymbolicEffectsFromProject({
      files: [
        pgDatabaseTypes([
          'insert(table: unknown): { values(value: unknown): Promise<void> };',
          'update(table: unknown): { set(value: unknown): { where(value: unknown): Promise<void> } };',
        ]),
        {
          fileName: 'account.domain.ts',
          source: [
            'import { eq } from "drizzle-orm";',
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const accounts = pgTable("accounts", {}, kovo({ domain: "account", key: "id" }));',
            'const accountTable = accounts;',
            '',
            'export async function saveAccount(db: PgDatabase, input: { id: string; ownerId: string }) {',
            '  const id = input.id;',
            '  const { ownerId } = input;',
            '  const ambiguous = true ? id : ownerId;',
            '  await db.insert(accountTable).values({ id, ownerId });',
            '  await db.update(accountTable).set({ ownerId }).where(eq(accountTable.id, id));',
            '  await db.insert(accountTable).values({ id: ambiguous });',
            '}',
          ].join('\n'),
        },
      ],
    }).map((fact) => fact.effect);

    expect(effects).toEqual([
      {
        op: 'insert',
        table: 'accounts',
        values: {
          id: { kind: 'param', path: 'id' },
          ownerId: { kind: 'param', path: 'ownerId' },
        },
      },
      {
        match: { eq: [{ column: 'id', value: { kind: 'param', path: 'id' } }], kind: 'keys' },
        op: 'update',
        sets: { ownerId: { kind: 'param', path: 'ownerId' } },
        table: 'accounts',
      },
      {
        op: 'insert',
        table: 'accounts',
        values: { id: { expr: 'ambiguous', kind: 'opaque' } },
      },
    ]);
  });

  it('keeps renamed imports, Drizzle aliases, and intermediate table bindings symbol-based', () => {
    const effects = extractSymbolicEffectsFromProject({
      files: [
        pgDatabaseTypes([
          'insert(table: unknown): { values(value: unknown): Promise<void> };',
          'update(table: unknown): { set(value: unknown): { where(value: unknown): Promise<void> } };',
        ]),
        {
          fileName: 'drizzle-pg-core-extra.d.ts',
          source: [
            'declare module "drizzle-orm/pg-core" {',
            '  export function alias(table: unknown, name: string): unknown;',
            '  export function pgTable(name: string, columns: unknown, extra?: unknown): unknown;',
            '  export function text(name: string): { primaryKey(): unknown; notNull(): unknown };',
            '}',
          ].join('\n'),
        },
        {
          fileName: 'packages/drizzle/src/schema.ts',
          source: [
            'import { pgTable, text } from "drizzle-orm/pg-core";',
            '',
            'export const users = pgTable("users", {',
            '  id: text("id").primaryKey(),',
            '  ownerId: text("owner_id").notNull(),',
            '}, kovo({ domain: "user", key: "id" }));',
          ].join('\n'),
        },
        {
          fileName: 'packages/drizzle/src/account.domain.ts',
          source: [
            'import { eq } from "drizzle-orm";',
            'import { alias, type PgDatabase } from "drizzle-orm/pg-core";',
            'import { users as accounts } from "./schema";',
            '',
            'const accountAlias = alias(accounts, "a");',
            'const accountTable = accountAlias;',
            '',
            'export async function saveAccount(db: PgDatabase, input: { id: string; ownerId: string }) {',
            '  const id = input.id;',
            '  const { ownerId } = input;',
            '  await db.update(accountTable).set({ ownerId }).where(eq(accountTable.id, id));',
            '}',
          ].join('\n'),
        },
      ],
    }).map((fact) => fact.effect);

    expect(effects).toEqual([
      {
        match: { eq: [{ column: 'id', value: { kind: 'param', path: 'id' } }], kind: 'keys' },
        op: 'update',
        sets: { ownerId: { kind: 'param', path: 'ownerId' } },
        table: 'users',
      },
    ]);
  });

  it('keeps conditional table bindings exact enough for symbolic write effects', () => {
    const effects = extractSymbolicEffectsFromProject({
      files: [
        pgDatabaseTypes([
          'update(table: unknown): { set(value: unknown): { where(value: unknown): Promise<void> } };',
        ]),
        {
          fileName: 'account.domain.ts',
          source: [
            'import { eq } from "drizzle-orm";',
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const accounts = pgTable("accounts", {}, kovo({ domain: "account", key: "id" }));',
            'export const users = pgTable("users", {}, kovo({ domain: "user", key: "id" }));',
            'const accountTable = useAccounts ? accounts : users;',
            '',
            'export async function saveAccount(db: PgDatabase, input: { id: string; ownerId: string }) {',
            '  const id = input.id;',
            '  const { ownerId } = input;',
            '  await db.update(accountTable).set({ ownerId }).where(eq(accountTable.id, id));',
            '}',
          ].join('\n'),
        },
      ],
    }).map((fact) => fact.effect);

    expect(effects).toEqual([
      {
        match: { expr: 'eq(accountTable.id, id)', kind: 'opaque' },
        op: 'update',
        sets: { ownerId: { kind: 'param', path: 'ownerId' } },
        table: UNRESOLVED_READ_SOURCE_EXPRESSION,
      },
    ]);
  });

  it('fails closed when helper-returned input values reach symbolic write effects', () => {
    const effects = extractSymbolicEffectsFromProject({
      files: [
        pgDatabaseTypes(['update(table: unknown): { set(value: unknown): Promise<void> };']),
        {
          fileName: 'account.domain.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const accounts = pgTable("accounts", {}, kovo({ domain: "account", key: "id" }));',
            '',
            'function ownerFromInput(input: { ownerId: string }) {',
            '  return input.ownerId;',
            '}',
            '',
            'export async function saveAccount(db: PgDatabase, input: { ownerId: string }) {',
            '  await db.update(accounts).set({ ownerId: ownerFromInput(input) });',
            '}',
          ].join('\n'),
        },
      ],
    }).map((fact) => fact.effect);

    expect(effects).toEqual([
      {
        match: { eq: [], kind: 'keys' },
        op: 'update',
        sets: { ownerId: { expr: 'unsummarized-helper:ownerFromInput', kind: 'opaque' } },
        table: 'accounts',
      },
    ]);
  });

  it('resolves namespace static table members for symbolic write effects', () => {
    const effects = extractSymbolicEffectsFromProject({
      files: [
        pgDatabaseTypes([
          'update(table: unknown): { set(value: unknown): { where(value: unknown): Promise<void> } };',
        ]),
        {
          fileName: 'account.schema.ts',
          source: [
            'export const users = pgTable("users", {',
            '  id: text("id").primaryKey(),',
            '  ownerId: text("owner_id").notNull(),',
            '}, kovo({ domain: "user", key: "id" }));',
          ].join('\n'),
        },
        {
          fileName: 'account.domain.ts',
          source: [
            'import { eq } from "drizzle-orm";',
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            'import * as schema from "./account.schema";',
            '',
            'const accountTable = schema["users"];',
            '',
            'export async function saveAccount(db: PgDatabase, input: { id: string; ownerId: string }) {',
            '  const id = input.id;',
            '  const { ownerId } = input;',
            '  await db.update(accountTable).set({ ownerId }).where(eq(accountTable.id, id));',
            '}',
          ].join('\n'),
        },
      ],
    }).map((fact) => fact.effect);

    expect(effects).toEqual([
      {
        match: { eq: [{ column: 'id', value: { kind: 'param', path: 'id' } }], kind: 'keys' },
        op: 'update',
        sets: { ownerId: { kind: 'param', path: 'ownerId' } },
        table: 'users',
      },
    ]);
  });

  it('reports governed write diagnostics for primary keys, owner columns, and destructured input', () => {
    const diagnostics = governedWriteDiagnosticsFromProject({
      files: [
        pgDatabaseTypes(['insert(table: unknown): { values(value: unknown): Promise<void> };']),
        {
          fileName: 'account.domain.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const accounts = pgTable("accounts", {',
            '  id: text("id").primaryKey(),',
            '  ownerId: text("owner_id").notNull(),',
            '  name: text("name").notNull(),',
            '}, kovo({ domain: "account", key: "id", owner: (t) => t.ownerId }));',
            '',
            'export async function saveAccount(db: PgDatabase, input: { id: string; ownerId: string; name: string }) {',
            '  const id = input.id;',
            '  const { ownerId, name } = input;',
            '  await db.insert(accounts).values({ id, ownerId, name });',
            '}',
          ].join('\n'),
        },
      ],
    });

    expect(diagnostics.map(({ code, message }) => ({ code, message }))).toEqual([
      {
        code: 'KV437',
        message:
          'Client input reaches a governed column write. Write to accounts.id receives input.id; derive the value on the server or use audited adminAssign(...).',
      },
      {
        code: 'KV437',
        message:
          'Client input reaches a governed column write. Write to accounts.ownerId receives input.ownerId; derive the value on the server or use audited adminAssign(...).',
      },
    ]);
  });

  it('fails closed for whole input, spread, and helper-returned governed writes', () => {
    const diagnostics = governedWriteDiagnosticsFromProject({
      files: [
        pgDatabaseTypes([
          'insert(table: unknown): { values(value: unknown): Promise<void> };',
          'update(table: unknown): { set(value: unknown): Promise<void> };',
        ]),
        {
          fileName: 'account.domain.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const accounts = pgTable("accounts", {',
            '  id: text("id").primaryKey(),',
            '  ownerId: text("owner_id").notNull(),',
            '  name: text("name").notNull(),',
            '}, kovo({ domain: "account", key: "id", owner: "ownerId" }));',
            '',
            'function ownerFromInput(input: { ownerId: string }) {',
            '  return input.ownerId;',
            '}',
            '',
            'export async function saveAccount(db: PgDatabase, input: { id: string; ownerId: string; name: string }) {',
            '  await db.insert(accounts).values(input);',
            '  await db.insert(accounts).values({ ...input, name: input.name });',
            '  await db.update(accounts).set({ ownerId: ownerFromInput(input) });',
            '}',
          ].join('\n'),
        },
      ],
    });

    expect(diagnostics.map(({ code, message }) => ({ code, message }))).toEqual([
      {
        code: 'KV437',
        message:
          'Client input reaches a governed column write. Write to accounts.id, ownerId receives input; derive the value on the server or use audited adminAssign(...).',
      },
      {
        code: 'KV437',
        message:
          'Client input reaches a governed column write. Write to accounts.id, ownerId receives spread ...input; derive the value on the server or use audited adminAssign(...).',
      },
      {
        code: 'KV437',
        message:
          'Client input reaches a governed column write. Write to accounts.ownerId receives unsummarized-helper:ownerFromInput; derive the value on the server or use audited adminAssign(...).',
      },
    ]);
  });

  it('honors explicit governed annotations without blocking non-governed input writes', () => {
    const diagnostics = governedWriteDiagnosticsFromProject({
      files: [
        pgDatabaseTypes(['update(table: unknown): { set(value: unknown): Promise<void> };']),
        {
          fileName: 'account.domain.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const accounts = pgTable("accounts", {',
            '  id: text("id").notNull(),',
            '  role: text("role").notNull(),',
            '  name: text("name").notNull(),',
            '}, kovo({ domain: "account", key: "id", governed: ["role"] }));',
            '',
            'export async function saveAccount(db: PgDatabase, input: { role: string; name: string }) {',
            '  await db.update(accounts).set({ role: input.role, name: input.name });',
            '}',
          ].join('\n'),
        },
      ],
    });

    expect(diagnostics.map(({ code, message }) => ({ code, message }))).toEqual([
      {
        code: 'KV437',
        message:
          'Client input reaches a governed column write. Write to accounts.role receives input.role; derive the value on the server or use audited adminAssign(...).',
      },
    ]);
  });

  it('keeps serverValue non-input only and lets analyzer summaries prove server helpers', () => {
    const diagnostics = governedWriteDiagnosticsFromProject({
      files: [
        pgDatabaseTypes(['update(table: unknown): { set(value: unknown): Promise<void> };']),
        {
          fileName: 'account.domain.ts',
          source: [
            'import { serverValue, kovoAnalyzerSummary } from "@kovojs/drizzle";',
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const accounts = pgTable("accounts", {',
            '  id: text("id").primaryKey(),',
            '  ownerId: text("owner_id").notNull(),',
            '}, kovo({ domain: "account", key: "id", owner: "ownerId" }));',
            '',
            'function resolveOwner() { return "server-user"; }',
            'kovoAnalyzerSummary(resolveOwner, { returns: { kind: "session", path: "userId" } });',
            '',
            'export async function saveAccount(db: PgDatabase, input: { ownerId: string }) {',
            '  await db.update(accounts).set({ ownerId: serverValue("server-user", "session owner") });',
            '  await db.update(accounts).set({ ownerId: resolveOwner() });',
            '  await db.update(accounts).set({ ownerId: serverValue(input.ownerId, "not server") });',
            '}',
          ].join('\n'),
        },
      ],
    });

    expect(diagnostics.map(({ code, message }) => ({ code, message }))).toEqual([
      {
        code: 'KV437',
        message:
          'Client input reaches a governed column write. Write to accounts.ownerId receives input.ownerId; derive the value on the server or use audited adminAssign(...).',
      },
    ]);
  });

  it('allows audited adminAssign for governed input writes and emits capability facts', () => {
    const files = [
      pgDatabaseTypes(['update(table: unknown): { set(value: unknown): Promise<void> };']),
      {
        fileName: 'account.domain.ts',
        source: [
          'import { adminAssign } from "@kovojs/drizzle";',
          'import type { PgDatabase } from "drizzle-orm/pg-core";',
          '',
          'export const accounts = pgTable("accounts", {',
          '  id: text("id").primaryKey(),',
          '  role: text("role").notNull(),',
          '}, kovo({ domain: "account", key: "id", governed: ["role"] }));',
          '',
          'export async function saveAccount(db: PgDatabase, input: { role: string }) {',
          '  await db.update(accounts).set({ role: adminAssign(input.role, "support role correction") });',
          '}',
        ].join('\n'),
      },
    ];

    expect(governedWriteDiagnosticsFromProject({ files })).toEqual([]);
    expect(governedWriteCapabilityFactsFromProject({ files })).toEqual([
      {
        column: 'role',
        kind: 'adminAssign',
        reason: 'support role correction',
        site: 'account.domain.ts:10',
        source: 'input.role',
        table: 'accounts',
      },
    ]);
  });

  it('fails closed for adminAssign without a static non-empty reason', () => {
    const diagnostics = governedWriteDiagnosticsFromProject({
      files: [
        pgDatabaseTypes(['update(table: unknown): { set(value: unknown): Promise<void> };']),
        {
          fileName: 'account.domain.ts',
          source: [
            'import { adminAssign } from "@kovojs/drizzle";',
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const accounts = pgTable("accounts", {',
            '  id: text("id").primaryKey(),',
            '  role: text("role").notNull(),',
            '}, kovo({ domain: "account", key: "id", governed: ["role"] }));',
            '',
            'export async function saveAccount(db: PgDatabase, input: { role: string }, reason: string) {',
            '  await db.update(accounts).set({ role: adminAssign(input.role, "   ") });',
            '  await db.update(accounts).set({ role: adminAssign(input.role, reason) });',
            '}',
          ].join('\n'),
        },
      ],
    });

    expect(diagnostics.map(({ code, message }) => ({ code, message }))).toEqual([
      {
        code: 'KV437',
        message:
          'Client input reaches a governed column write. Write to accounts.role receives input.role; derive the value on the server or use audited adminAssign(...).',
      },
      {
        code: 'KV437',
        message:
          'Client input reaches a governed column write. Write to accounts.role receives input.role; derive the value on the server or use audited adminAssign(...).',
      },
    ]);
  });

  it('reports KV429 for read-then-write on a versioned row without a guard', () => {
    const diagnostics = atomicityDiagnosticsFromProject({
      files: [
        pgDatabaseTypes([
          'select(value?: unknown): { from(table: unknown): { where(value: unknown): Promise<unknown[]> } };',
          'update(table: unknown): { set(value: unknown): { where(value: unknown): Promise<void> } };',
        ]),
        {
          fileName: 'inventory.domain.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const products = pgTable("products", {',
            '  id: text("id").primaryKey(),',
            '  stock: integer("stock").notNull(),',
            '  version: integer("version").notNull(),',
            '}, kovo({ domain: "product", key: "id", version: "version" }));',
            '',
            'export async function reserve(db: PgDatabase, input: { id: string; quantity: number }) {',
            '  const [product] = await db.select({ stock: products.stock }).from(products).where(eq(products.id, input.id));',
            '  if (product.stock < input.quantity) return;',
            '  await db.update(products).set({ stock: product.stock - input.quantity }).where(eq(products.id, input.id));',
            '}',
          ].join('\n'),
        },
      ],
    });

    expect(diagnostics.map(({ code, message, site }) => ({ code, message, site }))).toEqual([
      {
        code: 'KV429',
        message:
          'Read-then-write on an atomic value lacks an atomicity guard. Read-before-write updates products.stock without compare-and-set on stock or version guard version.',
        site: 'inventory.domain.ts:12',
      },
    ]);
  });

  it('reports KV429 when a version-guarded update lacks typed conflict wiring', () => {
    const diagnostics = atomicityDiagnosticsFromProject({
      files: [
        pgDatabaseTypes([
          'select(value?: unknown): { from(table: unknown): { where(value: unknown): Promise<unknown[]> } };',
          'update(table: unknown): { set(value: unknown): { where(value: unknown): Promise<{ rowCount: number }> } };',
        ]),
        {
          fileName: 'inventory.domain.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const products = pgTable("products", {',
            '  id: text("id").primaryKey(),',
            '  stock: integer("stock").notNull(),',
            '  version: integer("version").notNull(),',
            '}, kovo({ domain: "product", key: "id", atomic: [(t) => t.stock], version: (t) => t.version }));',
            '',
            'export async function reserve(db: PgDatabase, input: { id: string; quantity: number; version: number }) {',
            '  const [product] = await db.select({ stock: products.stock, version: products.version }).from(products).where(eq(products.id, input.id));',
            '  if (product.stock < input.quantity) return;',
            '  await db.update(products).set({ stock: product.stock - input.quantity, version: product.version + 1 }).where(and(eq(products.id, input.id), eq(products.version, input.version)));',
            '}',
          ].join('\n'),
        },
      ],
    });

    expect(diagnostics.map(({ code, message, site }) => ({ code, message, site }))).toEqual([
      {
        code: 'KV429',
        message:
          'Read-then-write on an atomic value lacks an atomicity guard. Read-before-write updates products.stock, version without compare-and-set on stock, version or version guard version. Guarded zero-row outcomes must return or throw a typed 409 conflict.',
        site: 'inventory.domain.ts:12',
      },
    ]);
  });

  it('accepts compareAndSet-wrapped guarded updates for a declared atomic column', () => {
    const diagnostics = atomicityDiagnosticsFromProject({
      files: [
        pgDatabaseTypes([
          'select(value?: unknown): { from(table: unknown): { where(value: unknown): Promise<unknown[]> } };',
          'update(table: unknown): { set(value: unknown): { where(value: unknown): Promise<void> } };',
        ]),
        {
          fileName: 'inventory.domain.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const products = pgTable("products", {',
            '  id: text("id").primaryKey(),',
            '  stock: integer("stock").notNull(),',
            '  version: integer("version").notNull(),',
            '}, kovo({ domain: "product", key: "id", atomic: [(t) => t.stock], version: (t) => t.version }));',
            '',
            'export async function reserve(db: PgDatabase, input: { id: string; quantity: number; version: number }) {',
            '  const [product] = await db.select({ stock: products.stock, version: products.version }).from(products).where(eq(products.id, input.id));',
            '  if (product.stock < input.quantity) return;',
            '  await compareAndSet(db.update(products).set({ stock: product.stock - input.quantity, version: product.version + 1 }).where(and(eq(products.id, input.id), eq(products.version, input.version))));',
            '}',
          ].join('\n'),
        },
      ],
    });

    expect(diagnostics).toEqual([]);
  });

  it('accepts guarded row-count checks that return typed TOCTOU conflicts', () => {
    const diagnostics = atomicityDiagnosticsFromProject({
      files: [
        pgDatabaseTypes([
          'select(value?: unknown): { from(table: unknown): { where(value: unknown): Promise<unknown[]> } };',
          'update(table: unknown): { set(value: unknown): { where(value: unknown): Promise<{ rowCount: number }> } };',
        ]),
        {
          fileName: 'inventory.domain.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const products = pgTable("products", {',
            '  id: text("id").primaryKey(),',
            '  stock: integer("stock").notNull(),',
            '  version: integer("version").notNull(),',
            '}, kovo({ domain: "product", key: "id", atomic: ["stock"], version: "version" }));',
            '',
            'export async function reserve(db: PgDatabase, input: { id: string; quantity: number; version: number }) {',
            '  const [product] = await db.select({ stock: products.stock, version: products.version }).from(products).where(eq(products.id, input.id));',
            '  if (product.stock < input.quantity) return;',
            '  const result = await db.update(products).set({ stock: product.stock - input.quantity, version: product.version + 1 }).where(and(eq(products.id, input.id), eq(products.version, input.version)));',
            '  if (result.rowCount === 0) throw kovoConflict({ code: "STALE_PRODUCT", payload: { id: input.id } });',
            '}',
          ].join('\n'),
        },
      ],
    });

    expect(diagnostics).toEqual([]);
  });

  it('reports KV429 when a caller reads and a local helper performs the unguarded write', () => {
    const diagnostics = atomicityDiagnosticsFromProject({
      files: [
        pgDatabaseTypes([
          'select(value?: unknown): { from(table: unknown): { where(value: unknown): Promise<unknown[]> } };',
          'update(table: unknown): { set(value: unknown): { where(value: unknown): Promise<void> } };',
        ]),
        {
          fileName: 'inventory.domain.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const products = pgTable("products", {',
            '  id: text("id").primaryKey(),',
            '  stock: integer("stock").notNull(),',
            '  version: integer("version").notNull(),',
            '}, kovo({ domain: "product", key: "id", atomic: ["stock"], version: "version" }));',
            '',
            'async function writeReservation(db: PgDatabase, input: { id: string; stock: number }) {',
            '  await db.update(products).set({ stock: input.stock }).where(eq(products.id, input.id));',
            '}',
            '',
            'export async function reserve(db: PgDatabase, input: { id: string; quantity: number }) {',
            '  const [product] = await db.select({ stock: products.stock }).from(products).where(eq(products.id, input.id));',
            '  if (product.stock < input.quantity) return;',
            '  await writeReservation(db, { id: input.id, stock: product.stock - input.quantity });',
            '}',
          ].join('\n'),
        },
      ],
    });

    expect(diagnostics.map(({ code, message, site }) => ({ code, message, site }))).toEqual([
      {
        code: 'KV429',
        message:
          'Read-then-write on an atomic value lacks an atomicity guard. Read-before-write updates products.stock without compare-and-set on stock or version guard version.',
        site: 'inventory.domain.ts:10',
      },
    ]);
  });

  it('reports KV429 when a local helper reads and the caller performs the unguarded write', () => {
    const diagnostics = atomicityDiagnosticsFromProject({
      files: [
        pgDatabaseTypes([
          'select(value?: unknown): { from(table: unknown): { where(value: unknown): Promise<unknown[]> } };',
          'update(table: unknown): { set(value: unknown): { where(value: unknown): Promise<void> } };',
        ]),
        {
          fileName: 'inventory.domain.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const products = pgTable("products", {',
            '  id: text("id").primaryKey(),',
            '  stock: integer("stock").notNull(),',
            '  version: integer("version").notNull(),',
            '}, kovo({ domain: "product", key: "id", atomic: ["stock"], version: "version" }));',
            '',
            'async function readProduct(db: PgDatabase, id: string) {',
            '  const [product] = await db.select({ stock: products.stock }).from(products).where(eq(products.id, id));',
            '  return product;',
            '}',
            '',
            'export async function reserve(db: PgDatabase, input: { id: string; quantity: number }) {',
            '  const product = await readProduct(db, input.id);',
            '  if (product.stock < input.quantity) return;',
            '  await db.update(products).set({ stock: product.stock - input.quantity }).where(eq(products.id, input.id));',
            '}',
          ].join('\n'),
        },
      ],
    });

    expect(diagnostics.map(({ code, message, site }) => ({ code, message, site }))).toEqual([
      {
        code: 'KV429',
        message:
          'Read-then-write on an atomic value lacks an atomicity guard. Read-before-write updates products.stock without compare-and-set on stock or version guard version.',
        site: 'inventory.domain.ts:17',
      },
    ]);
  });

  it('accepts imported same-project helper summaries for guarded KV429 writes', () => {
    const diagnostics = atomicityDiagnosticsFromProject({
      files: [
        pgDatabaseTypes([
          'select(value?: unknown): { from(table: unknown): { where(value: unknown): Promise<unknown[]> } };',
        ]),
        {
          fileName: 'inventory.helpers.ts',
          source: [
            'import { kovoAnalyzerSummary } from "@kovojs/drizzle";',
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'export async function writeReservation(db: PgDatabase, input: { id: string; stock: number; version: number }) {',
            '  void db;',
            '  void input;',
            '}',
            '',
            'kovoAnalyzerSummary(writeReservation, {',
            '  atomicity: { writes: [{ table: "products", columns: ["stock", "version"], guard: "version", zeroRowConflict: "compareAndSet" }] },',
            '});',
          ].join('\n'),
        },
        {
          fileName: 'inventory.domain.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            'import { writeReservation as writeStock } from "./inventory.helpers";',
            '',
            'export const products = pgTable("products", {',
            '  id: text("id").primaryKey(),',
            '  stock: integer("stock").notNull(),',
            '  version: integer("version").notNull(),',
            '}, kovo({ domain: "product", key: "id", atomic: ["stock"], version: "version" }));',
            '',
            'export async function reserve(db: PgDatabase, input: { id: string; quantity: number; version: number }) {',
            '  const [product] = await db.select({ stock: products.stock }).from(products).where(eq(products.id, input.id));',
            '  if (product.stock < input.quantity) return;',
            '  await writeStock(db, { id: input.id, stock: product.stock - input.quantity, version: input.version });',
            '}',
          ].join('\n'),
        },
      ],
    });

    expect(diagnostics).toEqual([]);
  });

  it('accepts node_modules helper summaries for guarded KV429 writes', () => {
    const diagnostics = atomicityDiagnosticsFromProject({
      files: [
        pgDatabaseTypes([
          'select(value?: unknown): { from(table: unknown): { where(value: unknown): Promise<unknown[]> } };',
        ]),
        {
          fileName: 'inventory.domain.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            'import { kovoAnalyzerSummary } from "@kovojs/drizzle";',
            'import { writeReservation } from "inventory-helpers";',
            '',
            'kovoAnalyzerSummary(writeReservation, {',
            '  atomicity: { writes: [{ table: "products", columns: ["stock"], guard: "version", zeroRowConflict: "kovoConflict" }] },',
            '});',
            '',
            'export const products = pgTable("products", {',
            '  id: text("id").primaryKey(),',
            '  stock: integer("stock").notNull(),',
            '  version: integer("version").notNull(),',
            '}, kovo({ domain: "product", key: "id", atomic: ["stock"], version: "version" }));',
            '',
            'export async function reserve(db: PgDatabase, input: { id: string; quantity: number; version: number }) {',
            '  const [product] = await db.select({ stock: products.stock }).from(products).where(eq(products.id, input.id));',
            '  if (product.stock < input.quantity) return;',
            '  await writeReservation(db, { id: input.id, stock: product.stock - input.quantity, version: input.version });',
            '}',
          ].join('\n'),
        },
      ],
    });

    expect(diagnostics).toEqual([]);
  });

  it('reports KV429 for helper writes with no atomicity summary', () => {
    const diagnostics = atomicityDiagnosticsFromProject({
      files: [
        pgDatabaseTypes([
          'select(value?: unknown): { from(table: unknown): { where(value: unknown): Promise<unknown[]> } };',
        ]),
        {
          fileName: 'inventory.domain.ts',
          source: [
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            'import { writeReservation } from "inventory-helpers";',
            '',
            'export const products = pgTable("products", {',
            '  id: text("id").primaryKey(),',
            '  stock: integer("stock").notNull(),',
            '  version: integer("version").notNull(),',
            '}, kovo({ domain: "product", key: "id", atomic: ["stock"], version: "version" }));',
            '',
            'export async function reserve(db: PgDatabase, input: { id: string; quantity: number }) {',
            '  const [product] = await db.select({ stock: products.stock }).from(products).where(eq(products.id, input.id));',
            '  if (product.stock < input.quantity) return;',
            '  await writeReservation(db, { id: input.id, stock: product.stock - input.quantity });',
            '}',
          ].join('\n'),
        },
      ],
    });

    expect(diagnostics.map(({ code, site }) => ({ code, site }))).toEqual([
      { code: 'KV429', site: 'inventory.domain.ts:13' },
    ]);
  });
});

function source(sourceText: string) {
  const project = new Project({
    compilerOptions: { module: 99, moduleResolution: 2, target: 99 },
    useInMemoryFileSystem: true,
  });
  return project.createSourceFile('fixture.ts', sourceText);
}

function functionBody(sourceFile: ReturnType<typeof source>, name: string): Node {
  const declaration = sourceFile.getFunctionOrThrow(name);
  return declaration.getBodyOrThrow();
}

function parameter(sourceFile: ReturnType<typeof source>, fnName: string, paramName: string) {
  return sourceFile
    .getFunctionOrThrow(fnName)
    .getParameters()
    .find((param) => param.getName() === paramName)!;
}

function provenance(
  sourceFile: ReturnType<typeof source>,
  context: Parameters<typeof symbolProvenanceForExpression>[1],
  identifier: string,
) {
  return symbolProvenanceForExpression(returned(sourceFile, identifier), context);
}

function returned(sourceFile: ReturnType<typeof source>, identifier: string) {
  const shorthand = sourceFile
    .getDescendantsOfKind(SyntaxKind.ShorthandPropertyAssignment)
    .find((node) => node.getName() === identifier);
  if (!shorthand) throw new Error(`missing returned shorthand ${identifier}`);
  const expression = shorthand.getNameNode();
  expect(Node.isIdentifier(expression)).toBe(true);
  return expression;
}
