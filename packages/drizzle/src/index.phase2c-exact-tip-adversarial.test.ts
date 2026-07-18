import { describe, expect, it } from 'vitest';
import { Project, SyntaxKind } from 'ts-morph';

import { kovoCheck } from '../../cli/src/graph-output.js';
import {
  extractOwnerAuditFromProject,
  extractStaticBuildAnalysisFactsFromProject,
  queryPrivateScopeKeyOperand,
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
  const scopeAudit = audit.scopeAudits.find((entry) => entry.name === 'list');
  return {
    check,
    detail: scopeAudit?.detail,
    scope: scopeAudit?.scope,
  };
}

function fullVerdict(source: string) {
  const analysis = extractStaticBuildAnalysisFactsFromProject({
    files: [DB_TYPES, { fileName: 'phase2c-adversarial.ts', source }],
  });
  return { analysis, check: kovoCheck(analysis) };
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

  it('fails closed when an input-named nested helper hides an owner read', () => {
    const source = ownerSource([
      'export const list = query("list", {',
      '  args: s.object({ guard: s.object({ userId: s.string() }) }),',
      '  async load(input: { guard: { userId: string } }, actual: Context) {',
      '    async function nested(context: { guard: { userId: string } }) {',
      '      return { items: await actual.db.select({ id: docs.id }).from(docs).where(eq(docs.userId, context.guard.userId)) };',
      '    }',
      '    return nested(input);',
      '  },',
      '});',
    ]);
    const full = fullVerdict(source);
    expect(full.check.exitCode).toBe(1);
    expect(full.check.output).toMatch(/KV406|KV414/u);
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

  it('does not recover a non-null session alias from validated input named request', () => {
    const result = ownerVerdict(
      ownerSource([
        'type SessionInput = { session: { userId: string } };',
        'export const list = query("list", {',
        '  args: s.object({ session: s.object({ userId: s.string() }) }),',
        '  async load(request: SessionInput, actual: Context) {',
        '    const userId = request.session.userId;',
        '    return { items: await actual.db.select({ id: docs.id }).from(docs).where(eq(docs.userId, userId)) };',
        '  },',
        '});',
      ]),
    );
    expect(result.scope).not.toBe('session');
    expect(result.check.exitCode).toBe(1);
    expect(result.check.output).toContain('KV414');
  });

  it('does not let a dominating check bless a guard path rooted in validated input', () => {
    const result = ownerVerdict(
      ownerSource([
        'export const list = query("list", {',
        '  args: s.object({ guard: s.object({ userId: s.string().optional() }) }),',
        '  async load(context: { guard: { userId?: string } }, actual: Context) {',
        '    if (!context.guard.userId) throw new Error("missing user");',
        '    return { items: await actual.db.select({ id: docs.id }).from(docs).where(eq(docs.userId, context.guard.userId)) };',
        '  },',
        '});',
      ]),
    );
    expect(result.scope).not.toBe('session');
    expect(result.check.exitCode).toBe(1);
    expect(result.check.output).toContain('KV414');
  });

  it('preserves a dominated optional guard principal on an exact query carrier', () => {
    const result = ownerVerdict(
      ownerSource([
        'export const list = query("list", {',
        '  args: s.object({}),',
        '  async load(_input: unknown, actual: { request: { guard?: { userId?: string } }, db: PgAsyncDatabase<any, any> }) {',
        '    if (!actual.request.guard?.userId) throw new Error("unauthorized");',
        '    return { items: await actual.db.select({ id: docs.id }).from(docs).where(eq(docs.userId, actual.request.guard?.userId)) };',
        '  },',
        '});',
      ]),
    );
    expect(result.scope).toBe('session');
    expect(result.detail).toContain('owner column compared to guard:userId');
    expect(result.check.exitCode).toBe(0);
  });

  it('preserves a dominated optional guard principal captured into an immutable scalar', () => {
    const result = ownerVerdict(
      ownerSource([
        'export const list = query("list", {',
        '  args: s.object({}),',
        '  async load(_input: unknown, actual: { request: { guard?: { userId?: string } }, db: PgAsyncDatabase<any, any> }) {',
        '    if (!actual.request.guard?.userId) throw new Error("unauthorized");',
        '    const userId = actual.request.guard?.userId;',
        '    return { items: await actual.db.select({ id: docs.id }).from(docs).where(eq(docs.userId, userId)) };',
        '  },',
        '});',
      ]),
    );
    expect(result.scope).toBe('session');
    expect(result.detail).toContain('owner column compared to guard:userId');
    expect(result.check.exitCode).toBe(0);
  });

  it('does not transfer private provenance through a mutable object capture', () => {
    const result = ownerVerdict(
      ownerSource([
        'export const list = query("list", {',
        '  args: s.object({ userId: s.string() }),',
        '  async load(input: { userId: string }, actual: { request: { guard?: { user?: { id: string } } }, db: PgAsyncDatabase<any, any> }) {',
        '    if (!actual.request.guard?.user?.id) throw new Error("unauthorized");',
        '    const user = actual.request.guard?.user;',
        '    user.id = input.userId;',
        '    return { items: await actual.db.select({ id: docs.id }).from(docs).where(eq(docs.userId, user.id)) };',
        '  },',
        '});',
      ]),
    );
    expect(result.scope).not.toBe('session');
    expect(result.check.exitCode).toBe(1);
    expect(result.check.output).toContain('KV414');
  });

  it('does not treat a carrier-owned input.guard subtree as private principal state', () => {
    const result = ownerVerdict(
      ownerSource([
        'export const list = query("list", {',
        '  args: s.object({}),',
        '  async load(_input: unknown, actual: Context & { input: { guard: { userId: string } } }) {',
        '    return { items: await actual.db.select({ id: docs.id }).from(docs).where(eq(docs.userId, actual.input.guard.userId)) };',
        '  },',
        '});',
      ]),
    );
    expect(result.scope).not.toBe('session');
    expect(result.check.exitCode).toBe(1);
    expect(result.check.output).toContain('KV414');
  });

  it('does not let a local guard check bless a carrier-owned input.guard subtree', () => {
    const result = ownerVerdict(
      ownerSource([
        'export const list = query("list", {',
        '  args: s.object({}),',
        '  async load(_input: unknown, actual: Context & { input: { guard: { userId?: string } } }) {',
        '    if (!actual.input.guard.userId) return;',
        '    return { items: await actual.db.select({ id: docs.id }).from(docs).where(eq(docs.userId, actual.input.guard.userId)) };',
        '  },',
        '});',
      ]),
    );
    expect(result.scope).not.toBe('session');
    expect(result.check.exitCode).toBe(1);
    expect(result.check.output).toContain('KV414');
  });

  it('does not recover a session local from a carrier-owned input.session subtree', () => {
    const result = ownerVerdict(
      ownerSource([
        'export const list = query("list", {',
        '  args: s.object({}),',
        '  async load(_input: unknown, actual: Context & { input: { session: { userId: string } } }) {',
        '    const userId = actual.input.session.userId;',
        '    return { items: await actual.db.select({ id: docs.id }).from(docs).where(eq(docs.userId, userId)) };',
        '  },',
        '});',
      ]),
    );
    expect(result.scope).not.toBe('session');
    expect(result.check.exitCode).toBe(1);
    expect(result.check.output).toContain('KV414');
  });

  it.each(['fail', 'redirect', 'notFound'])(
    'does not treat a bare app-local %s() call as a control-flow exit',
    (outcome) => {
      const result = ownerVerdict(
        ownerSource([
          `function ${outcome}() { return undefined; }`,
          'export const list = query("list", {',
          '  args: s.object({}),',
          '  async load(_input: unknown, actual: { request: { guard?: { userId?: string } }, db: PgAsyncDatabase<any, any> }) {',
          `    if (!actual.request.guard?.userId) ${outcome}();`,
          '    return { items: await actual.db.select({ id: docs.id }).from(docs).where(eq(docs.userId, actual.request.guard?.userId)) };',
          '  },',
          '});',
        ]),
      );
      expect(result.scope).not.toBe('session');
      expect(result.check.exitCode).toBe(1);
      expect(result.check.output).toContain('KV414');
    },
  );
  it('does not let destructuring launder a carrier-owned input.guard subtree', () => {
    const result = ownerVerdict(
      ownerSource([
        'export const list = query("list", {',
        '  args: s.object({}),',
        '  async load(_input: unknown, actual: Context & { input: { guard: { userId: string } } }) {',
        '    const { input: { guard: { userId } } } = actual;',
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
    ['Object.freeze', 'Object.freeze([actual.request.guard.userId] as const)'],
    ['Array.of', 'Array.of(actual.request.guard.userId)'],
    ['Array.from', 'Array.from([actual.request.guard.userId] as const)'],
    ['Array.concat', '([] as string[]).concat(actual.request.guard.userId)'],
  ])('keeps repeated exact private reads through %s scope:session', (_label, values) => {
    const result = ownerVerdict(
      ownerSource([
        'import { and, inArray } from "drizzle-orm";',
        'export const list = query("list", {',
        '  args: s.object({}),',
        '  async load(_input: unknown, actual: Context) {',
        `    return { items: await actual.db.select({ id: docs.id }).from(docs).where(and(inArray(docs.userId, ${values}), inArray(docs.userId, ${values}))) };`,
        '  },',
        '});',
      ]),
    );
    expect(result.scope).toBe('session');
    expect(result.check.exitCode).toBe(0);
  });

  it('does not admit an exact finite wrapper when its outer consumer is opaque', () => {
    const result = ownerVerdict(
      ownerSource([
        'function observe(_value: unknown) { return undefined; }',
        'export const list = query("list", {',
        '  args: s.object({}),',
        '  async load(_input: unknown, actual: Context) {',
        '    observe(Array.of(actual.request.guard.userId));',
        '    return { items: await actual.db.select({ id: docs.id }).from(docs).where(eq(docs.userId, actual.request.guard.userId)) };',
        '  },',
        '});',
      ]),
    );
    expect(result.scope).not.toBe('session');
    expect(result.check.exitCode).toBe(1);
    expect(result.check.output).toContain('KV414');
  });

  it('does not admit a shadowed finite wrapper in repeated private predicates', () => {
    const result = ownerVerdict(
      ownerSource([
        'import { and, inArray } from "drizzle-orm";',
        'export const list = query("list", {',
        '  args: s.object({}),',
        '  async load(_input: unknown, actual: Context) {',
        '    const Array = { of<T>(value: T): T[] { return [value]; } };',
        '    return { items: await actual.db.select({ id: docs.id }).from(docs).where(and(inArray(docs.userId, Array.of(actual.request.guard.userId)), inArray(docs.userId, Array.of(actual.request.guard.userId)))) };',
        '  },',
        '});',
      ]),
    );
    expect(result.scope).not.toBe('session');
    expect(result.check.exitCode).toBe(1);
    expect(result.check.output).toContain('KV414');
  });

  it('does not launder a non-null private alias through a same-text for-of binding', () => {
    const result = ownerVerdict(
      ownerSource([
        'export const list = query("list", {',
        '  args: s.object({ userId: s.string() }),',
        '  async load(input: { userId: string }, actual: Context) {',
        '    const userId = actual.request.guard.userId;',
        '    for (const userId of [input.userId])',
        '      return { items: await actual.db.select({ id: docs.id }).from(docs).where(eq(docs.userId, userId)) };',
        '    return { items: [] };',
        '  },',
        '});',
      ]),
    );
    expect(result.scope).not.toBe('session');
    expect(result.check.exitCode).toBe(1);
    expect(result.check.output).toContain('KV414');
  });

  it('does not transfer an accepted guard to a same-text for-of binding', () => {
    const result = ownerVerdict(
      ownerSource([
        'export const list = query("list", {',
        '  args: s.object({ userId: s.string() }),',
        '  async load(input: { userId: string }, actual: NullableContext) {',
        '    const userId = actual.request.guard?.userId;',
        '    if (!userId) return { items: [] };',
        '    for (const userId of [input.userId])',
        '      return { items: await actual.db.select({ id: docs.id }).from(docs).where(eq(docs.userId, userId)) };',
        '    return { items: [] };',
        '  },',
        '});',
      ]),
    );
    expect(result.scope).not.toBe('session');
    expect(result.check.exitCode).toBe(1);
    expect(result.check.output).toContain('KV414');
  });

  it('does not erase a resolved shadow through an unresolved accepted-guard alias fallback', () => {
    const project = new Project({ useInMemoryFileSystem: true });
    const source = project.createSourceFile(
      'accepted-guard-shadow.ts',
      [
        'declare function consume(value: string): void;',
        'function probe(input: string[], carrier: { guard: { userId: string } }) {',
        '  const principal = carrier.guard.userId;',
        '  for (const principal of input) consume(principal);',
        '}',
      ].join('\n'),
    );
    const declaration = source
      .getDescendantsOfKind(SyntaxKind.VariableDeclaration)
      .find((candidate) => candidate.getInitializer()?.getText() === 'carrier.guard.userId');
    const use = source
      .getDescendantsOfKind(SyntaxKind.CallExpression)
      .find((candidate) => candidate.getExpression().getText() === 'consume')
      ?.getArguments()[0];
    if (!declaration || !use) throw new Error('expected exact shadow probe nodes');

    const operand = queryPrivateScopeKeyOperand(use, undefined, {
      acceptedGuardPrivateKeys: new Set(['guard:userId']),
      aliases: new Map([
        [
          'name:principal',
          {
            declaration,
            kind: 'guard' as const,
            name: 'principal',
            path: 'userId',
            requiresGuard: true,
          },
        ],
      ]),
      helpers: new Map(),
      opaqueAliases: new Map(),
    });
    expect(operand.privateKey).toBeUndefined();
  });

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

  it('emits KV438 when carrier-owned input.guard is destructured before serverValue', () => {
    const result = massVerdict(
      [
        'const { input: { guard: { userId } } } = context;',
        'await context.db.update(accounts).set({ ownerId: serverValue(userId, "private owner") }).where(eq(accounts.id, input.id));',
      ],
      {
        handler: 'input, context: Context & { input: { guard: { userId: string } } }',
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

  it('emits KV438 for a same-text for-of binding shadowing a private serverValue alias', () => {
    const result = massVerdict(
      [
        'const ownerId = context.request.guard.userId;',
        'for (const ownerId of [input.ownerId])',
        '  await context.db.update(accounts).set({ ownerId: serverValue(ownerId, "private owner") }).where(eq(accounts.id, input.id));',
      ],
      {
        input: 's.object({ id: s.string(), ownerId: s.string() })',
      },
    );
    expect(result.analysis.massAssignmentFacts).toMatchObject([
      {
        column: 'ownerId',
        provenance: 'unknown',
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

  // @kovo-security-certifies C13 private-summary-sole-carrier-argument
  it.each([
    [
      'a strict-TS widened direct alias with side-effecting extra argument evaluation',
      [
        'function poison(guard: Context["request"]["guard"], value: string) { guard.userId = value; }',
        'const widened: (context: Context, ...ignored: unknown[]) => string = current;',
      ],
      'widened(context, poison(context.request.guard, input.userId))',
    ],
    [
      'a strict-TS empty tuple spread',
      ['const noArguments: [] = [];'],
      'current(context, ...noArguments)',
    ],
  ])('keeps a summarized principal unknown through %s', (_label, declarations, principal) => {
    const result = ownerVerdict(
      ownerSource([
        ...declarations,
        'export const list = query("list", {',
        '  args: s.object({ userId: s.string() }),',
        '  async load(input: { userId: string }, context: Context) {',
        `    return { items: await context.db.select({ id: docs.id }).from(docs).where(eq(docs.userId, ${principal})) };`,
        '  },',
        '});',
      ]),
    );
    expect(result.scope).toBe('unknown');
    expect(result.check.exitCode).toBe(1);
    expect(result.check.output).toContain('KV414');
  });

  // @kovo-security-certifies C13 private-summary-one-direct-alias
  it('keeps a two-hop private helper alias chain outside OPP-28 proof', () => {
    const result = ownerVerdict(
      ownerSource([
        'const first = current;',
        'const second = first;',
        'export const list = query("list", {',
        '  args: s.object({}),',
        '  async load(_input: unknown, context: Context) {',
        '    return { items: await context.db.select({ id: docs.id }).from(docs).where(eq(docs.userId, second(context))) };',
        '  },',
        '});',
      ]),
    );
    expect(result.scope).toBe('unknown');
    expect(result.check.exitCode).toBe(1);
    expect(result.check.output).toContain('KV414');
  });

  it('emits KV438 for a widened private helper alias with extra argument evaluation', () => {
    const result = massVerdict(
      [
        'function poison(guard: Context["request"]["guard"], value: string) { guard.userId = value; }',
        'const widened: (context: Context, ...ignored: unknown[]) => string = current;',
        'await context.db.update(accounts).set({ ownerId: serverValue(widened(context, poison(context.request.guard, input.ownerId)), "private owner") }).where(eq(accounts.id, input.id));',
      ],
      { input: 's.object({ id: s.string(), ownerId: s.string() })' },
    );
    expect(result.analysis.massAssignmentFacts).toMatchObject([
      { column: 'ownerId', provenance: 'unknown', via: 'set' },
    ]);
    expect(result.check.exitCode).toBe(1);
    expect(result.check.output).toContain('KV438');
  });

  it('emits KV438 for a two-hop private helper alias chain', () => {
    const result = massVerdict([
      'const first = current;',
      'const second = first;',
      'await context.db.update(accounts).set({ ownerId: serverValue(second(context), "private owner") }).where(eq(accounts.id, input.id));',
    ]);
    expect(result.analysis.massAssignmentFacts).toMatchObject([
      { column: 'ownerId', provenance: 'unknown', via: 'set' },
    ]);
    expect(result.check.exitCode).toBe(1);
    expect(result.check.output).toContain('KV438');
  });
});
