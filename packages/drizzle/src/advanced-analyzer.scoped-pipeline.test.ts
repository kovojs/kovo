import { describe, expect, it } from 'vitest';

import {
  diagnosticsForTouchGraph,
  extractAlgebraicShapesFromProject,
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
});
