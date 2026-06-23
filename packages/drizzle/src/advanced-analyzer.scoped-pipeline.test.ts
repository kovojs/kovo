import { describe, expect, it } from 'vitest';

import {
  diagnosticsForTouchGraph,
  extractAlgebraicShapesFromProject,
  extractQueryFactsFromProject,
  extractSymbolicEffectsFromProject,
  extractTouchGraphFromProject,
} from '@kovojs/drizzle/internal/static';
import { deriveOptimistic } from './derive.js';
import { serializeDerivedOptimistic } from './derive-codegen.js';
import { pgDatabaseTypes } from './test-helpers.js';

describe('@kovojs/drizzle advanced analyzer scoped pipeline', () => {
  it('derives scoped composite-key row updates from extracted query and mutation facts', () => {
    const files = [
      pgDatabaseTypes([
        'select(value?: unknown): { from(table: unknown): { where(value: unknown): Promise<unknown[]> } };',
        'update(table: unknown): { set(value: unknown): { where(value: unknown): Promise<void> } };',
      ]),
      {
        fileName: 'question.pipeline.ts',
        source: [
          'import { and, eq } from "drizzle-orm";',
          'import type { PgDatabase } from "drizzle-orm/pg-core";',
          '',
          'export const questions = pgTable("questions", {',
          '  sessionId: text("session_id").notNull(),',
          '  id: text("id").notNull(),',
          '  score: integer("score").notNull(),',
          '}, kovo({ domain: "question", key: "sessionId,id" }));',
          '',
          'export const questionList = query("questionList", {',
          '  async load(_input: {}, db: PgDatabase<any, any, any>, context: { request?: { session?: { id?: string } | null } }) {',
          '    const sessionId = context.request?.session?.id;',
          '    if (!sessionId) throw new Error("auth required");',
          '    return {',
          '      items: await db.select({ id: questions.id, score: questions.score }).from(questions).where(eq(questions.sessionId, sessionId)),',
          '    };',
          '  },',
          '});',
          '',
          'export async function voteUp(db: PgDatabase<any, any, any>, context: { request?: { session?: { id?: string } | null } }, targetId: string) {',
          '  const sessionId = context.request?.session?.id;',
          '  if (!sessionId) throw new Error("auth required");',
          '  await db.update(questions).set({ score: questions.score + 1 }).where(and(eq(questions.sessionId, sessionId), eq(questions.id, targetId)));',
          '}',
        ].join('\n'),
      },
    ];

    const graph = extractTouchGraphFromProject({ files });
    expect(graph.voteUp?.touches).toEqual([
      {
        domain: 'question',
        keys: 'arg:targetId',
        site: 'question.pipeline.ts:23',
        via: 'questions',
      },
    ]);
    expect(diagnosticsForTouchGraph(graph)).toEqual([]);

    const shape = extractAlgebraicShapesFromProject({ files }).find(
      (candidate) => candidate.query === 'questionList',
    );
    if (!shape) throw new Error('expected questionList algebraic shape');
    expect(shape.fields.items).toMatchObject({
      kind: 'agg',
      projection: ['id', 'score'],
      rowKey: 'sessionId,id',
      rowset: {
        filters: [
          {
            column: 'sessionId',
            op: 'eq',
            value: { kind: 'session', path: 'id' },
          },
        ],
        key: 'sessionId,id',
        table: 'questions',
      },
    });

    const effect = extractSymbolicEffectsFromProject({ files }).find(
      (candidate) => candidate.writeKey === 'voteUp',
    );
    if (!effect) throw new Error('expected voteUp symbolic effect');
    expect(effect.effect).toMatchObject({
      match: {
        eq: [
          { column: 'sessionId', value: { kind: 'session', path: 'id' } },
          { column: 'id', value: { kind: 'param', path: 'targetId' } },
        ],
        kind: 'keys',
      },
      op: 'update',
      table: 'questions',
    });

    const result = deriveOptimistic([effect.effect], shape);
    if (result.kind !== 'derived') throw new Error(`expected derived, got ${result.kind}`);
    expect(result.program.ops).toEqual([
      {
        guard: 'find-or-noop',
        match: [{ column: 'id', value: { kind: 'param', path: 'targetId' } }],
        op: 'update-row',
        path: 'items',
        sets: {
          score: {
            kind: 'arith',
            left: { kind: 'col', column: 'score' },
            op: '+',
            right: { kind: 'const', value: 1 },
          },
        },
      },
    ]);

    const source = serializeDerivedOptimistic({
      complete: true,
      constName: 'questionVoteDerivedOptimistic',
      entries: [{ program: result.program, query: 'questionList' }],
      formImport: { name: 'voteQuestionForm', path: '../../app.js' },
    });
    expect(source).toContain('entry.id === $input.targetId');
    expect(source).toContain('target.score = (n(target.score) + n(1));');
    expect(source).not.toContain('sessionId');
    expect(source).not.toContain('session:');
    expect(source).not.toContain('$input.session');
  });

  it('derives tenant-scoped filtered-list exits without exposing tenant scope', () => {
    const files = [
      pgDatabaseTypes([
        'select(value?: unknown): { from(table: unknown): { where(value: unknown): Promise<unknown[]> } };',
        'update(table: unknown): { set(value: unknown): { where(value: unknown): Promise<void> } };',
      ]),
      {
        fileName: 'ticket.pipeline.ts',
        source: [
          'import { and, eq } from "drizzle-orm";',
          'import type { PgDatabase } from "drizzle-orm/pg-core";',
          'import { kovoAnalyzerSummary } from "@kovojs/drizzle";',
          '',
          'export const tickets = pgTable("tickets", {',
          '  tenantId: text("tenant_id").notNull(),',
          '  id: text("id").notNull(),',
          '  status: text("status").notNull(),',
          '}, kovo({ domain: "ticket", key: "tenantId,id" }));',
          '',
          'function currentTenantId(context: { request?: { session?: { tenantId?: string } | null } }) {',
          '  if (!context.request?.session?.tenantId) throw new Error("tenant required");',
          '  return context.request.session.tenantId;',
          '}',
          'kovoAnalyzerSummary(currentTenantId, { returns: { kind: "tenant", path: "id" } });',
          '',
          'export const openTickets = query("openTickets", {',
          '  async load(_input: {}, db: PgDatabase<any, any, any>, context: { request?: { session?: { tenantId?: string } | null } }) {',
          '    const tenantId = currentTenantId(context);',
          '    return {',
          '      items: await db.select({ id: tickets.id, status: tickets.status }).from(tickets).where(and(eq(tickets.tenantId, tenantId), eq(tickets.status, "open"))),',
          '    };',
          '  },',
          '});',
          '',
          'export async function closeTicket(db: PgDatabase<any, any, any>, context: { request?: { session?: { tenantId?: string } | null } }, targetId: string) {',
          '  const tenantId = currentTenantId(context);',
          '  await db.update(tickets).set({ status: "closed" }).where(and(eq(tickets.tenantId, tenantId), eq(tickets.id, targetId)));',
          '}',
        ].join('\n'),
      },
    ];

    const graph = extractTouchGraphFromProject({ files });
    expect(graph.closeTicket?.touches).toMatchObject([
      {
        domain: 'ticket',
        keys: 'arg:targetId',
        via: 'tickets',
      },
    ]);
    expect(diagnosticsForTouchGraph(graph)).toEqual([]);

    const queryFact = extractQueryFactsFromProject({ files }).find(
      (candidate) => candidate.query === 'openTickets',
    );
    expect(queryFact).toMatchObject({
      query: 'openTickets',
      reads: ['ticket'],
    });
    expect(queryFact?.instanceKey).toBeUndefined();

    const shape = extractAlgebraicShapesFromProject({ files }).find(
      (candidate) => candidate.query === 'openTickets',
    );
    if (!shape) throw new Error('expected openTickets algebraic shape');
    expect(shape.fields.items).toMatchObject({
      kind: 'agg',
      projection: ['id', 'status'],
      rowKey: 'tenantId,id',
      rowset: {
        filters: [
          { column: 'tenantId', op: 'eq', value: { kind: 'tenant', path: 'id' } },
          { column: 'status', op: 'eq', value: { kind: 'const', value: 'open' } },
        ],
        key: 'tenantId,id',
        table: 'tickets',
      },
    });

    const effect = extractSymbolicEffectsFromProject({ files }).find(
      (candidate) => candidate.writeKey === 'closeTicket',
    );
    if (!effect) throw new Error('expected closeTicket symbolic effect');
    expect(effect.effect).toMatchObject({
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
    });

    const result = deriveOptimistic([effect.effect], shape);
    if (result.kind !== 'derived') throw new Error(`expected derived, got ${result.kind}`);
    expect(result.program.ops).toEqual([
      {
        guard: 'find-or-noop',
        match: [{ column: 'id', value: { kind: 'param', path: 'targetId' } }],
        op: 'remove-row',
        path: 'items',
      },
    ]);

    const source = serializeDerivedOptimistic({
      complete: true,
      constName: 'ticketCloseDerivedOptimistic',
      entries: [{ program: result.program, query: 'openTickets' }],
      formImport: { name: 'closeTicketForm', path: '../../app.js' },
    });
    expect(source).toContain('entry.id === $input.targetId');
    expect(source).not.toContain('tenantId');
    expect(source).not.toContain('tenant:');
    expect(source).not.toContain('$input.tenant');
  });
});
