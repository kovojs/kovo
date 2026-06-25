import { describe, expect, it } from 'vitest';
import { Node, Project, SyntaxKind } from 'ts-morph';

import {
  extractMassAssignmentFromProject,
  serverSummaryKeysForSourceFile,
  symbolProvenanceContextForNodes,
  symbolProvenanceForExpression,
} from '@kovojs/drizzle/internal/static';
import { pgDatabaseTypes } from './test-helpers.js';

// SPEC §10.3/§11.1 — the §11.1 mass-assignment write-provenance gate (KV438).
// Governed columns: the table `key` (PK) + `owner` (auto-governed) + `kovo({ governed })`.

const dbTypes = pgDatabaseTypes([
  'insert(table: unknown): { values(value: unknown): { onConflictDoUpdate(c: unknown): Promise<void> } & Promise<void> };',
  'update(table: unknown): { set(value: unknown): { where(value: unknown): Promise<void> } };',
]);

function facts(domainSource: string) {
  return extractMassAssignmentFromProject({
    files: [
      dbTypes,
      {
        fileName: 'schema.ts',
        source: [
          'export const accounts = pgTable("accounts", {',
          '  id: text("id").primaryKey(),',
          '  ownerId: text("owner_id").notNull(),',
          '  role: text("role").notNull(),',
          '  balance: integer("balance").notNull(),',
          '  name: text("name").notNull(),',
          '}, kovo({ domain: "account", key: "id", owner: "ownerId", governed: ["role", "balance"] }));',
        ].join('\n'),
      },
      { fileName: 'account.domain.ts', source: domainSource },
    ],
  });
}

function passwordFacts(domainSource: string) {
  return extractMassAssignmentFromProject({
    files: [
      dbTypes,
      {
        fileName: 'schema.ts',
        source: [
          'export const users = pgTable("users", {',
          '  id: text("id").primaryKey(),',
          '  email: text("email").notNull(),',
          '  passwordHash: text("password_hash").notNull(),',
          '}, kovo({ domain: "user" }));',
        ].join('\n'),
      },
      { fileName: 'user.domain.ts', source: domainSource },
    ],
  });
}

const HEADER = [
  'import { eq } from "drizzle-orm";',
  'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
  'import { serverValue, adminAssign } from "@kovojs/server";',
  'import { kovoAnalyzerSummary } from "@kovojs/drizzle";',
  'import { accounts } from "./schema";',
  '',
].join('\n');

function handler(
  body: string,
  signature = 'db: PgAsyncDatabase<any, any>, input: { id: string; ownerId: string; role: string; balance: number; name: string }, request: { session: { userId: string } }',
): string {
  return `${HEADER}export const updateAccount = async (${signature}) => {\n${body}\n};\n`;
}

describe('@kovojs/drizzle mass-assignment gate (KV438)', () => {
  it('rejects request input reaching a governed column (role)', () => {
    const result = facts(
      handler(
        '  await db.update(accounts).set({ role: input.role }).where(eq(accounts.id, input.id));',
      ),
    );
    expect(result).toEqual([
      {
        column: 'role',
        detail: 'role',
        domain: 'account',
        name: 'updateAccount',
        provenance: 'input',
        site: 'account.domain.ts:7',
        via: 'set',
      },
    ]);
  });

  it('rejects input reaching the auto-governed owner column on insert', () => {
    const result = facts(
      handler(
        '  await db.insert(accounts).values({ id: input.id, ownerId: input.ownerId, role: "user", balance: 0, name: input.name });',
      ),
    );
    expect(result.map((fact) => fact.column).sort()).toEqual(['id', 'ownerId']);
    // `name` (non-governed) and `role`/`balance` (literals) are NOT flagged.
    expect(result.every((fact) => fact.provenance === 'input')).toBe(true);
  });

  it('rejects an aliased + destructured input value on a governed column', () => {
    const result = facts(
      handler(
        [
          '  const r = input.role;',
          '  const { balance } = input;',
          '  await db.update(accounts).set({ role: r, balance }).where(eq(accounts.id, input.id));',
        ].join('\n'),
      ),
    );
    expect(result.map((fact) => fact.column).sort()).toEqual(['balance', 'role']);
  });

  it('passes a literal governed value', () => {
    expect(
      facts(
        handler(
          '  await db.update(accounts).set({ role: "admin" }).where(eq(accounts.id, input.id));',
        ),
      ),
    ).toEqual([]);
  });

  it('passes a session-derived (server) governed value', () => {
    expect(
      facts(
        handler(
          '  await db.update(accounts).set({ ownerId: request.session.userId }).where(eq(accounts.id, input.id));',
        ),
      ),
    ).toEqual([]);
  });

  it('passes serverValue(non-input) but rejects serverValue(input.x)', () => {
    expect(
      facts(
        handler(
          '  await db.update(accounts).set({ role: serverValue("admin", "seed") }).where(eq(accounts.id, input.id));',
        ),
      ),
    ).toEqual([]);
    const rejected = facts(
      handler(
        '  await db.update(accounts).set({ role: serverValue(input.role, "seed") }).where(eq(accounts.id, input.id));',
      ),
    );
    expect(rejected).toEqual([
      {
        column: 'role',
        detail: 'role',
        domain: 'account',
        name: 'updateAccount',
        provenance: 'input',
        site: 'account.domain.ts:7',
        via: 'set',
      },
    ]);
  });

  it('passes adminAssign(input.x) as the audited privileged write', () => {
    expect(
      facts(
        handler(
          '  await db.update(accounts).set({ role: adminAssign(input.role, "promotion") }).where(eq(accounts.id, input.id));',
        ),
      ),
    ).toEqual([]);
  });

  it('rejects a local fake adminAssign helper with the privileged name', () => {
    const result = facts(
      [
        'import { eq } from "drizzle-orm";',
        'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
        'import { accounts } from "./schema";',
        'function adminAssign<T>(value: T, reason: string): T { return value; }',
        'export const updateAccount = async (db: PgAsyncDatabase<any, any>, input: { id: string; role: string }) => {',
        '  await db.update(accounts).set({ role: adminAssign(input.role, "promotion") }).where(eq(accounts.id, input.id));',
        '};',
      ].join('\n'),
    );
    expect(result).toMatchObject([
      { column: 'role', domain: 'account', provenance: 'unknown', via: 'set' },
    ]);
  });

  it('passes a kovoAnalyzerSummary("server") helper-computed governed value', () => {
    const result = facts(
      [
        HEADER,
        'function resolveOwner(input: { ownerId: string }) { return input.ownerId; }',
        'kovoAnalyzerSummary(resolveOwner, { returns: { kind: "server" } });',
        '',
        'export const updateAccount = async (db: PgAsyncDatabase<any, any>, input: { id: string; ownerId: string }) => {',
        '  await db.update(accounts).set({ ownerId: resolveOwner(input) }).where(eq(accounts.id, input.id));',
        '};',
      ].join('\n'),
    );
    expect(result).toEqual([]);
  });

  it('rejects a local fake kovoAnalyzerSummary declaration', () => {
    const result = facts(
      [
        'import { eq } from "drizzle-orm";',
        'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
        'import { accounts } from "./schema";',
        'function kovoAnalyzerSummary(..._args: unknown[]) {}',
        'function resolveOwner(input: { ownerId: string }) { return input.ownerId; }',
        'kovoAnalyzerSummary(resolveOwner, { returns: { kind: "server" } });',
        'export const updateAccount = async (db: PgAsyncDatabase<any, any>, input: { id: string; ownerId: string }) => {',
        '  await db.update(accounts).set({ ownerId: resolveOwner(input) }).where(eq(accounts.id, input.id));',
        '};',
      ].join('\n'),
    );
    expect(result).toMatchObject([
      { column: 'ownerId', domain: 'account', provenance: 'unknown', via: 'set' },
    ]);
  });

  it('fails closed: an unsummarized helper-computed governed value is unknown-rejected', () => {
    const result = facts(
      [
        HEADER,
        'function computeRole(input: { role: string }) { return input.role; }',
        '',
        'export const updateAccount = async (db: PgAsyncDatabase<any, any>, input: { id: string; role: string }) => {',
        '  await db.update(accounts).set({ role: computeRole(input) }).where(eq(accounts.id, input.id));',
        '};',
      ].join('\n'),
    );
    expect(result.map((fact) => ({ column: fact.column, provenance: fact.provenance }))).toEqual([
      { column: 'role', provenance: 'unknown' },
    ]);
  });

  it('rejects a .values(input) spread on a governed table (fail-closed cliff)', () => {
    const result = facts(handler('  await db.insert(accounts).values(input);'));
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ domain: 'account', provenance: 'input', via: 'values' });
    expect(result[0]?.column).toBe('balance+id+ownerId+role');
  });

  it('rejects a { ...input } spread inside the payload object', () => {
    const result = facts(
      handler('  await db.insert(accounts).values({ ...input, role: "user" });'),
    );
    expect(result.some((fact) => fact.via === 'spread' && fact.provenance === 'input')).toBe(true);
  });

  it('emits nothing for a table with no governed columns', () => {
    const result = extractMassAssignmentFromProject({
      files: [
        dbTypes,
        {
          fileName: 'schema.ts',
          source:
            'export const logs = pgTable("logs", { msg: text("msg") }, kovo({ domain: "log" }));',
        },
        {
          fileName: 'log.domain.ts',
          source: [
            'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
            'import { logs } from "./schema";',
            'export const write = async (db: PgAsyncDatabase<any, any>, input: { msg: string }) => {',
            '  await db.insert(logs).values({ msg: input.msg });',
            '};',
          ].join('\n'),
        },
      ],
    });
    expect(result).toEqual([]);
  });

  it('auto-governs password columns and accepts only the blessed hashPassword sink', () => {
    const result = passwordFacts(
      [
        'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
        'import { hashPassword } from "@kovojs/server";',
        'import { users } from "./schema";',
        'export const createUser = async (db: PgAsyncDatabase<any, any>, input: { id: string; email: string; password: string }) => {',
        '  await db.insert(users).values({ id: input.id, email: input.email, passwordHash: await hashPassword(input.password) });',
        '};',
      ].join('\n'),
    );
    expect(result).toEqual([]);
  });

  it('accepts password digest variables assigned from the blessed hashPassword sink', () => {
    const result = passwordFacts(
      [
        'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
        'import { hashPassword } from "@kovojs/server";',
        'import { users } from "./schema";',
        'export const createUser = async (db: PgAsyncDatabase<any, any>, input: { id: string; email: string; password: string }) => {',
        '  const passwordHash = await hashPassword(input.password);',
        '  await db.insert(users).values({ id: input.id, email: input.email, passwordHash });',
        '};',
      ].join('\n'),
    );
    expect(result).toEqual([]);
  });

  it('rejects request plaintext written directly to an auto-governed password column', () => {
    const result = passwordFacts(
      [
        'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
        'import { users } from "./schema";',
        'export const createUser = async (db: PgAsyncDatabase<any, any>, input: { id: string; email: string; password: string }) => {',
        '  await db.insert(users).values({ id: input.id, email: input.email, passwordHash: input.password });',
        '};',
      ].join('\n'),
    );
    expect(result).toEqual([
      {
        column: 'passwordHash',
        detail: 'password',
        domain: 'user',
        name: 'createUser',
        provenance: 'input',
        site: 'user.domain.ts:4',
        via: 'values',
      },
    ]);
  });

  it('rejects literals and fake hashPassword helpers for password columns', () => {
    const literal = passwordFacts(
      [
        'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
        'import { users } from "./schema";',
        'export const createUser = async (db: PgAsyncDatabase<any, any>, input: { id: string; email: string }) => {',
        '  await db.insert(users).values({ id: input.id, email: input.email, passwordHash: "$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$ZGlnZXN0" });',
        '};',
      ].join('\n'),
    );
    expect(literal).toMatchObject([
      { column: 'passwordHash', domain: 'user', provenance: 'unknown', via: 'values' },
    ]);

    const fake = passwordFacts(
      [
        'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
        'import { users } from "./schema";',
        'function hashPassword(value: string) { return value; }',
        'export const createUser = async (db: PgAsyncDatabase<any, any>, input: { id: string; email: string; password: string }) => {',
        '  await db.insert(users).values({ id: input.id, email: input.email, passwordHash: hashPassword(input.password) });',
        '};',
      ].join('\n'),
    );
    expect(fake).toMatchObject([
      { column: 'passwordHash', domain: 'user', provenance: 'unknown', via: 'values' },
    ]);
  });

  it('accepts namespace imports for the blessed password sink', () => {
    const result = passwordFacts(
      [
        'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
        'import * as kovoServer from "@kovojs/server";',
        'import { users } from "./schema";',
        'export const createUser = async (db: PgAsyncDatabase<any, any>, input: { id: string; email: string; password: string }) => {',
        '  await db.insert(users).values({ id: input.id, email: input.email, passwordHash: await kovoServer.hashPassword(input.password) });',
        '};',
      ].join('\n'),
    );
    expect(result).toEqual([]);
  });

  it('fails closed for full-row password writes even from server-summary helpers', () => {
    const result = passwordFacts(
      [
        'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
        'import { kovoAnalyzerSummary } from "@kovojs/drizzle";',
        'import { users } from "./schema";',
        'function buildUser(input: { id: string; email: string; password: string }) {',
        '  return { id: input.id, email: input.email, passwordHash: input.password };',
        '}',
        'kovoAnalyzerSummary(buildUser, { returns: { kind: "server" } });',
        'export const createUser = async (db: PgAsyncDatabase<any, any>, input: { id: string; email: string; password: string }) => {',
        '  await db.insert(users).values(buildUser(input));',
        '};',
      ].join('\n'),
    );
    expect(result).toMatchObject([
      { column: 'passwordHash', domain: 'user', provenance: 'unknown', via: 'values' },
    ]);
  });
});

// Conformance: the new `server` analyzer-summary CallExpression branch must be
// confined to opted-in contexts and never relax the fail-closed default that backs
// KV435/IDOR confidentiality. A plain (unsummarized) call still resolves to `unknown`.
describe('symbol-provenance server-summary branch (KV435/IDOR conformance)', () => {
  function source(text: string) {
    const project = new Project({
      compilerOptions: { module: 99, moduleResolution: 2, target: 99 },
      useInMemoryFileSystem: true,
    });
    return project.createSourceFile('fixture.ts', text);
  }

  it('resolves a server-summary helper to server but leaves a plain helper unknown', () => {
    const file = source(
      [
        'import { kovoAnalyzerSummary } from "@kovojs/drizzle";',
        'function resolveOwner(input: { ownerId: string }) { return input.ownerId; }',
        'function plain(input: { ownerId: string }) { return input.ownerId; }',
        'kovoAnalyzerSummary(resolveOwner, { returns: { kind: "server" } });',
        'export function handler(input: { ownerId: string }) {',
        '  const a = resolveOwner(input);',
        '  const b = plain(input);',
        '  return { a, b };',
        '}',
      ].join('\n'),
    );
    const body = file.getFunctionOrThrow('handler').getBodyOrThrow();
    const inputRoot = file.getFunctionOrThrow('handler').getParameters()[0]!.getNameNode();
    const context = symbolProvenanceContextForNodes([body], {
      inputRoots: [inputRoot],
      serverSummaryKeys: serverSummaryKeysForSourceFile(file),
    });
    const shorthand = (name: string) =>
      file
        .getDescendantsOfKind(SyntaxKind.ShorthandPropertyAssignment)
        .find((node) => node.getName() === name)!
        .getNameNode();
    expect(symbolProvenanceForExpression(shorthand('a'), context)).toEqual({
      kind: 'server',
      path: '',
    });
    expect(symbolProvenanceForExpression(shorthand('b'), context)).toEqual({ kind: 'unknown' });
  });

  it('without serverSummaryKeys (the KV435/IDOR consumer config) a call stays unknown', () => {
    const file = source(
      [
        'import { kovoAnalyzerSummary } from "@kovojs/drizzle";',
        'function resolveOwner(input: { ownerId: string }) { return input.ownerId; }',
        'kovoAnalyzerSummary(resolveOwner, { returns: { kind: "server" } });',
        'export function handler(input: { ownerId: string }) {',
        '  const a = resolveOwner(input);',
        '  return { a };',
        '}',
      ].join('\n'),
    );
    const body = file.getFunctionOrThrow('handler').getBodyOrThrow();
    const inputRoot = file.getFunctionOrThrow('handler').getParameters()[0]!.getNameNode();
    // Confidentiality consumers do NOT pass serverSummaryKeys → the branch is inert.
    const context = symbolProvenanceContextForNodes([body], { inputRoots: [inputRoot] });
    const node = file
      .getDescendantsOfKind(SyntaxKind.ShorthandPropertyAssignment)
      .find((n) => n.getName() === 'a')!
      .getNameNode();
    expect(symbolProvenanceForExpression(node, context)).toEqual({ kind: 'unknown' });
  });
});
