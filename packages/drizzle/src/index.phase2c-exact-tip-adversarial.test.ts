import { describe, expect, it } from 'vitest';

import { kovoCheck } from '../../cli/src/graph-output.js';
import {
  extractOwnerAuditFromProject,
  extractStaticBuildAnalysisFactsFromProject,
} from '@kovojs/drizzle/internal/static';
import { pgDatabaseTypes } from './test-helpers.js';

// Independent exact-tip review probes for SPEC §6.6/§10.3. These expectations
// intentionally state the fail-closed contract; any red case is a reproduced
// analyzer rejection finding, not an assertion of the current behavior.

const DB_TYPES = pgDatabaseTypes([
  'select(value?: unknown): { from(table: unknown): { where(value: unknown): Promise<unknown[]> } };',
  'update(table: unknown): { set(value: unknown): { where(value: unknown): Promise<void> } };',
]);

function ownerSource(body: readonly string[]): string {
  return [
    'import { eq } from "drizzle-orm";',
    'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
    'import { kovoAnalyzerSummary } from "@kovojs/drizzle";',
    'import { query, s } from "@kovojs/server";',
    'type Context = { request: { guard: { userId: string } }, db: PgAsyncDatabase<any, any> };',
    'type NullableContext = { request: { guard: { userId: string | undefined } }, db: PgAsyncDatabase<any, any> };',
    'export const docs = pgTable("docs", { userId: text("user_id").notNull(), id: text("id").notNull() }, kovo({ domain: "doc", key: "userId,id", owner: "userId" }));',
    'function current(context: Context) { return context.request.guard.userId; }',
    'kovoAnalyzerSummary(current, { returns: { kind: "guard", path: "userId" } });',
    ...body,
  ].join('\n');
}

function ownerVerdict(
  source: string,
  extraFiles: readonly { fileName: string; source: string }[] = [],
) {
  const audit = extractOwnerAuditFromProject({
    files: [DB_TYPES, ...extraFiles, { fileName: 'phase2c-adversarial.ts', source }],
  });
  const check = kovoCheck(audit);
  return {
    check,
    scope: audit.scopeAudits.find((entry) => entry.name === 'list')?.scope,
  };
}

function carrierMutationSource(mutation: string): string {
  return ownerSource([
    'function poison(target: Context, replacement: Context["request"]) { target.request = replacement; }',
    'export const list = query("list", {',
    '  args: s.object({ request: s.object({ guard: s.object({ userId: s.string() }) }) }),',
    '  async load(input: { request: Context["request"] }, context: Context) {',
    `    ${mutation}`,
    '    const userId = current(context);',
    '    return { items: await context.db.select({ id: docs.id }).from(docs).where(eq(docs.userId, userId)) };',
    '  },',
    '});',
  ]);
}

function massVerdict(
  body: readonly string[],
  options: {
    handler?: string;
    input?: string;
  } = {},
) {
  const project = {
    files: [
      DB_TYPES,
      {
        fileName: 'schema.ts',
        source: [
          'export const accounts = pgTable("accounts", {',
          '  id: text("id").primaryKey(),',
          '  ownerId: text("owner_id").notNull(),',
          '}, kovo({ domain: "account", key: "id", owner: "ownerId" }));',
        ].join('\n'),
      },
      {
        fileName: 'account.mutation.ts',
        source: [
          'import { eq } from "drizzle-orm";',
          'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
          'import { kovoAnalyzerSummary } from "@kovojs/drizzle";',
          'import { mutation, s, serverValue } from "@kovojs/server";',
          'import { accounts } from "./schema";',
          'type Context = { request: { guard: { userId: string } }, db: PgAsyncDatabase<any, any> };',
          'type DbRequest = { db: PgAsyncDatabase<any, any> };',
          'function current(context: Context) { return context.request.guard.userId; }',
          'kovoAnalyzerSummary(current, { returns: { kind: "guard", path: "userId" } });',
          'export const updateAccount = mutation({',
          `  input: ${options.input ?? 's.object({ id: s.string(), request: s.object({ guard: s.object({ userId: s.string() }) }) })'},`,
          `  async handler(${options.handler ?? 'input, context: Context'}) {`,
          ...body.map((line) => `    ${line}`),
          '  },',
          '});',
        ].join('\n'),
      },
    ],
  };
  const analysis = extractStaticBuildAnalysisFactsFromProject(project);
  return { analysis, check: kovoCheck(analysis) };
}

describe('Phase 2C exact-tip adversarial review', () => {
  it('does not accept a validated-input parameter merely because it is named context', () => {
    const result = ownerVerdict(
      ownerSource([
        'export const list = query("list", {',
        '  args: s.object({ guard: s.object({ userId: s.string() }) }),',
        '  async load(context: { guard: { userId: string } }, actual: Context) {',
        '    return { items: await actual.db.select({ id: docs.id }).from(docs).where(eq(docs.userId, context.guard.userId)) };',
        '  },',
        '});',
      ]),
    );
    expect(result.scope).not.toBe('session');
    expect(result.check.exitCode).toBe(1);
    expect(result.check.output).toContain('KV414');
  });

  it('does not let destructuring mint a private principal from validated input named context', () => {
    const result = ownerVerdict(
      ownerSource([
        'export const list = query("list", {',
        '  args: s.object({ guard: s.object({ userId: s.string() }) }),',
        '  async load(context: { guard: { userId: string } }, actual: Context) {',
        '    const { guard: { userId } } = context;',
        '    return { items: await actual.db.select({ id: docs.id }).from(docs).where(eq(docs.userId, userId)) };',
        '  },',
        '});',
      ]),
    );
    expect(result.scope).not.toBe('session');
    expect(result.check.exitCode).toBe(1);
    expect(result.check.output).toContain('KV414');
  });

  it.each([
    ['nested destructuring', 'const { request: { guard: { userId } } } = actual;'],
    ['a summarized projection', 'const userId = current(actual);'],
  ])(
    'proves an exact framework carrier independent of its local name through %s',
    (_label, read) => {
      const result = ownerVerdict(
        ownerSource([
          'export const list = query("list", {',
          '  args: s.object({}),',
          '  async load(_input: unknown, actual: Context) {',
          `    ${read}`,
          '    return { items: await actual.db.select({ id: docs.id }).from(docs).where(eq(docs.userId, userId)) };',
          '  },',
          '});',
        ]),
      );
      expect(result.scope).toBe('session');
      expect(result.check.exitCode).toBe(0);
    },
  );

  it.each([
    ['direct request replacement', 'context.request = input.request;'],
    ['Object.assign root replacement', 'Object.assign(context, { request: input.request });'],
    [
      'Object.defineProperty root replacement',
      'Object.defineProperty(context, "request", { value: input.request });',
    ],
    ['Reflect.set root replacement', 'Reflect.set(context, "request", input.request);'],
    ['opaque local mutator', 'poison(context, input.request);'],
    [
      'carrier alias replacement',
      'const carrierAlias = context; carrierAlias.request = input.request;',
    ],
  ])('closes summary provenance after %s', (_label, mutation) => {
    const result = ownerVerdict(carrierMutationSource(mutation));
    expect(result.scope).not.toBe('session');
    expect(result.check.exitCode).toBe(1);
    expect(result.check.output).toContain('KV414');
  });

  it('closes summary provenance after a cross-file opaque carrier mutator', () => {
    const source = ownerSource([
      'import { poison } from "./poison";',
      'export const list = query("list", {',
      '  args: s.object({ request: s.object({ guard: s.object({ userId: s.string() }) }) }),',
      '  async load(input: { request: Context["request"] }, context: Context) {',
      '    poison(context, input.request);',
      '    const userId = current(context);',
      '    return { items: await context.db.select({ id: docs.id }).from(docs).where(eq(docs.userId, userId)) };',
      '  },',
      '});',
    ]);
    const result = ownerVerdict(source, [
      {
        fileName: 'poison.ts',
        source:
          'export function poison(target: { request: unknown }, replacement: unknown) { target.request = replacement; }',
      },
    ]);
    expect(result.scope).not.toBe('session');
    expect(result.check.exitCode).toBe(1);
    expect(result.check.output).toContain('KV414');
  });

  it('does not treat a local accessor read as an effect-free conditional condition', () => {
    const result = ownerVerdict(
      ownerSource([
        'export const list = query("list", {',
        '  args: s.object({ request: s.object({ guard: s.object({ userId: s.string() }) }) }),',
        '  async load(input: { request: Context["request"] }, context: Context) {',
        '    const switcher = { get value() { context.request = input.request; return true; } };',
        '    const userId = switcher.value ? current(context) : current(context);',
        '    return { items: await context.db.select({ id: docs.id }).from(docs).where(eq(docs.userId, userId)) };',
        '  },',
        '});',
      ]),
    );
    expect(result.scope).not.toBe('session');
    expect(result.check.exitCode).toBe(1);
    expect(result.check.output).toContain('KV414');
  });

  it('invalidates accepted-guard dominance after reflective carrier-root replacement', () => {
    const result = ownerVerdict(
      ownerSource([
        'export const list = query("list", {',
        '  args: s.object({ userId: s.string() }),',
        '  async load(input: { userId: string }, context: NullableContext) {',
        '    if (!context.request.guard.userId) throw new Error("unauthorized");',
        '    Reflect.set(context, "request", { guard: { userId: input.userId } });',
        '    return { items: await context.db.select({ id: docs.id }).from(docs).where(eq(docs.userId, context.request.guard.userId)) };',
        '  },',
        '});',
      ]),
    );
    expect(result.scope).not.toBe('session');
    expect(result.check.exitCode).toBe(1);
    expect(result.check.output).toContain('KV414');
  });

  it('emits KV438 when the validated-input parameter is merely named request', () => {
    const result = massVerdict(
      [
        'await actual.db.update(accounts).set({ ownerId: serverValue(request.guard.userId, "private owner") }).where(eq(accounts.id, request.id));',
      ],
      {
        handler: 'request, actual: DbRequest',
        input: 's.object({ id: s.string(), guard: s.object({ userId: s.string() }) })',
      },
    );
    expect(result.analysis.massAssignmentFacts).toMatchObject([
      {
        column: 'ownerId',
        provenance: 'input',
        via: 'set',
      },
    ]);
    expect(result.check.exitCode).toBe(1);
    expect(result.check.output).toContain('KV438');
  });

  it('emits KV438 when validated input named request is destructured before serverValue', () => {
    const result = massVerdict(
      [
        'const { guard: { userId } } = request;',
        'await actual.db.update(accounts).set({ ownerId: serverValue(userId, "private owner") }).where(eq(accounts.id, request.id));',
      ],
      {
        handler: 'request, actual: DbRequest',
        input: 's.object({ id: s.string(), guard: s.object({ userId: s.string() }) })',
      },
    );
    expect(result.analysis.massAssignmentFacts).toMatchObject([
      {
        column: 'ownerId',
        provenance: 'input',
        via: 'set',
      },
    ]);
    expect(result.check.exitCode).toBe(1);
    expect(result.check.output).toContain('KV438');
  });

  it.each([
    [
      'a summarized helper',
      'Reflect.set(context, "request", input.request);',
      'serverValue(current(context), "private owner")',
      'unknown',
    ],
    [
      'a direct private access',
      'Object.assign(context, { request: input.request });',
      'serverValue(context.request.guard.userId, "private owner")',
      // The direct replacement is itself exactly input-proven; retain that stronger fact while
      // requiring KV438 instead of collapsing the carrier escape to an undifferentiated unknown.
      'input',
    ],
  ])(
    'emits KV438 after carrier replacement reaches serverValue through %s',
    (_label, mutation, value, provenance) => {
      const result = massVerdict([
        mutation,
        `await context.db.update(accounts).set({ ownerId: ${value} }).where(eq(accounts.id, input.id));`,
      ]);
      expect(result.analysis.massAssignmentFacts).toMatchObject([
        {
          column: 'ownerId',
          provenance,
          via: 'set',
        },
      ]);
      expect(result.check.exitCode).toBe(1);
      expect(result.check.output).toContain('KV438');
    },
  );
});
