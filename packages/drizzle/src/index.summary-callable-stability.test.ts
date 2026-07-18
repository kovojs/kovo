import { describe, expect, it } from 'vitest';

import { kovoCheck } from '../../cli/src/graph-output.js';
import { extractOwnerAuditFromProject } from '@kovojs/drizzle/internal/static';
import { pgDatabaseTypes } from './test-helpers.js';

// @kovo-security-classifier-corpus drizzle-analyzer-provenance
// SPEC §6.6: a summary marker stays valid only while its exact callable identity is stable.

interface Probe {
  declaration?: 'const' | 'let';
  invocation?: string;
  mutation: string;
}

function sourceFor({
  declaration = 'const',
  invocation = 'helpers.current(context)',
  mutation,
}: Probe): string {
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
    `${declaration} helpers = { current(context: Context) { return context.request.guard.userId; } };`,
    'kovoAnalyzerSummary(helpers.current, { returns: { kind: "guard", path: "userId" } });',
    mutation,
    'export const list = query("list", {',
    '  async load(_input: {}, context: Context) {',
    `    const userId = ${invocation};`,
    '    return { items: await context.db.select({ id: docs.id }).from(docs).where(eq(docs.userId, userId)) };',
    '  },',
    '});',
  ].join('\n');
}

function verdict(probe: Probe) {
  const ownerAudit = extractOwnerAuditFromProject({
    files: [
      pgDatabaseTypes([
        'select(value?: unknown): { from(table: unknown): { where(value: unknown): Promise<unknown[]> } };',
      ]),
      { fileName: 'summary-stability.ts', source: sourceFor(probe) },
    ],
  });
  const check = kovoCheck(ownerAudit);
  return {
    check,
    scope: ownerAudit.scopeAudits.find((audit) => audit.name === 'list')?.scope,
  };
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
        mutation:
          'const alias = helpers; Object.assign(alias, { current: unsafe });',
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
  ] as const)('keeps %s summary-proven', (_label, probe) => {
    const result = verdict(probe);
    expect(result.scope).toBe('session');
    expect(result.check.exitCode).toBe(0);
  });
});
