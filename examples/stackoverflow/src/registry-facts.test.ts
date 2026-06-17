import { deriveOptimistic } from '@kovojs/drizzle/derive';
import type { AlgebraicQueryShape, SymbolicEffect } from '@kovojs/core/internal/derivation';
import {
  extractAlgebraicShapesFromProject,
  extractSymbolicEffectsFromProject,
  extractTouchGraphFromProject,
} from '@kovojs/drizzle/static';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// SPEC.md §10.5 Stage 1+2: the §10.5 extractors classify the Stack Overflow
// source into the shared IR the deriver consumes. All assertions are
// formatting-resistant — algebraic class / effect op+table / derivation status —
// never source-string snapshots.

const srcDir = dirname(fileURLToPath(import.meta.url));
const sourceFileNames = [
  'schema.ts',
  'db.ts',
  'domains.ts',
  'runtime.ts',
  'queries.ts',
  'mutations.ts',
];

// ts-morph keeps an in-process file cache; under vitest, two extractor calls that
// reuse the same virtual paths can collide. Namespace each extraction's virtual
// directory so every call sees fresh paths (relative imports still resolve within
// the shared prefix).
let projectCounter = 0;
function projectFiles() {
  const prefix = `examples/stackoverflow/v${projectCounter++}/src`;
  return sourceFileNames.map((name) => ({
    fileName: `${prefix}/${name}`,
    source: readFileSync(resolve(srcDir, name), 'utf8'),
  }));
}

const shapes = extractAlgebraicShapesFromProject({ files: projectFiles() });
const shapeByQuery = new Map<string, AlgebraicQueryShape>(shapes.map((s) => [s.query, s]));
const effectFacts = extractSymbolicEffectsFromProject({ files: projectFiles() });
const effectsByMutation = new Map<string, SymbolicEffect[]>();
for (const fact of effectFacts) {
  if (!fact.writeKey) continue;
  const list = effectsByMutation.get(fact.writeKey) ?? [];
  list.push(fact.effect);
  effectsByMutation.set(fact.writeKey, list);
}

function fieldKinds(query: string): Record<string, string> {
  const shape = shapeByQuery.get(query);
  if (!shape) return {};
  return Object.fromEntries(
    Object.entries(shape.fields).map(([path, field]) => [path, field.kind]),
  );
}

describe('stackoverflow §10.5 Stage 2 — query → AlgebraicQueryShape', () => {
  it('classifies questionList as AGG over the questions rowset', () => {
    expect(fieldKinds('questionList')).toEqual({ items: 'agg' });
    const items = shapeByQuery.get('questionList')?.fields.items;
    expect(items?.kind === 'agg' && items.rowset.table).toBe('questions');
    expect(items?.kind === 'agg' && items.projection).toEqual([
      'authorId',
      'authorName',
      'body',
      'createdAt',
      'id',
      'tags',
      'title',
      'score',
      'answerCount',
    ]);
    expect(items?.kind === 'agg' && items.rowKey).toBe('id');
  });

  it('classifies answerList as AGG over the answers rowset', () => {
    expect(fieldKinds('answerList')).toEqual({ items: 'agg' });
    const items = shapeByQuery.get('answerList')?.fields.items;
    expect(items?.kind === 'agg' && items.rowset.table).toBe('answers');
  });

  it('classifies questionScore as a SUM scalar over the votes value column', () => {
    expect(fieldKinds('questionScore')).toEqual({ score: 'sum' });
    const score = shapeByQuery.get('questionScore')?.fields.score;
    expect(score?.kind === 'sum' && score.rowset.table).toBe('votes');
    expect(score?.kind === 'sum' && score.arith).toEqual({ column: 'value', kind: 'col' });
  });
});

describe('stackoverflow §10.5 Stage 1 — write → SymbolicEffect', () => {
  it('extracts postQuestion as a single INSERT into questions', () => {
    const effects = effectsByMutation.get('postQuestion') ?? [];
    expect(effects.map((e) => ({ op: e.op, table: e.table }))).toEqual([
      { op: 'insert', table: 'questions' },
    ]);
  });

  it('extracts postAnswer as INSERT answers + UPDATE questions (keyed, arith SET)', () => {
    const effects = effectsByMutation.get('postAnswer') ?? [];
    expect(effects.map((e) => ({ op: e.op, table: e.table }))).toEqual([
      { op: 'insert', table: 'answers' },
      { op: 'update', table: 'questions' },
    ]);
    const update = effects.find((e) => e.op === 'update');
    // sql`${questions.answerCount} + ${1}` extracts as self-referential arith.
    expect(update?.op === 'update' && update.sets.answerCount).toEqual({
      kind: 'arith',
      left: { column: 'answerCount', kind: 'col' },
      op: '+',
      right: { kind: 'const', value: 1 },
    });
    expect(update?.op === 'update' && update.match).toEqual({
      eq: [{ column: 'id', value: { kind: 'param', path: 'questionId' } }],
      kind: 'keys',
    });
  });

  it('extracts voteUp as INSERT votes + UPDATE questions (keyed, arith SET)', () => {
    const effects = effectsByMutation.get('voteUp') ?? [];
    expect(effects.map((e) => ({ op: e.op, table: e.table }))).toEqual([
      { op: 'insert', table: 'votes' },
      { op: 'update', table: 'questions' },
    ]);
    const update = effects.find((e) => e.op === 'update');
    expect(update?.op === 'update' && update.sets.score).toEqual({
      kind: 'arith',
      left: { column: 'score', kind: 'col' },
      op: '+',
      right: { kind: 'const', value: 1 },
    });
  });
});

describe('stackoverflow §10.5 Stage 1 — touch graph', () => {
  it('extracts clean (KV406-free) touch entries for every mutation handler', () => {
    const graph = extractTouchGraphFromProject({ files: projectFiles() });
    for (const key of ['postQuestion', 'postAnswer', 'voteUp']) {
      const entry = graph[key];
      expect(entry, `touch entry for ${key}`).toBeDefined();
      expect(entry?.unresolved).toEqual([]);
      expect((entry?.touches.length ?? 0) > 0).toBe(true);
    }
    const domains = (key: string) =>
      (graph[key]?.touches.map((t) => t.domain) ?? []).slice().sort();
    expect(domains('postQuestion')).toEqual(['question']);
    expect(domains('postAnswer')).toEqual(['answer', 'question']);
    expect(domains('voteUp')).toEqual(['question', 'vote']);
  });
});

describe('stackoverflow §10.5 Stage 3 — every invalidated pair derives (zero punts)', () => {
  const invalidates: Record<string, string[]> = {
    postQuestion: ['questionList'],
    postAnswer: ['questionList', 'answerList'],
    voteUp: ['questionList', 'questionScore'],
  };

  for (const [mutation, queries] of Object.entries(invalidates)) {
    for (const query of queries) {
      it(`${mutation} × ${query} derives a patch program`, () => {
        const effects = effectsByMutation.get(mutation);
        const shape = shapeByQuery.get(query);
        expect(effects).toBeDefined();
        expect(shape).toBeDefined();
        if (!effects || !shape) return;
        const result = deriveOptimistic(effects, shape);
        expect(result.kind).toBe('derived');
        if (result.kind === 'derived') {
          expect(result.program.query).toBe(query);
          expect(result.program.ops.length).toBeGreaterThan(0);
        }
      });
    }
  }
});
