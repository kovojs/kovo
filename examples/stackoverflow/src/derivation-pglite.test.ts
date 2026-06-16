import { applyPatchProgram, type JsonValue } from '@kovojs/core';
import { deriveOptimistic } from '@kovojs/drizzle/derive';
import {
  extractAlgebraicShapesFromProject,
  extractSymbolicEffectsFromProject,
  type AlgebraicQueryShape,
  type SymbolicEffect,
} from '@kovojs/drizzle/static';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

import { createSoDb, type SoDb } from './db.js';
import { answerList, questionList, questionScore } from './queries.js';
import { postAnswer, postQuestion, voteUp } from './mutations.js';

// SPEC.md §10.5 / §11.4: soundness is the commuting diagram
//   patch(clientShape(s), i) ≡ clientShape(apply(effect, s, i))
// proven here against REAL Postgres semantics via the in-process pglite harness.
// Every (mutation × invalidated-query) pair: run the query BEFORE, run the real
// Drizzle handler, run the query AFTER (= truth), then assert the DERIVED patch
// program agrees (modulo placeholder columns). The effects/shapes are EXTRACTED
// from src — the same IR `kovo check`/the generated transforms use.

const srcDir = dirname(fileURLToPath(import.meta.url));
const sourceFileNames = [
  'schema.ts',
  'db.ts',
  'domains.ts',
  'runtime.ts',
  'queries.ts',
  'mutations.ts',
];
// Namespace each extraction's virtual directory (ts-morph keeps an in-process
// file cache that can collide across calls under vitest).
let projectCounter = 0;
function projectFiles() {
  const prefix = `examples/stackoverflow/v${projectCounter++}/src`;
  return sourceFileNames.map((name) => ({
    fileName: `${prefix}/${name}`,
    source: readFileSync(resolve(srcDir, name), 'utf8'),
  }));
}

const shapeByQuery = new Map<string, AlgebraicQueryShape>(
  extractAlgebraicShapesFromProject({ files: projectFiles() }).map((shape) => [shape.query, shape]),
);
const effectsByMutation = new Map<string, SymbolicEffect[]>();
for (const fact of extractSymbolicEffectsFromProject({ files: projectFiles() })) {
  if (!fact.writeKey) continue;
  const list = effectsByMutation.get(fact.writeKey) ?? [];
  list.push(fact.effect);
  effectsByMutation.set(fact.writeKey, list);
}

type QueryLoader = (input: unknown, context?: { db?: SoDb }) => Promise<JsonValue>;
type Handler = (input: never, request: { db: SoDb }) => Promise<unknown>;

interface CommutingCase {
  effectsKey: string;
  handler: Handler;
  input: Record<string, JsonValue>;
  loader: QueryLoader;
  mutation: string;
  name: string;
  placeholderColumns?: readonly string[];
  query: string;
}

const CASES: CommutingCase[] = [
  {
    effectsKey: 'postQuestion',
    handler: postQuestion as unknown as Handler,
    input: { id: 'q3', title: 'New question', body: 'Body', authorId: 'u3' },
    loader: questionList.load as QueryLoader,
    mutation: 'postQuestion',
    name: 'postQuestion × questionList — push the new question row',
    query: 'questionList',
  },
  {
    effectsKey: 'postAnswer',
    handler: postAnswer as unknown as Handler,
    input: { id: 'a2', questionId: 'q1', body: 'Another answer', authorId: 'u3' },
    loader: answerList.load as QueryLoader,
    mutation: 'postAnswer',
    name: 'postAnswer × answerList — push the new answer row',
    query: 'answerList',
  },
  {
    effectsKey: 'postAnswer',
    handler: postAnswer as unknown as Handler,
    input: { id: 'a3', questionId: 'q1', body: 'Yet another', authorId: 'u3' },
    loader: questionList.load as QueryLoader,
    mutation: 'postAnswer',
    name: 'postAnswer × questionList — bump the matched answerCount',
    query: 'questionList',
  },
  {
    effectsKey: 'voteUp',
    handler: voteUp as unknown as Handler,
    input: { id: 'ignored', targetId: 'q2', userId: 'u3' },
    loader: questionList.load as QueryLoader,
    mutation: 'voteUp',
    name: 'voteUp × questionList — bump the matched score',
    query: 'questionList',
  },
  {
    effectsKey: 'voteUp',
    handler: voteUp as unknown as Handler,
    input: { id: 'ignored', targetId: 'q1', userId: 'u3' },
    loader: questionScore.load as QueryLoader,
    mutation: 'voteUp',
    name: 'voteUp × questionScore — increment the scalar score sum',
    query: 'questionScore',
  },
];

let activeDb: SoDb | undefined;

afterEach(async () => {
  // Drizzle/pglite: drop the underlying client between cases for isolation.
  const client = (activeDb as unknown as { $client?: { close(): Promise<void> } })?.$client;
  await client?.close();
  activeDb = undefined;
});

function stripPlaceholders(value: JsonValue, columns: readonly string[]): JsonValue {
  if (columns.length === 0) return value;
  const clone = structuredClone(value) as { items?: JsonValue[] };
  if (Array.isArray(clone.items)) {
    clone.items = clone.items.map((row) => {
      if (row === null || typeof row !== 'object' || Array.isArray(row)) return row;
      const next = { ...(row as Record<string, JsonValue>) };
      for (const column of columns) delete next[column];
      return next;
    });
  }
  return clone as JsonValue;
}

describe('stackoverflow derived optimism — commuting diagrams over real Postgres (pglite)', () => {
  for (const testCase of CASES) {
    it(testCase.name, async () => {
      const effects = effectsByMutation.get(testCase.effectsKey);
      const shape = shapeByQuery.get(testCase.query);
      expect(effects, `extracted effects for ${testCase.mutation}`).toBeDefined();
      expect(shape, `extracted shape for ${testCase.query}`).toBeDefined();
      if (!effects || !shape) return;

      const result = deriveOptimistic(effects, shape);
      expect(result.kind).toBe('derived');
      if (result.kind !== 'derived') return;

      const db = await createSoDb();
      activeDb = db;

      const before = await testCase.loader(undefined, { db });
      await testCase.handler(testCase.input as never, { db });
      const truth = await testCase.loader(undefined, { db });

      const predicted = applyPatchProgram(before, testCase.input, result.program, {
        now: () => 0,
        tempId: () => '__tempId__',
      });

      const columns = testCase.placeholderColumns ?? [];
      expect(stripPlaceholders(predicted, columns)).toEqual(stripPlaceholders(truth, columns));
    });
  }

  it('fails loudly when a derived program disagrees with Postgres', async () => {
    const db = await createSoDb();
    activeDb = db;
    const loadScore = questionScore.load as QueryLoader;
    const before = await loadScore(undefined, { db });
    await voteUp({ id: 'x', targetId: 'q1', userId: 'u3' } as never, { db });
    const truth = await loadScore(undefined, { db });
    // Deliberately broken program: increments by a wrong constant.
    const broken = applyPatchProgram(
      before,
      { targetId: 'q1' },
      {
        ops: [{ by: { kind: 'const', value: 999 }, op: 'inc', path: 'score' }],
        query: 'questionScore',
      },
    );
    expect(broken).not.toEqual(truth);
  });
});
