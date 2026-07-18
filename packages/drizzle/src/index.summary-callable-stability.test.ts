import { describe, expect, it } from 'vitest';

import { kovoCheck } from '../../cli/src/graph-output.js';
import { extractOwnerAuditFromProject } from '@kovojs/drizzle/internal/static';
import { pgDatabaseTypes } from './test-helpers.js';

// @kovo-security-classifier-corpus drizzle-analyzer-provenance
// SPEC §6.6: a summary marker stays valid only while its exact callable identity is stable.

interface Probe {
  callable?: 'const-function' | 'function' | 'property';
  declaration?: 'const' | 'let';
  invocation?: string;
  mutation: string;
}

function sourceFor({
  callable = 'property',
  declaration = 'const',
  invocation,
  mutation,
}: Probe): string {
  const helperDeclaration =
    callable === 'property'
      ? [
          `${declaration} helpers = { current(context: Context) { return context.request.guard.userId; } };`,
          'kovoAnalyzerSummary(helpers.current, { returns: { kind: "guard", path: "userId" } });',
        ]
      : callable === 'function'
        ? [
            'function current(context: Context) { return context.request.guard.userId; }',
            'kovoAnalyzerSummary(current, { returns: { kind: "guard", path: "userId" } });',
          ]
        : [
            'const current = (context: Context) => context.request.guard.userId;',
            'kovoAnalyzerSummary(current, { returns: { kind: "guard", path: "userId" } });',
          ];
  const helperInvocation =
    invocation ?? (callable === 'property' ? 'helpers.current(context)' : 'current(context)');
  return [
    'import { eq } from "drizzle-orm";',
    'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
    'import { kovoAnalyzerSummary } from "@kovojs/drizzle";',
    'import { query } from "@kovojs/server";',
    'type Context = { request: { guard: { userId: string }, input: { userId: string } }, db: PgAsyncDatabase<any, any> };',
    'export const docs = pgTable("docs", {',
    '  userId: text("user_id").notNull(),',
    '  id: text("id").notNull(),',
    '}, kovo({ domain: "doc", key: "userId,id", owner: "userId" }));',
    `const unsafe = (context: Context) => context.request.input.userId;`,
    ...helperDeclaration,
    mutation,
    'export const list = query("list", {',
    '  async load(_input: {}, context: Context) {',
    `    const userId = ${helperInvocation};`,
    '    return { items: await context.db.select({ id: docs.id }).from(docs).where(eq(docs.userId, userId)) };',
    '  },',
    '});',
  ].join('\n');
}

function verdict(probe: Probe) {
  return verdictForSource(sourceFor(probe));
}

function verdictForSource(source: string) {
  const ownerAudit = extractOwnerAuditFromProject({
    files: [
      pgDatabaseTypes([
        'select(value?: unknown): { from(table: unknown): { where(value: unknown): Promise<unknown[]> } };',
      ]),
      { fileName: 'summary-stability.ts', source },
    ],
  });
  const check = kovoCheck(ownerAudit);
  return {
    check,
    scope: ownerAudit.scopeAudits.find((audit) => audit.name === 'list')?.scope,
  };
}

function valueContainerSource(mutation: string): string {
  return [
    'import { eq } from "drizzle-orm";',
    'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
    'import { kovoAnalyzerSummary } from "@kovojs/drizzle";',
    'import { query } from "@kovojs/server";',
    'type Context = { request: { guard: { userId: string } }, db: PgAsyncDatabase<any, any> };',
    'export const docs = pgTable("docs", { userId: text("user_id").notNull(), id: text("id").notNull() }, kovo({ domain: "doc", key: "userId,id", owner: "userId" }));',
    'function current(context: Context) { return context.request.guard.userId; }',
    'kovoAnalyzerSummary(current, { returns: { kind: "guard", path: "userId" } });',
    'export const list = query("list", {',
    '  async load(input: { userId: string }, context: Context) {',
    '    const principal = { userId: current(context) };',
    `    ${mutation}`,
    '    return { items: await context.db.select({ id: docs.id }).from(docs).where(eq(docs.userId, principal.userId)) };',
    '  },',
    '});',
  ].join('\n');
}

function valueAliasSource(declaration: string, mutation: string): string {
  return [
    'import { eq } from "drizzle-orm";',
    'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
    'import { kovoAnalyzerSummary } from "@kovojs/drizzle";',
    'import { query } from "@kovojs/server";',
    'type Context = { request: { guard: { userId: unknown } }, db: PgAsyncDatabase<any, any> };',
    'export const docs = pgTable("docs", { userId: text("user_id").notNull(), id: text("id").notNull() }, kovo({ domain: "doc", key: "userId,id", owner: "userId" }));',
    'function current(context: Context) { return context.request.guard.userId; }',
    'kovoAnalyzerSummary(current, { returns: { kind: "guard", path: "userId" } });',
    'function overwrite(target: any, replacement: unknown) { Object.assign(target, replacement); }',
    'export const list = query("list", {',
    '  async load(input: { userId: string }, context: Context) {',
    `    ${declaration}`,
    `    ${mutation}`,
    '    return { items: await context.db.select({ id: docs.id }).from(docs).where(eq(docs.userId, userId)) };',
    '  },',
    '});',
  ].join('\n');
}

describe('analyzer-summary callable stability', () => {
  it.each([
    ['Object.assign', { mutation: 'Object.assign(helpers, { current: unsafe });' }],
    [
      'Object.defineProperty',
      { mutation: 'Object.defineProperty(helpers, "current", { value: unsafe });' },
    ],
    ['Reflect.set', { mutation: 'Reflect.set(helpers, "current", unsafe);' }],
    [
      'an opaque mutator',
      {
        mutation:
          'function overwrite(target: any) { target.current = unsafe; } overwrite(helpers);',
      },
    ],
    [
      'a mutated object alias',
      {
        invocation: 'alias.current(context)',
        mutation: 'const alias = helpers; Object.assign(alias, { current: unsafe });',
      },
    ],
    [
      'later receiver reassignment',
      { declaration: 'let', mutation: 'helpers = { current: unsafe };' },
    ],
    [
      'later alias reassignment',
      {
        invocation: 'alias.current(context)',
        mutation: 'let alias = helpers; alias = { current: unsafe };',
      },
    ],
  ] as const)('fails closed after %s', (_label, probe) => {
    const result = verdict(probe);
    expect({
      exitCode: result.check.exitCode,
      hasKv414: result.check.output.includes('KV414'),
      scope: result.scope,
    }).toEqual({ exitCode: 1, hasKv414: true, scope: 'unknown' });
  });

  it.each([
    [
      'a plain callable container',
      {
        callable: 'function',
        invocation: 'helpers.current(context)',
        mutation: 'const helpers = { current };',
      },
    ],
    [
      'a reflectively replaced direct-helper container',
      {
        callable: 'function',
        invocation: 'helpers.current(context)',
        mutation: 'const helpers = { current }; Object.assign(helpers, { current: unsafe });',
      },
    ],
    [
      'a frozen-syntax callable container',
      {
        callable: 'function',
        invocation: 'helpers.current(context)',
        mutation: 'const helpers = Object.freeze({ current });',
      },
    ],
  ] as const)('keeps %s outside the direct-callable positive grammar', (_label, probe) => {
    const result = verdict(probe);
    expect(result.scope).toBe('unknown');
    expect(result.check.exitCode).toBe(1);
  });

  it('already closes direct property reassignment and destructured callables', () => {
    const direct = verdict({ mutation: 'helpers.current = unsafe;' });
    const destructured = verdict({
      invocation: 'current(context)',
      mutation: 'const { current } = helpers;',
    });
    expect(direct.scope).toBe('unknown');
    expect(direct.check.exitCode).toBe(1);
    expect(destructured.scope).toBe('unknown');
    expect(destructured.check.exitCode).toBe(1);
  });

  it.each([
    ['the exact object property', { mutation: '' }],
    [
      'an immutable object alias',
      { invocation: 'alias.current(context)', mutation: 'const alias = helpers;' },
    ],
    [
      'an immutable callable alias',
      { invocation: 'current(context)', mutation: 'const current = helpers.current;' },
    ],
  ] as const)('keeps %s outside the direct-callable positive grammar', (_label, probe) => {
    const result = verdict(probe);
    expect(result.scope).toBe('unknown');
    expect(result.check.exitCode).toBe(1);
  });

  it.each([
    ['a direct function declaration', { callable: 'function', mutation: '' }],
    ['a direct const function binding', { callable: 'const-function', mutation: '' }],
  ] as const)('keeps %s summary-proven', (_label, probe) => {
    const result = verdict(probe);
    expect(result.scope).toBe('session');
    expect(result.check.exitCode).toBe(0);
  });

  it.each([
    ['Object.assign', 'Object.assign(principal, { userId: input.userId });'],
    [
      'Object.defineProperty',
      'Object.defineProperty(principal, "userId", { value: input.userId });',
    ],
    ['Reflect.set', 'Reflect.set(principal, "userId", input.userId);'],
  ])('fails closed when %s replaces a private value-container cell', (_label, mutation) => {
    const result = verdictForSource(valueContainerSource(mutation));
    expect(result.scope).toBe('unknown');
    expect(result.check.exitCode).toBe(1);
  });

  it.each([
    [
      'a reassigned local value binding',
      'let userId = current(context);',
      'userId = input.userId;',
    ],
    [
      'a reflectively mutated local value',
      'const userId = current(context);',
      'Object.assign(userId, { value: input.userId });',
    ],
    [
      'an aliased local value escape',
      'const userId = current(context);',
      'const alias = userId; overwrite(alias, { value: input.userId });',
    ],
    [
      'an opaque local value escape',
      'const userId = current(context);',
      'overwrite(userId, { value: input.userId });',
    ],
  ])('fails closed after %s', (_label, declaration, mutation) => {
    const result = verdictForSource(valueAliasSource(declaration, mutation));
    expect(result.scope).toBe('unknown');
    expect(result.check.exitCode).toBe(1);
  });
});
