import { describe, expect, it } from 'vitest';

import {
  diagnosticsForTouchGraph,
  extractAlgebraicShapesFromProject,
  extractOwnerAuditFromProject,
  extractQueryFactsFromProject,
  extractSymbolicEffectsFromProject,
  extractTouchGraphFromProject,
} from '@kovojs/drizzle/internal/static';
import { deriveOptimistic } from './derive.js';
import { serializeDerivedOptimistic } from './derive-codegen.js';
import { pgDatabaseTypes } from './test-helpers.js';

describe('@kovojs/drizzle advanced analyzer scoped pipeline', () => {
  it('derives Stack Overflow-style scoped composite-key updates from extracted facts', () => {
    const files = [
      pgDatabaseTypes([
        'select(value?: unknown): { from(table: unknown): { where(value: unknown): Promise<unknown[]> } };',
        'update(table: unknown): { set(value: unknown): { where(value: unknown): Promise<void> } };',
      ]),
      {
        fileName: 'question.pipeline.ts',
        source: [
          'import { and, eq, sum } from "drizzle-orm";',
          'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
          '',
          'export const questions = pgTable("questions", {',
          '  sessionId: text("session_id").notNull(),',
          '  id: text("id").notNull(),',
          '  score: integer("score").notNull(),',
          '  answerCount: integer("answer_count").notNull(),',
          '}, kovo({ domain: "question", key: "sessionId,id" }));',
          '',
          'export const questionList = query("questionList", {',
          '  async load(_input: {}, db: PgAsyncDatabase<any, any>, context: { request?: { session?: { id?: string } | null } }) {',
          '    const sessionId = context.request?.session?.id;',
          '    if (!sessionId) throw new Error("auth required");',
          '    return {',
          '      items: await db.select({ id: questions.id, score: questions.score, answerCount: questions.answerCount }).from(questions).where(eq(questions.sessionId, sessionId)),',
          '    };',
          '  },',
          '});',
          '',
          'export const questionScore = query("questionScore", {',
          '  async load(_input: {}, db: PgAsyncDatabase<any, any>, context: { request?: { session?: { id?: string } | null } }) {',
          '    const sessionId = context.request?.session?.id;',
          '    if (!sessionId) throw new Error("auth required");',
          '    const items = await db.select({ id: questions.id, score: questions.score, answerCount: questions.answerCount }).from(questions).where(eq(questions.sessionId, sessionId));',
          '    const scoreRows = await db.select({ value: sum(questions.score) }).from(questions).where(eq(questions.sessionId, sessionId));',
          '    return { items: items, totalScore: Number(scoreRows[0]?.value ?? 0) };',
          '  },',
          '});',
          '',
          'export async function postAnswer(db: PgAsyncDatabase<any, any>, context: { request?: { session?: { id?: string } | null } }, targetId: string) {',
          '  const sessionId = context.request?.session?.id;',
          '  if (!sessionId) throw new Error("auth required");',
          '  await db.update(questions).set({ answerCount: questions.answerCount + 1 }).where(and(eq(questions.sessionId, sessionId), eq(questions.id, targetId)));',
          '}',
          '',
          'export async function voteUp(db: PgAsyncDatabase<any, any>, context: { request?: { session?: { id?: string } | null } }, targetId: string) {',
          '  const sessionId = context.request?.session?.id;',
          '  if (!sessionId) throw new Error("auth required");',
          '  await db.update(questions).set({ score: questions.score + 1 }).where(and(eq(questions.sessionId, sessionId), eq(questions.id, targetId)));',
          '}',
        ].join('\n'),
      },
    ];

    const graph = extractTouchGraphFromProject({ files });
    expect(graph.postAnswer?.touches).toMatchObject([
      {
        domain: 'question',
        keys: 'arg:targetId',
        via: 'questions',
      },
    ]);
    expect(graph.voteUp?.touches).toMatchObject([
      {
        domain: 'question',
        keys: 'arg:targetId',
        via: 'questions',
      },
    ]);
    expect(diagnosticsForTouchGraph(graph)).toEqual([]);

    const queryFacts = extractQueryFactsFromProject({ files });
    const questionListFact = queryFacts.find((candidate) => candidate.query === 'questionList');
    expect(questionListFact).toMatchObject({ query: 'questionList', reads: ['question'] });
    expect(questionListFact?.instanceKey).toBeUndefined();
    const questionScoreFact = queryFacts.find((candidate) => candidate.query === 'questionScore');
    expect(questionScoreFact).toMatchObject({ query: 'questionScore', reads: ['question'] });
    expect(questionScoreFact?.instanceKey).toBeUndefined();

    const shapes = extractAlgebraicShapesFromProject({ files });
    const shape = shapes.find((candidate) => candidate.query === 'questionList');
    if (!shape) throw new Error('expected questionList algebraic shape');
    const scopedQuestionRowset = {
      filters: [
        {
          column: 'sessionId',
          op: 'eq' as const,
          value: { kind: 'session' as const, path: 'id' },
        },
      ],
      key: 'sessionId,id',
      orderBy: [],
      table: 'questions',
    };
    expect(shape.fields.items).toMatchObject({
      kind: 'agg',
      projection: ['id', 'score', 'answerCount'],
      rowKey: 'sessionId,id',
      rowset: scopedQuestionRowset,
    });

    const scoreShape = shapes.find((candidate) => candidate.query === 'questionScore');
    if (!scoreShape) throw new Error('expected questionScore algebraic shape');
    expect(scoreShape.fields.items).toMatchObject({
      kind: 'agg',
      projection: ['id', 'score', 'answerCount'],
      rowKey: 'sessionId,id',
      rowset: scopedQuestionRowset,
    });
    expect(scoreShape.fields.totalScore).toMatchObject({
      arith: { column: 'score', kind: 'col' },
      kind: 'sum',
      rowset: scopedQuestionRowset,
    });
    expect(scoreShape.rowsByTable?.questions).toMatchObject({
      columns: ['id', 'score', 'answerCount'],
      rowsPath: 'items',
      rowset: scopedQuestionRowset,
    });

    const effects = extractSymbolicEffectsFromProject({ files });
    const postAnswerEffect = effects.find((candidate) => candidate.writeKey === 'postAnswer');
    if (!postAnswerEffect) throw new Error('expected postAnswer symbolic effect');
    expect(postAnswerEffect.effect).toMatchObject({
      match: {
        eq: [
          { column: 'sessionId', value: { kind: 'session', path: 'id' } },
          { column: 'id', value: { kind: 'param', path: 'targetId' } },
        ],
        kind: 'keys',
      },
      op: 'update',
      sets: {
        answerCount: {
          kind: 'arith',
          left: { kind: 'col', column: 'answerCount' },
          op: '+',
          right: { kind: 'const', value: 1 },
        },
      },
      table: 'questions',
    });

    const effect = effects.find((candidate) => candidate.writeKey === 'voteUp');
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
      sets: {
        score: {
          kind: 'arith',
          left: { kind: 'col', column: 'score' },
          op: '+',
          right: { kind: 'const', value: 1 },
        },
      },
      table: 'questions',
    });

    const postAnswerResult = deriveOptimistic([postAnswerEffect.effect], shape);
    if (postAnswerResult.kind !== 'derived') {
      throw new Error(`expected postAnswer derived, got ${postAnswerResult.kind}`);
    }
    expect(postAnswerResult.program.ops).toEqual([
      {
        guard: 'find-or-noop',
        match: [{ column: 'id', value: { kind: 'param', path: 'targetId' } }],
        op: 'update-row',
        path: 'items',
        sets: {
          answerCount: {
            kind: 'arith',
            left: { kind: 'col', column: 'answerCount' },
            op: '+',
            right: { kind: 'const', value: 1 },
          },
        },
      },
    ]);

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

    const scoreResult = deriveOptimistic([effect.effect], scoreShape);
    if (scoreResult.kind !== 'derived') {
      throw new Error(`expected questionScore derived, got ${scoreResult.kind}`);
    }
    expect(scoreResult.program.ops).toEqual([
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
      { column: 'score', from: 'items', op: 'resum', path: 'totalScore' },
    ]);

    const postAnswerSource = serializeDerivedOptimistic({
      complete: true,
      constName: 'answerPostDerivedOptimistic',
      entries: [{ program: postAnswerResult.program, query: 'questionList' }],
      formImport: { name: 'postAnswerForm', path: '../../app.js' },
    });
    expect(postAnswerSource).toContain('entry.id === $input.targetId');
    expect(postAnswerSource).toContain('target.answerCount = (n(target.answerCount) + n(1));');
    expect(postAnswerSource).not.toContain('sessionId');
    expect(postAnswerSource).not.toContain('session:');
    expect(postAnswerSource).not.toContain('$input.session');

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

    const scoreSource = serializeDerivedOptimistic({
      complete: true,
      constName: 'questionScoreDerivedOptimistic',
      entries: [{ program: scoreResult.program, query: 'questionScore' }],
      formImport: { name: 'voteQuestionForm', path: '../../app.js' },
    });
    expect(scoreSource).toContain('entry.id === $input.targetId');
    expect(scoreSource).toContain('target.score = (n(target.score) + n(1));');
    expect(scoreSource).toContain(
      'draft.totalScore = draft.items.reduce((sum, row) => sum + n(row.score), 0);',
    );
    expect(scoreSource).not.toContain('sessionId');
    expect(scoreSource).not.toContain('session:');
    expect(scoreSource).not.toContain('$input.session');
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
          'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
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
          '  async load(_input: {}, db: PgAsyncDatabase<any, any>, context: { request?: { session?: { tenantId?: string } | null } }) {',
          '    const tenantId = currentTenantId(context);',
          '    return {',
          '      items: await db.select({ id: tickets.id, status: tickets.status }).from(tickets).where(and(eq(tickets.tenantId, tenantId), eq(tickets.status, "open"))),',
          '    };',
          '  },',
          '});',
          '',
          'export async function closeTicket(db: PgAsyncDatabase<any, any>, context: { request?: { session?: { tenantId?: string } | null } }, targetId: string) {',
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

  it('keeps private scope out of generated browser-visible leak surfaces', () => {
    const files = [
      pgDatabaseTypes([
        'select(value?: unknown): { from(table: unknown): { where(value: unknown): Promise<unknown[]> } };',
        'update(table: unknown): { set(value: unknown): { where(value: unknown): Promise<void> } };',
      ]),
      {
        fileName: 'ticket.leak-check.ts',
        source: [
          'import { and, eq } from "drizzle-orm";',
          'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
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
          '  async load(_input: {}, db: PgAsyncDatabase<any, any>, context: { request?: { session?: { tenantId?: string } | null } }) {',
          '    const tenantId = currentTenantId(context);',
          '    return {',
          '      items: await db.select({ id: tickets.id, status: tickets.status }).from(tickets).where(and(eq(tickets.tenantId, tenantId), eq(tickets.status, "open"))),',
          '    };',
          '  },',
          '});',
          '',
          'export async function closeTicket(db: PgAsyncDatabase<any, any>, context: { request?: { session?: { tenantId?: string } | null } }, targetId: string) {',
          '  const tenantId = currentTenantId(context);',
          '  await db.update(tickets).set({ status: "closed" }).where(and(eq(tickets.tenantId, tenantId), eq(tickets.id, targetId)));',
          '}',
        ].join('\n'),
      },
    ];

    const queryFact = extractQueryFactsFromProject({ files }).find(
      (candidate) => candidate.query === 'openTickets',
    );
    if (!queryFact) throw new Error('expected openTickets query fact');
    expect(queryFact.instanceKey).toBeUndefined();

    const shape = extractAlgebraicShapesFromProject({ files }).find(
      (candidate) => candidate.query === 'openTickets',
    );
    if (!shape) throw new Error('expected openTickets algebraic shape');

    const effect = extractSymbolicEffectsFromProject({ files }).find(
      (candidate) => candidate.writeKey === 'closeTicket',
    );
    if (!effect) throw new Error('expected closeTicket symbolic effect');

    const result = deriveOptimistic([effect.effect], shape);
    if (result.kind !== 'derived') throw new Error(`expected derived, got ${result.kind}`);

    const loweredBrowserCode = serializeDerivedOptimistic({
      complete: true,
      constName: 'ticketCloseDerivedOptimistic',
      entries: [{ program: result.program, query: 'openTickets' }],
      formImport: { name: 'closeTicketForm', path: '../../app.js' },
    });
    const publicQueryKey = queryFact.query;
    const transformInputs = [...loweredBrowserCode.matchAll(/\$input\.([A-Za-z_$][\w$]*)/g)].map(
      (match) => match[1] ?? '',
    );

    expect(result.program.ops).toEqual([
      {
        guard: 'find-or-noop',
        match: [{ column: 'id', value: { kind: 'param', path: 'targetId' } }],
        op: 'remove-row',
        path: 'items',
      },
    ]);
    expect(transformInputs).toEqual(['targetId']);
    expectNoPrivateScopeLeak({
      'Kovo-Targets': `ticket-panel=${publicQueryKey}`,
      'browser-visible query instance key': publicQueryKey,
      'generated optimistic module exports':
        loweredBrowserCode.match(/export const \w+/)?.[0] ?? loweredBrowserCode,
      'generated transform inputs': transformInputs.join(','),
      'kovo-deps': publicQueryKey,
      'lowered browser code': loweredBrowserCode,
    });
  });

  it('keeps guard-owned private scope out of generated browser-visible leak surfaces', () => {
    const files = [
      pgDatabaseTypes([
        'select(value?: unknown): { from(table: unknown): { where(value: unknown): Promise<unknown[]> } };',
        'update(table: unknown): { set(value: unknown): { where(value: unknown): Promise<void> } };',
      ]),
      {
        fileName: 'guard-owned.leak-check.ts',
        source: [
          'import { and, eq } from "drizzle-orm";',
          'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
          'import { kovoAnalyzerSummary } from "@kovojs/drizzle";',
          '',
          'export const documents = pgTable("documents", {',
          '  guardId: text("guard_id").notNull(),',
          '  id: text("id").notNull(),',
          '  status: text("status").notNull(),',
          '}, kovo({ domain: "document", key: "guardId,id" }));',
          '',
          'function currentGuardId(context: { guard?: { ownerId?: string } | null }) {',
          '  if (!context.guard?.ownerId) throw new Error("owner guard required");',
          '  return context.guard.ownerId;',
          '}',
          'kovoAnalyzerSummary(currentGuardId, { returns: { kind: "guard", path: "owner.id" } });',
          '',
          'export const openDocuments = query("openDocuments", {',
          '  async load(_input: {}, db: PgAsyncDatabase<any, any>, context: { guard?: { ownerId?: string } | null }) {',
          '    const guardId = currentGuardId(context);',
          '    return {',
          '      items: await db.select({ id: documents.id, status: documents.status }).from(documents).where(and(eq(documents.guardId, guardId), eq(documents.status, "open"))),',
          '    };',
          '  },',
          '});',
          '',
          'export async function archiveDocument(db: PgAsyncDatabase<any, any>, context: { guard?: { ownerId?: string } | null }, targetId: string) {',
          '  const guardId = currentGuardId(context);',
          '  await db.update(documents).set({ status: "archived" }).where(and(eq(documents.guardId, guardId), eq(documents.id, targetId)));',
          '}',
        ].join('\n'),
      },
    ];

    const queryFact = extractQueryFactsFromProject({ files }).find(
      (candidate) => candidate.query === 'openDocuments',
    );
    if (!queryFact) throw new Error('expected openDocuments query fact');
    expect(queryFact.instanceKey).toBeUndefined();

    const shape = extractAlgebraicShapesFromProject({ files }).find(
      (candidate) => candidate.query === 'openDocuments',
    );
    if (!shape) throw new Error('expected openDocuments algebraic shape');

    const effect = extractSymbolicEffectsFromProject({ files }).find(
      (candidate) => candidate.writeKey === 'archiveDocument',
    );
    if (!effect) throw new Error('expected archiveDocument symbolic effect');

    const result = deriveOptimistic([effect.effect], shape);
    if (result.kind !== 'derived') throw new Error(`expected derived, got ${result.kind}`);

    const loweredBrowserCode = serializeDerivedOptimistic({
      complete: true,
      constName: 'documentArchiveDerivedOptimistic',
      entries: [{ program: result.program, query: 'openDocuments' }],
      formImport: { name: 'archiveDocumentForm', path: '../../app.js' },
    });
    const publicQueryKey = queryFact.query;
    const transformInputs = [...loweredBrowserCode.matchAll(/\$input\.([A-Za-z_$][\w$]*)/g)].map(
      (match) => match[1] ?? '',
    );

    expect(result.program.ops).toEqual([
      {
        guard: 'find-or-noop',
        match: [{ column: 'id', value: { kind: 'param', path: 'targetId' } }],
        op: 'remove-row',
        path: 'items',
      },
    ]);
    expect(transformInputs).toEqual(['targetId']);
    expectNoPrivateScopeLeak({
      'Kovo-Targets': `document-panel=${publicQueryKey}`,
      'browser-visible query instance key': publicQueryKey,
      'generated optimistic module exports':
        loweredBrowserCode.match(/export const \w+/)?.[0] ?? loweredBrowserCode,
      'generated transform inputs': transformInputs.join(','),
      'kovo-deps': publicQueryKey,
      'lowered browser code': loweredBrowserCode,
    });
  });

  it('carries owner-principal DATA facts through the scoped analyzer and codegen pipeline', () => {
    const files = [
      pgDatabaseTypes([
        'select(value?: unknown): { from(table: unknown): { where(value: unknown): Promise<unknown[]> } };',
        'update(table: unknown): { set(value: unknown): { where(value: unknown): Promise<void> } };',
      ]),
      {
        fileName: 'case-file.owner-pipeline.ts',
        source: [
          'import { and, eq } from "drizzle-orm";',
          'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
          'import { kovoAnalyzerSummary } from "@kovojs/drizzle";',
          '',
          'export const caseFiles = pgTable("case_files", {',
          '  userId: text("user_id").notNull(),',
          '  id: text("id").notNull(),',
          '  title: text("title").notNull(),',
          '  status: text("status").notNull(),',
          '}, kovo({ domain: "case-file", key: "userId,id", owner: "userId" }));',
          '',
          'function currentGuardUser(ctx: { guard?: { userId?: string } | null }) {',
          '  if (!ctx.guard?.userId) throw new Error("owner guard required");',
          '  return ctx.guard.userId;',
          '}',
          'kovoAnalyzerSummary(currentGuardUser, { returns: { kind: "guard", path: "userId" } });',
          '',
          'export const activeCaseFiles = query("activeCaseFiles", {',
          '  async load(_input: {}, db: PgAsyncDatabase<any, any>, ctx: { guard?: { userId?: string } | null }) {',
          '    const userId = currentGuardUser(ctx);',
          '    return {',
          '      items: await db.select({ id: caseFiles.id, title: caseFiles.title, status: caseFiles.status }).from(caseFiles).where(and(eq(caseFiles.userId, userId), eq(caseFiles.status, "active"))),',
          '    };',
          '  },',
          '});',
          '',
          'export async function archiveCaseFile(db: PgAsyncDatabase<any, any>, ctx: { guard?: { userId?: string } | null }, targetId: string) {',
          '  const userId = currentGuardUser(ctx);',
          '  await db.update(caseFiles).set({ status: "archived" }).where(and(eq(caseFiles.userId, userId), eq(caseFiles.id, targetId)));',
          '}',
        ].join('\n'),
      },
    ];

    const ownerAudit = extractOwnerAuditFromProject({ files });
    expect(ownerAudit.ownerDomains).toEqual([{ domain: 'case-file', owner: 'userId' }]);
    expect(
      ownerAudit.scopeAudits
        .map((audit) => ({
          detail: audit.detail,
          domain: audit.domain,
          kind: audit.kind,
          name: audit.name,
          scope: audit.scope,
        }))
        .sort((left, right) => left.name.localeCompare(right.name)),
    ).toEqual([
      {
        detail:
          'narrow Authorization-gates-DATA subset: owner=userId; owner column compared to guard:userId',
        domain: 'case-file',
        kind: 'query',
        name: 'activeCaseFiles',
        scope: 'session',
      },
      {
        detail:
          'narrow Authorization-gates-DATA subset: owner=userId; owner column compared to guard:userId',
        domain: 'case-file',
        kind: 'write',
        name: 'archiveCaseFile',
        scope: 'session',
      },
    ]);

    const graph = extractTouchGraphFromProject({ files });
    expect(graph.archiveCaseFile?.touches).toMatchObject([
      {
        domain: 'case-file',
        keys: 'arg:targetId',
        via: 'case_files',
      },
    ]);
    expect(diagnosticsForTouchGraph(graph)).toEqual([]);

    const queryFact = extractQueryFactsFromProject({ files }).find(
      (candidate) => candidate.query === 'activeCaseFiles',
    );
    expect(queryFact).toMatchObject({
      ownerScopedPrivateReadKeys: [{ domain: 'case-file', privateKey: 'guard:userId' }],
      ownerScopedSessionReads: ['case-file'],
      query: 'activeCaseFiles',
      reads: ['case-file'],
    });
    expect(queryFact?.instanceKey).toBeUndefined();

    const shape = extractAlgebraicShapesFromProject({ files }).find(
      (candidate) => candidate.query === 'activeCaseFiles',
    );
    if (!shape) throw new Error('expected activeCaseFiles algebraic shape');
    expect(shape.fields.items).toMatchObject({
      kind: 'agg',
      projection: ['id', 'title', 'status'],
      rowKey: 'userId,id',
      rowset: {
        filters: [
          { column: 'userId', op: 'eq', value: { kind: 'guard', path: 'userId' } },
          { column: 'status', op: 'eq', value: { kind: 'const', value: 'active' } },
        ],
        key: 'userId,id',
        table: 'case_files',
      },
    });

    const effect = extractSymbolicEffectsFromProject({ files }).find(
      (candidate) => candidate.writeKey === 'archiveCaseFile',
    );
    if (!effect) throw new Error('expected archiveCaseFile symbolic effect');
    expect(effect.effect).toMatchObject({
      match: {
        eq: [
          { column: 'userId', value: { kind: 'guard', path: 'userId' } },
          { column: 'id', value: { kind: 'param', path: 'targetId' } },
        ],
        kind: 'keys',
      },
      op: 'update',
      sets: { status: { kind: 'const', value: 'archived' } },
      table: 'case_files',
    });

    const result = deriveOptimistic([effect.effect], shape);
    if (result.kind !== 'derived') {
      throw new Error(`expected archiveCaseFile derived, got ${result.kind}`);
    }
    expect(result.program.ops).toEqual([
      {
        guard: 'find-or-noop',
        match: [{ column: 'id', value: { kind: 'param', path: 'targetId' } }],
        op: 'remove-row',
        path: 'items',
      },
    ]);

    const loweredBrowserCode = serializeDerivedOptimistic({
      complete: true,
      constName: 'archiveCaseFileDerivedOptimistic',
      entries: [{ program: result.program, query: 'activeCaseFiles' }],
      formImport: { name: 'archiveCaseFileForm', path: '../../app.js' },
    });
    const transformInputs = [...loweredBrowserCode.matchAll(/\$input\.([A-Za-z_$][\w$]*)/g)].map(
      (match) => match[1] ?? '',
    );

    expect(transformInputs).toEqual(['targetId']);
    expect(loweredBrowserCode).toContain('entry.id === $input.targetId');
    expect(loweredBrowserCode).toContain('draft.items.splice(index, 1);');
    expectNoPrivateScopeLeak({
      'browser-visible query instance key': queryFact.query,
      'generated transform inputs': transformInputs.join(','),
      'kovo-deps': queryFact.query,
      'lowered browser code': loweredBrowserCode,
    });
    expectNoBrowserVisibleTokenLeak(
      {
        'generated optimistic module exports':
          loweredBrowserCode.match(/export const \w+/)?.[0] ?? loweredBrowserCode,
        'lowered browser code': loweredBrowserCode,
      },
      ['guardUser', 'guard:userId', 'userId'],
    );
  });

  it('keeps OPP-28 guard-owner proofs through mutations, codegen, and opaque punts', () => {
    const files = [
      pgDatabaseTypes([
        'select(value?: unknown): { from(table: unknown): { where(value: unknown): Promise<unknown[]> } };',
        'update(table: unknown): { set(value: unknown): { where(value: unknown): Promise<void> } };',
      ]),
      {
        fileName: 'guard-case.pipeline.ts',
        source: [
          'import { and, eq } from "drizzle-orm";',
          'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
          'import { kovoAnalyzerSummary } from "@kovojs/drizzle";',
          '',
          'export const cases = pgTable("cases", {',
          '  userId: text("user_id").notNull(),',
          '  id: text("id").notNull(),',
          '  status: text("status").notNull(),',
          '  title: text("title").notNull(),',
          '}, kovo({ domain: "case", key: "userId,id", owner: "userId" }));',
          '',
          'function currentGuardUser(ctx: { guard?: { userId?: string; actorId?: string } | null }) {',
          '  if (!ctx.guard?.userId) throw new Error("owner guard required");',
          '  return ctx.guard.userId;',
          '}',
          'function hiddenGuardUser(ctx: { guard?: { userId?: string } | null }) {',
          '  if (!ctx.guard?.userId) throw new Error("owner guard required");',
          '  return ctx.guard.userId;',
          '}',
          'kovoAnalyzerSummary(currentGuardUser, { returns: { kind: "guard", path: "userId" } });',
          '',
          'export const openCases = query("openCases", {',
          '  async load(_input: {}, db: PgAsyncDatabase<any, any>, ctx: { guard?: { userId?: string; actorId?: string } | null }) {',
          '    const ownerId = currentGuardUser(ctx);',
          '    return {',
          '      items: await db.select({ id: cases.id, title: cases.title, status: cases.status }).from(cases).where(and(eq(cases.userId, ownerId), eq(cases.status, "open"))),',
          '    };',
          '  },',
          '});',
          '',
          'export async function archiveCase(db: PgAsyncDatabase<any, any>, ctx: { guard?: { userId?: string; actorId?: string } | null }, targetId: string) {',
          '  const ownerId = currentGuardUser(ctx);',
          '  await db.update(cases).set({ status: "archived" }).where(and(eq(cases.userId, ownerId), eq(cases.id, targetId)));',
          '}',
          '',
          'export async function closeCase(db: PgAsyncDatabase<any, any>, ctx: { guard?: { userId?: string; actorId?: string } | null }, targetId: string) {',
          '  const ownerId = currentGuardUser(ctx);',
          '  await db.update(cases).set({ status: "closed" }).where(and(eq(cases.userId, ownerId), eq(cases.id, targetId)));',
          '}',
          '',
          'export async function opaqueArchiveCase(db: PgAsyncDatabase<any, any>, ctx: { guard?: { userId?: string } | null }, targetId: string) {',
          '  const ownerId = hiddenGuardUser(ctx);',
          '  await db.update(cases).set({ status: "archived" }).where(and(eq(cases.userId, ownerId), eq(cases.id, targetId)));',
          '}',
        ].join('\n'),
      },
    ];

    const ownerAudit = extractOwnerAuditFromProject({ files });
    expect(ownerAudit.ownerDomains).toEqual([{ domain: 'case', owner: 'userId' }]);
    expect(
      ownerAudit.scopeAudits
        .map((audit) => ({
          detail: audit.detail,
          domain: audit.domain,
          kind: audit.kind,
          name: audit.name,
          scope: audit.scope,
        }))
        .sort((left, right) => left.name.localeCompare(right.name)),
    ).toEqual([
      {
        detail:
          'narrow Authorization-gates-DATA subset: owner=userId; owner column compared to guard:userId',
        domain: 'case',
        kind: 'write',
        name: 'archiveCase',
        scope: 'session',
      },
      {
        detail:
          'narrow Authorization-gates-DATA subset: owner=userId; owner column compared to guard:userId',
        domain: 'case',
        kind: 'write',
        name: 'closeCase',
        scope: 'session',
      },
      {
        detail:
          'narrow Authorization-gates-DATA subset: owner=userId; no owner-column session/principal predicate was proven',
        domain: 'case',
        kind: 'write',
        name: 'opaqueArchiveCase',
        scope: 'unknown',
      },
      {
        detail:
          'narrow Authorization-gates-DATA subset: owner=userId; owner column compared to guard:userId',
        domain: 'case',
        kind: 'query',
        name: 'openCases',
        scope: 'session',
      },
    ]);

    const queryFact = extractQueryFactsFromProject({ files }).find(
      (candidate) => candidate.query === 'openCases',
    );
    expect(queryFact).toMatchObject({
      ownerScopedPrivateReadKeys: [{ domain: 'case', privateKey: 'guard:userId' }],
      ownerScopedSessionReads: ['case'],
      query: 'openCases',
      reads: ['case'],
    });
    expect(queryFact?.instanceKey).toBeUndefined();

    const graph = extractTouchGraphFromProject({ files });
    expect(graph.archiveCase?.touches).toMatchObject([
      {
        domain: 'case',
        keys: 'arg:targetId',
        via: 'cases',
      },
    ]);
    expect(graph.closeCase?.touches).toMatchObject([
      {
        domain: 'case',
        keys: 'arg:targetId',
        via: 'cases',
      },
    ]);
    expect(graph.opaqueArchiveCase?.touches).toMatchObject([
      {
        domain: 'case',
        keys: null,
        predicate: 'non-eq',
        via: 'cases',
      },
    ]);
    expect(diagnosticsForTouchGraph(graph)).toMatchObject([
      {
        code: 'KV409',
        severity: 'notice',
      },
    ]);

    const shape = extractAlgebraicShapesFromProject({ files }).find(
      (candidate) => candidate.query === 'openCases',
    );
    if (!shape) throw new Error('expected openCases algebraic shape');
    expect(shape.fields.items).toMatchObject({
      kind: 'agg',
      projection: ['id', 'title', 'status'],
      rowKey: 'userId,id',
      rowset: {
        filters: [
          { column: 'userId', op: 'eq', value: { kind: 'guard', path: 'userId' } },
          { column: 'status', op: 'eq', value: { kind: 'const', value: 'open' } },
        ],
        key: 'userId,id',
        table: 'cases',
      },
    });

    const effects = extractSymbolicEffectsFromProject({ files });
    const archiveEffect = effects.find((candidate) => candidate.writeKey === 'archiveCase');
    if (!archiveEffect) throw new Error('expected archiveCase symbolic effect');
    expect(archiveEffect.effect).toMatchObject({
      match: {
        eq: [
          { column: 'userId', value: { kind: 'guard', path: 'userId' } },
          { column: 'id', value: { kind: 'param', path: 'targetId' } },
        ],
        kind: 'keys',
      },
      op: 'update',
      sets: { status: { kind: 'const', value: 'archived' } },
      table: 'cases',
    });

    const archiveResult = deriveOptimistic([archiveEffect.effect], shape);
    if (archiveResult.kind !== 'derived') {
      throw new Error(`expected archiveCase derived, got ${archiveResult.kind}`);
    }
    expect(archiveResult.program.ops).toEqual([
      {
        guard: 'find-or-noop',
        match: [{ column: 'id', value: { kind: 'param', path: 'targetId' } }],
        op: 'remove-row',
        path: 'items',
      },
    ]);

    const closeEffect = effects.find((candidate) => candidate.writeKey === 'closeCase');
    if (!closeEffect) throw new Error('expected closeCase symbolic effect');
    expect(closeEffect.effect).toMatchObject({
      match: {
        eq: [
          { column: 'userId', value: { kind: 'guard', path: 'userId' } },
          { column: 'id', value: { kind: 'param', path: 'targetId' } },
        ],
        kind: 'keys',
      },
      op: 'update',
      sets: { status: { kind: 'const', value: 'closed' } },
      table: 'cases',
    });
    const closeResult = deriveOptimistic([closeEffect.effect], shape);
    if (closeResult.kind !== 'derived') {
      throw new Error(`expected closeCase derived, got ${closeResult.kind}`);
    }
    expect(closeResult.program.ops).toEqual([
      {
        guard: 'find-or-noop',
        match: [{ column: 'id', value: { kind: 'param', path: 'targetId' } }],
        op: 'remove-row',
        path: 'items',
      },
    ]);

    const opaqueEffect = effects.find((candidate) => candidate.writeKey === 'opaqueArchiveCase');
    if (!opaqueEffect) throw new Error('expected opaqueArchiveCase symbolic effect');
    expect(opaqueEffect.effect).toMatchObject({
      match: { expr: 'unsummarized-helper:hiddenGuardUser', kind: 'opaque' },
      op: 'update',
      sets: { status: { kind: 'const', value: 'archived' } },
      table: 'cases',
    });
    expect(deriveOptimistic([opaqueEffect.effect], shape)).toEqual({
      kind: 'punt',
      reason: { code: 'non-key-match', expr: 'unsummarized-helper:hiddenGuardUser' },
    });

    const loweredBrowserCode = serializeDerivedOptimistic({
      complete: true,
      constName: 'archiveCaseDerivedOptimistic',
      entries: [{ program: archiveResult.program, query: 'openCases' }],
      formImport: { name: 'archiveCaseForm', path: '../../app.js' },
    });
    const transformInputs = [...loweredBrowserCode.matchAll(/\$input\.([A-Za-z_$][\w$]*)/g)].map(
      (match) => match[1] ?? '',
    );

    expect(transformInputs).toEqual(['targetId']);
    expect(loweredBrowserCode).toContain('entry.id === $input.targetId');
    expect(loweredBrowserCode).toContain('draft.items.splice(index, 1);');
    expectNoPrivateScopeLeak({
      'browser-visible query instance key': queryFact.query,
      'generated transform inputs': transformInputs.join(','),
      'kovo-deps': queryFact.query,
      'lowered browser code': loweredBrowserCode,
    });
    expectNoBrowserVisibleTokenLeak(
      {
        'generated optimistic module exports':
          loweredBrowserCode.match(/export const \w+/)?.[0] ?? loweredBrowserCode,
        'lowered browser code': loweredBrowserCode,
      },
      ['currentGuardUser', 'guard:userId', 'userId'],
    );
  });

  it('derives composite natural-key cart updates with same-scope aggregate witnesses', () => {
    const files = [
      pgDatabaseTypes([
        'delete(table: unknown): { where(value: unknown): Promise<void> };',
        'select(value?: unknown): { from(table: unknown): { where(value: unknown): Promise<unknown[]> } };',
        'update(table: unknown): { set(value: unknown): { where(value: unknown): Promise<void> } };',
      ]),
      {
        fileName: 'cart.pipeline.ts',
        source: [
          'import { and, count, eq, sum } from "drizzle-orm";',
          'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
          'import { kovoAnalyzerSummary } from "@kovojs/drizzle";',
          '',
          'export const cartItems = pgTable("cart_items", {',
          '  cartId: text("cart_id").notNull(),',
          '  productId: text("product_id").notNull(),',
          '  quantity: integer("quantity").notNull(),',
          '}, kovo({ domain: "cart-item", key: "cartId,productId" }));',
          '',
          'function currentCartId(context: { request?: { session?: { cartId?: string } | null } }) {',
          '  if (!context.request?.session?.cartId) throw new Error("cart required");',
          '  return context.request.session.cartId;',
          '}',
          'kovoAnalyzerSummary(currentCartId, { returns: { kind: "session", path: "cartId" } });',
          '',
          'export const cartSummary = query("cartSummary", {',
          '  async load(_input: {}, db: PgAsyncDatabase<any, any>, context: { request?: { session?: { cartId?: string } | null } }) {',
          '    const cartId = currentCartId(context);',
          '    const items = await db.select({ productId: cartItems.productId, quantity: cartItems.quantity }).from(cartItems).where(eq(cartItems.cartId, cartId));',
          '    const totalRows = await db.select({ value: sum(cartItems.quantity) }).from(cartItems).where(eq(cartItems.cartId, cartId));',
          '    const countRows = await db.select({ value: count() }).from(cartItems).where(eq(cartItems.cartId, cartId));',
          '    return {',
          '      items: items,',
          '      itemCount: Number(countRows[0]?.value ?? 0),',
          '      totalQuantity: Number(totalRows[0]?.value ?? 0),',
          '    };',
          '  },',
          '});',
          '',
          'export async function updateQuantity(db: PgAsyncDatabase<any, any>, context: { request?: { session?: { cartId?: string } | null } }, productId: string, nextQuantity: number) {',
          '  const cartId = currentCartId(context);',
          '  await db.update(cartItems).set({ quantity: nextQuantity }).where(and(eq(cartItems.cartId, cartId), eq(cartItems.productId, productId)));',
          '}',
          '',
          'export async function removeLine(db: PgAsyncDatabase<any, any>, context: { request?: { session?: { cartId?: string } | null } }, productId: string) {',
          '  const cartId = currentCartId(context);',
          '  await db.delete(cartItems).where(and(eq(cartItems.cartId, cartId), eq(cartItems.productId, productId)));',
          '}',
        ].join('\n'),
      },
    ];

    const graph = extractTouchGraphFromProject({ files });
    expect(graph.updateQuantity?.touches).toMatchObject([
      {
        domain: 'cart-item',
        keys: 'arg:productId',
        via: 'cart_items',
      },
    ]);
    expect(graph.removeLine?.touches).toMatchObject([
      {
        domain: 'cart-item',
        keys: 'arg:productId',
        via: 'cart_items',
      },
    ]);
    expect(diagnosticsForTouchGraph(graph)).toEqual([]);

    const queryFact = extractQueryFactsFromProject({ files }).find(
      (candidate) => candidate.query === 'cartSummary',
    );
    expect(queryFact).toMatchObject({
      query: 'cartSummary',
      reads: ['cart-item'],
    });
    expect(queryFact?.instanceKey).toBeUndefined();

    const shape = extractAlgebraicShapesFromProject({ files }).find(
      (candidate) => candidate.query === 'cartSummary',
    );
    if (!shape) throw new Error('expected cartSummary algebraic shape');
    const scopedCartRowset = {
      filters: [{ column: 'cartId', op: 'eq', value: { kind: 'session', path: 'cartId' } }],
      key: 'cartId,productId',
      orderBy: [],
      table: 'cart_items',
    };
    expect(shape.fields.items).toMatchObject({
      kind: 'agg',
      projection: ['productId', 'quantity'],
      rowKey: 'cartId,productId',
      rowset: scopedCartRowset,
    });
    expect(shape.fields.itemCount).toMatchObject({
      kind: 'count',
      rowset: scopedCartRowset,
    });
    expect(shape.fields.totalQuantity).toMatchObject({
      arith: { column: 'quantity', kind: 'col' },
      kind: 'sum',
      rowset: scopedCartRowset,
    });
    expect(shape.rowsByTable?.cart_items).toMatchObject({
      columns: ['productId', 'quantity'],
      rowsPath: 'items',
      rowset: scopedCartRowset,
    });

    const effects = extractSymbolicEffectsFromProject({ files });
    const updateEffect = effects.find((candidate) => candidate.writeKey === 'updateQuantity');
    if (!updateEffect) throw new Error('expected updateQuantity symbolic effect');
    expect(updateEffect.effect).toMatchObject({
      match: {
        eq: [
          { column: 'cartId', value: { kind: 'session', path: 'cartId' } },
          { column: 'productId', value: { kind: 'param', path: 'productId' } },
        ],
        kind: 'keys',
      },
      op: 'update',
      sets: { quantity: { kind: 'param', path: 'nextQuantity' } },
      table: 'cart_items',
    });

    const updateResult = deriveOptimistic([updateEffect.effect], shape);
    if (updateResult.kind !== 'derived') {
      throw new Error(`expected updateQuantity derived, got ${updateResult.kind}`);
    }
    expect(updateResult.program.ops).toEqual([
      {
        guard: 'find-or-noop',
        match: [{ column: 'productId', value: { kind: 'param', path: 'productId' } }],
        op: 'update-row',
        path: 'items',
        sets: { quantity: { kind: 'param', path: 'nextQuantity' } },
      },
      { column: 'quantity', from: 'items', op: 'resum', path: 'totalQuantity' },
    ]);

    const removeEffect = effects.find((candidate) => candidate.writeKey === 'removeLine');
    if (!removeEffect) throw new Error('expected removeLine symbolic effect');
    expect(removeEffect.effect).toMatchObject({
      match: {
        eq: [
          { column: 'cartId', value: { kind: 'session', path: 'cartId' } },
          { column: 'productId', value: { kind: 'param', path: 'productId' } },
        ],
        kind: 'keys',
      },
      op: 'delete',
      table: 'cart_items',
    });

    const removeResult = deriveOptimistic([removeEffect.effect], shape);
    if (removeResult.kind !== 'derived') {
      throw new Error(`expected removeLine derived, got ${removeResult.kind}`);
    }
    expect(removeResult.program.ops).toEqual([
      {
        guard: 'find-or-noop',
        match: [{ column: 'productId', value: { kind: 'param', path: 'productId' } }],
        op: 'remove-row',
        path: 'items',
      },
      { from: 'items', op: 'recount', path: 'itemCount' },
      { column: 'quantity', from: 'items', op: 'resum', path: 'totalQuantity' },
    ]);

    const updateSource = serializeDerivedOptimistic({
      complete: true,
      constName: 'quantityUpdateDerivedOptimistic',
      entries: [{ program: updateResult.program, query: 'cartSummary' }],
      formImport: { name: 'updateQuantityForm', path: '../../app.js' },
    });
    expect(updateSource).toContain('entry.productId === $input.productId');
    expect(updateSource).toContain('target.quantity = $input.nextQuantity;');
    expect(updateSource).toContain(
      'draft.totalQuantity = draft.items.reduce((sum, row) => sum + n(row.quantity), 0);',
    );
    expect(updateSource).not.toContain('cartId');
    expect(updateSource).not.toContain('session:');
    expect(updateSource).not.toContain('$input.session');

    const removeSource = serializeDerivedOptimistic({
      complete: true,
      constName: 'lineRemoveDerivedOptimistic',
      entries: [{ program: removeResult.program, query: 'cartSummary' }],
      formImport: { name: 'removeLineForm', path: '../../app.js' },
    });
    expect(removeSource).toContain('entry.productId === $input.productId');
    expect(removeSource).toContain('draft.itemCount = draft.items.length;');
    expect(removeSource).toContain(
      'draft.totalQuantity = draft.items.reduce((sum, row) => sum + n(row.quantity), 0);',
    );
    expect(removeSource).not.toContain('cartId');
    expect(removeSource).not.toContain('session:');
    expect(removeSource).not.toContain('$input.session');
  });

  it('punts filtered-list membership entries and derives exits from extracted facts', () => {
    const files = [
      pgDatabaseTypes([
        'select(value?: unknown): { from(table: unknown): { where(value: unknown): Promise<unknown[]> } };',
        'update(table: unknown): { set(value: unknown): { where(value: unknown): Promise<void> } };',
      ]),
      {
        fileName: 'task.pipeline.ts',
        source: [
          'import { eq } from "drizzle-orm";',
          'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
          '',
          'export const tasks = pgTable("tasks", {',
          '  id: text("id").notNull(),',
          '  title: text("title").notNull(),',
          '  status: text("status").notNull(),',
          '}, kovo({ domain: "task", key: "id" }));',
          '',
          'export const openTasks = query("openTasks", {',
          '  async load(_input: {}, db: PgAsyncDatabase<any, any>) {',
          '    return {',
          '      items: await db.select({ id: tasks.id, title: tasks.title, status: tasks.status }).from(tasks).where(eq(tasks.status, "open")),',
          '    };',
          '  },',
          '});',
          '',
          'export async function closeTask(db: PgAsyncDatabase<any, any>, id: string) {',
          '  await db.update(tasks).set({ status: "closed" }).where(eq(tasks.id, id));',
          '}',
          '',
          'export async function reopenTask(db: PgAsyncDatabase<any, any>, id: string) {',
          '  await db.update(tasks).set({ status: "open" }).where(eq(tasks.id, id));',
          '}',
        ].join('\n'),
      },
    ];

    const graph = extractTouchGraphFromProject({ files });
    expect(graph.closeTask?.touches).toMatchObject([
      {
        domain: 'task',
        keys: 'arg:id',
        via: 'tasks',
      },
    ]);
    expect(graph.reopenTask?.touches).toMatchObject([
      {
        domain: 'task',
        keys: 'arg:id',
        via: 'tasks',
      },
    ]);
    expect(diagnosticsForTouchGraph(graph)).toEqual([]);

    const shape = extractAlgebraicShapesFromProject({ files }).find(
      (candidate) => candidate.query === 'openTasks',
    );
    if (!shape) throw new Error('expected openTasks algebraic shape');
    expect(shape.fields.items).toMatchObject({
      kind: 'agg',
      projection: ['id', 'title', 'status'],
      rowKey: 'id',
      rowset: {
        filters: [{ column: 'status', op: 'eq', value: { kind: 'const', value: 'open' } }],
        key: 'id',
        table: 'tasks',
      },
    });

    const effects = extractSymbolicEffectsFromProject({ files });
    const closeEffect = effects.find((candidate) => candidate.writeKey === 'closeTask');
    if (!closeEffect) throw new Error('expected closeTask symbolic effect');
    expect(closeEffect.effect).toMatchObject({
      match: { eq: [{ column: 'id', value: { kind: 'param', path: 'id' } }], kind: 'keys' },
      op: 'update',
      sets: { status: { kind: 'const', value: 'closed' } },
      table: 'tasks',
    });

    const closeResult = deriveOptimistic([closeEffect.effect], shape);
    if (closeResult.kind !== 'derived') {
      throw new Error(`expected closeTask derived, got ${closeResult.kind}`);
    }
    expect(closeResult.program.ops).toEqual([
      {
        guard: 'find-or-noop',
        match: [{ column: 'id', value: { kind: 'param', path: 'id' } }],
        op: 'remove-row',
        path: 'items',
      },
    ]);

    const reopenEffect = effects.find((candidate) => candidate.writeKey === 'reopenTask');
    if (!reopenEffect) throw new Error('expected reopenTask symbolic effect');
    expect(reopenEffect.effect).toMatchObject({
      match: { eq: [{ column: 'id', value: { kind: 'param', path: 'id' } }], kind: 'keys' },
      op: 'update',
      sets: { status: { kind: 'const', value: 'open' } },
      table: 'tasks',
    });
    expect(deriveOptimistic([reopenEffect.effect], shape)).toEqual({
      kind: 'punt',
      reason: { code: 'membership-entry', field: 'status' },
    });

    const exitSource = serializeDerivedOptimistic({
      complete: true,
      constName: 'closeTaskDerivedOptimistic',
      entries: [{ program: closeResult.program, query: 'openTasks' }],
      formImport: { name: 'closeTaskForm', path: '../../app.js' },
    });
    expect(exitSource).toContain('entry.id === $input.id');
    expect(exitSource).toContain('draft.items.splice(index, 1);');

    const entryFallbackSource = serializeDerivedOptimistic({
      awaitFragments: ['openTasks'],
      complete: false,
      constName: 'reopenTaskDerivedOptimistic',
      entries: [],
      formImport: { name: 'reopenTaskForm', path: '../../app.js' },
    });
    expect(entryFallbackSource).toContain("openTasks: 'await-fragment'");
  });

  it('requires typed helper summaries for private-scope provenance', () => {
    const files = [
      pgDatabaseTypes([
        'select(value?: unknown): { from(table: unknown): { where(value: unknown): Promise<unknown[]> } };',
        'update(table: unknown): { set(value: unknown): { where(value: unknown): Promise<void> } };',
      ]),
      {
        fileName: 'invoice.pipeline.ts',
        source: [
          'import { and, eq } from "drizzle-orm";',
          'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
          'import { kovoAnalyzerSummary } from "@kovojs/drizzle";',
          '',
          'export const invoices = pgTable("invoices", {',
          '  sessionId: text("session_id").notNull(),',
          '  id: text("id").notNull(),',
          '  status: text("status").notNull(),',
          '}, kovo({ domain: "invoice", key: "sessionId,id" }));',
          '',
          'function requireSessionId(context: { request?: { session?: { id?: string } | null } }) {',
          '  if (!context.request?.session?.id) throw new Error("auth required");',
          '  return context.request.session.id;',
          '}',
          'kovoAnalyzerSummary(requireSessionId, { returns: { kind: "session", path: "id" } });',
          '',
          'function hiddenSessionId(context: { request?: { session?: { id?: string } | null } }) {',
          '  if (!context.request?.session?.id) throw new Error("auth required");',
          '  return context.request.session.id;',
          '}',
          '',
          'export const invoiceList = query("invoiceList", {',
          '  async load(_input: {}, db: PgAsyncDatabase<any, any>, context: { request?: { session?: { id?: string } | null } }) {',
          '    const sessionId = requireSessionId(context);',
          '    return {',
          '      items: await db.select({ id: invoices.id, status: invoices.status }).from(invoices).where(eq(invoices.sessionId, sessionId)),',
          '    };',
          '  },',
          '});',
          '',
          'export async function markPaid(db: PgAsyncDatabase<any, any>, context: { request?: { session?: { id?: string } | null } }, targetId: string) {',
          '  const sessionId = requireSessionId(context);',
          '  await db.update(invoices).set({ status: "paid" }).where(and(eq(invoices.sessionId, sessionId), eq(invoices.id, targetId)));',
          '}',
          '',
          'export async function unsafeMarkPaid(db: PgAsyncDatabase<any, any>, context: { request?: { session?: { id?: string } | null } }, targetId: string) {',
          '  const sessionId = hiddenSessionId(context);',
          '  await db.update(invoices).set({ status: "paid" }).where(and(eq(invoices.sessionId, sessionId), eq(invoices.id, targetId)));',
          '}',
        ].join('\n'),
      },
    ];

    const graph = extractTouchGraphFromProject({ files });
    expect(graph.markPaid?.touches).toMatchObject([
      {
        domain: 'invoice',
        keys: 'arg:targetId',
        via: 'invoices',
      },
    ]);
    expect(graph.unsafeMarkPaid?.touches).toMatchObject([
      {
        domain: 'invoice',
        keys: null,
        predicate: 'non-eq',
        via: 'invoices',
      },
    ]);
    expect(diagnosticsForTouchGraph(graph)).toMatchObject([
      {
        code: 'KV409',
        severity: 'notice',
      },
    ]);

    const queryFact = extractQueryFactsFromProject({ files }).find(
      (candidate) => candidate.query === 'invoiceList',
    );
    expect(queryFact).toMatchObject({
      query: 'invoiceList',
      reads: ['invoice'],
      sessionAnchoredReads: ['invoice'],
    });
    expect(queryFact?.instanceKey).toBeUndefined();

    const shape = extractAlgebraicShapesFromProject({ files }).find(
      (candidate) => candidate.query === 'invoiceList',
    );
    if (!shape) throw new Error('expected invoiceList algebraic shape');
    expect(shape.fields.items).toMatchObject({
      kind: 'agg',
      projection: ['id', 'status'],
      rowKey: 'sessionId,id',
      rowset: {
        filters: [{ column: 'sessionId', op: 'eq', value: { kind: 'session', path: 'id' } }],
        key: 'sessionId,id',
        table: 'invoices',
      },
    });

    const effects = extractSymbolicEffectsFromProject({ files });
    const summarizedEffect = effects.find((candidate) => candidate.writeKey === 'markPaid');
    if (!summarizedEffect) throw new Error('expected markPaid symbolic effect');
    expect(summarizedEffect.effect).toMatchObject({
      match: {
        eq: [
          { column: 'sessionId', value: { kind: 'session', path: 'id' } },
          { column: 'id', value: { kind: 'param', path: 'targetId' } },
        ],
        kind: 'keys',
      },
      op: 'update',
      sets: { status: { kind: 'const', value: 'paid' } },
      table: 'invoices',
    });

    const summarizedResult = deriveOptimistic([summarizedEffect.effect], shape);
    if (summarizedResult.kind !== 'derived') {
      throw new Error(`expected markPaid derived, got ${summarizedResult.kind}`);
    }
    expect(summarizedResult.program.ops).toEqual([
      {
        guard: 'find-or-noop',
        match: [{ column: 'id', value: { kind: 'param', path: 'targetId' } }],
        op: 'update-row',
        path: 'items',
        sets: { status: { kind: 'const', value: 'paid' } },
      },
    ]);

    const unsummarizedEffect = effects.find((candidate) => candidate.writeKey === 'unsafeMarkPaid');
    if (!unsummarizedEffect) throw new Error('expected unsafeMarkPaid symbolic effect');
    expect(unsummarizedEffect.effect).toMatchObject({
      match: { expr: 'unsummarized-helper:hiddenSessionId', kind: 'opaque' },
      op: 'update',
      sets: { status: { kind: 'const', value: 'paid' } },
      table: 'invoices',
    });
    expect(deriveOptimistic([unsummarizedEffect.effect], shape)).toEqual({
      kind: 'punt',
      reason: { code: 'non-key-match', expr: 'unsummarized-helper:hiddenSessionId' },
    });

    const source = serializeDerivedOptimistic({
      complete: true,
      constName: 'invoiceMarkPaidDerivedOptimistic',
      entries: [{ program: summarizedResult.program, query: 'invoiceList' }],
      formImport: { name: 'markPaidForm', path: '../../app.js' },
    });
    expect(source).toContain('entry.id === $input.targetId');
    expect(source).toContain('target.status = "paid";');
    expect(source).not.toContain('sessionId');
    expect(source).not.toContain('session:');
    expect(source).not.toContain('$input.session');
  });
});

function expectNoPrivateScopeLeak(surfaces: Record<string, string>): void {
  const forbidden = [
    '$input.guard',
    '$input.session',
    '$input.tenant',
    'guard:',
    'guardId',
    'session:',
    'sessionId',
    'tenant:',
    'tenantId',
  ];

  for (const [surface, value] of Object.entries(surfaces)) {
    for (const token of forbidden) {
      if (value.includes(token)) {
        throw new Error(`${surface} leaked private scope token ${JSON.stringify(token)}: ${value}`);
      }
    }
  }
}

function expectNoBrowserVisibleTokenLeak(
  surfaces: Record<string, string>,
  forbidden: readonly string[],
): void {
  for (const [surface, value] of Object.entries(surfaces)) {
    for (const token of forbidden) {
      if (value.includes(token)) {
        throw new Error(
          `${surface} leaked browser-visible token ${JSON.stringify(token)}: ${value}`,
        );
      }
    }
  }
}
