import type { JsonValue } from '@kovojs/core';
import {
  applyPatchProgram,
  type AlgebraicQueryShape,
  type DerivationResult,
  type SymbolicEffect,
  type SymbolicValue,
} from '@kovojs/core/internal/derivation';
import { describe, expect, it } from 'vitest';

import { deriveOptimistic } from './derive.js';

// SPEC.md §10.5 (normative commuting diagram) — the deriver's SOUNDNESS suite for the
// StackOverflow `voteUp` example. A derived optimistic transform is sound iff it makes the
// diagram commute for every client state `s` and mutation input `i`:
//
//     patch(clientShape(s), i)  ≡  clientShape(apply(effect, s, i))
//
// i.e. predicting the patch on the client's view of the data equals re-deriving that view
// after the server applies the write. A transform that fails this is worse than no derivation
// (it predicts a value the server then contradicts), so EACH derived (mutation × query) pair the
// generator folds into `OptimisticDerivationSets` is gated here over a generated state sweep.
//
// The `effects` + `shapes` below are the REAL output of the §10.5 extractor over
// `examples/stackoverflow/src` (Stage-1 `extractSymbolicEffectsFromProject`, Stage-2
// `extractAlgebraicShapesFromProject`); regenerate via the example's `generate-registry` if the
// example source changes. The derived `program` is re-derived here (not hand-pinned) so this
// suite proves the live deriver — not a stale snapshot.

const SID = 'demo-session';
const SESSION = { id: SID, user: { id: 'demo-viewer' } } as const;

// voteUp's two write effects (votes INSERT, questions score UPDATE), per the Stage-1 extractor.
const voteUpEffects: readonly SymbolicEffect[] = [
  {
    op: 'insert',
    table: 'votes',
    values: {
      sessionId: { kind: 'session', path: 'id' },
      targetType: { kind: 'const', value: 'question' },
      targetId: { kind: 'param', path: 'targetId' },
      userId: { kind: 'session', path: 'user.id' },
      value: { kind: 'const', value: 1 },
    },
  },
  {
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
        left: { column: 'score', kind: 'col' },
        op: '+',
        right: { kind: 'const', value: 1 },
      },
    },
    table: 'questions',
  },
];

// questionScore: SUM(votes.value) filtered to the session — INSERT × SUM ⇒ `inc score by 1`.
const questionScoreShape: AlgebraicQueryShape = {
  fields: {
    score: {
      arith: { column: 'value', kind: 'col' },
      kind: 'sum',
      rowset: {
        filters: [{ column: 'sessionId', op: 'eq', value: { kind: 'session', path: 'id' } }],
        key: 'sessionId,id',
        orderBy: [],
        table: 'votes',
      },
    },
  },
  query: 'questionScore',
};

// questionList: AGG over the session's questions ordered by id — UPDATE × AGG ⇒ guarded
// exact-row `score += 1` on the row whose id matches the voted question.
const questionListProjection = [
  'authorId',
  'authorName',
  'body',
  'createdAt',
  'id',
  'tags',
  'title',
  'score',
  'answerCount',
] as const;
const questionListRowset = {
  filters: [
    { column: 'sessionId', op: 'eq' as const, value: { kind: 'session' as const, path: 'id' } },
  ],
  key: 'sessionId,id',
  orderBy: [{ column: 'id', direction: 'asc' as const }],
  table: 'questions',
};
const questionListShape: AlgebraicQueryShape = {
  fields: {
    items: {
      columnTypes: {
        authorId: 'string',
        authorName: 'string',
        body: 'string',
        createdAt: 'string',
        id: 'string',
        tags: 'string',
        title: 'string',
        score: 'number',
        answerCount: 'number',
      },
      kind: 'agg',
      projection: [...questionListProjection],
      rowKey: 'sessionId,id',
      rowset: questionListRowset,
    },
  },
  query: 'questionList',
  rowsByTable: {
    questions: {
      columns: [...questionListProjection],
      rowset: questionListRowset,
      rowsPath: 'items',
    },
  },
};

// ── abstract DB state + the three diagram legs ──────────────────────────────────────────────

interface QuestionRow {
  [column: string]: JsonValue;
  answerCount: number;
  authorId: string;
  authorName: string;
  body: string;
  createdAt: string;
  id: string;
  score: number;
  sessionId: string;
  tags: string;
  title: string;
}
interface VoteRow {
  [column: string]: JsonValue;
  sessionId: string;
  targetId: string;
  targetType: string;
  userId: string;
  value: number;
}
interface DbState {
  questions: QuestionRow[];
  votes: VoteRow[];
}

function readPath(source: JsonValue, path: string): JsonValue {
  let current: JsonValue = source;
  for (const segment of path.split('.')) {
    if (current === null || typeof current !== 'object' || Array.isArray(current)) return null;
    current = (current as Record<string, JsonValue>)[segment] ?? null;
  }
  return current;
}

/** §10.5 Stage-1 value, resolved against the mutation input / session / (optional) self row. */
function resolveValue(
  value: SymbolicValue,
  input: JsonValue,
  row?: Record<string, JsonValue>,
): JsonValue {
  switch (value.kind) {
    case 'const':
      return value.value;
    case 'param':
      return readPath(input, value.path);
    case 'session':
      return readPath(SESSION as unknown as JsonValue, value.path);
    case 'col':
      return row ? (row[value.column] ?? null) : null;
    case 'arith': {
      const left = Number(resolveValue(value.left, input, row) ?? 0);
      const right = Number(resolveValue(value.right, input, row) ?? 0);
      return value.op === '+'
        ? left + right
        : value.op === '-'
          ? left - right
          : value.op === '*'
            ? left * right
            : left / right;
    }
    default:
      throw new Error(`unexpected value kind in voteUp effects: ${value.kind}`);
  }
}

/** apply(effect, s, i): the server applying voteUp's write effects to the abstract DB state. */
function applyEffects(state: DbState, input: JsonValue): DbState {
  const next: DbState = {
    questions: state.questions.map((q) => ({ ...q })),
    votes: state.votes.map((v) => ({ ...v })),
  };
  for (const effect of voteUpEffects) {
    if (effect.op === 'insert' && effect.table === 'votes') {
      const row: Record<string, JsonValue> = {};
      for (const [column, value] of Object.entries(effect.values)) {
        row[column] = resolveValue(value, input);
      }
      next.votes.push(row as unknown as VoteRow);
    } else if (effect.op === 'update' && effect.table === 'questions') {
      const match = effect.match;
      if (match.kind !== 'keys') throw new Error('voteUp questions match is keyed');
      for (const q of next.questions) {
        const matches = match.eq.every((eq) => q[eq.column] === resolveValue(eq.value, input, q));
        if (!matches) continue;
        for (const [column, value] of Object.entries(effect.sets)) {
          q[column] = resolveValue(value, input, q);
        }
      }
    }
  }
  return next;
}

/** clientShape for questionScore: SUM(votes.value) over the session's votes. */
function clientShapeQuestionScore(state: DbState): JsonValue {
  const score = state.votes
    .filter((v) => v.sessionId === SID)
    .reduce((total, v) => total + Number(v.value ?? 0), 0);
  return { score };
}

/** clientShape for questionList: the session's questions, projected, ordered by id asc. */
function clientShapeQuestionList(state: DbState): JsonValue {
  const items = state.questions
    .filter((q) => q.sessionId === SID)
    .slice()
    .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
    .map((q) => {
      const projected: Record<string, JsonValue> = {};
      for (const column of questionListProjection) projected[column] = q[column];
      return projected;
    });
  return { items };
}

function expectDerived(
  result: DerivationResult,
): asserts result is Extract<DerivationResult, { kind: 'derived' }> {
  if (result.kind !== 'derived') {
    throw new Error(`expected a derived transform, got punt: ${JSON.stringify(result)}`);
  }
}

function makeQuestion(id: string, sessionId: string, score: number): QuestionRow {
  return {
    answerCount: 0,
    authorId: 'u1',
    authorName: 'Anonymous',
    body: `body-${id}`,
    createdAt: '',
    id,
    score,
    sessionId,
    tags: '',
    title: `title-${id}`,
  };
}

// Deterministic generated-state sweep: vary which questions/votes exist, their sessions and
// scores, and the voted targetId (present in-session, present cross-session, and absent).
const QUESTION_IDS = ['q1', 'q2', 'q3'];
const SCORES = [0, 1, 7];
const SESSIONS = [SID, 'other-session'];

function questionStates(): DbState[] {
  const states: DbState[] = [];
  // Subsets of {q1,q2,q3}, each present row assigned a (session, score) from a rotating table.
  for (let subset = 1; subset < 1 << QUESTION_IDS.length; subset++) {
    for (let variant = 0; variant < 6; variant++) {
      const questions: QuestionRow[] = [];
      QUESTION_IDS.forEach((id, index) => {
        if ((subset & (1 << index)) === 0) return;
        const session = SESSIONS[(variant + index) % SESSIONS.length]!;
        const score = SCORES[(variant + index * 2) % SCORES.length]!;
        questions.push(makeQuestion(id, session, score));
      });
      states.push({ questions, votes: [] });
    }
  }
  return states;
}

function voteStates(): DbState[] {
  const states: DbState[] = [];
  for (let count = 0; count <= 4; count++) {
    for (let variant = 0; variant < 4; variant++) {
      const votes: VoteRow[] = [];
      for (let index = 0; index < count; index++) {
        votes.push({
          sessionId: SESSIONS[(variant + index) % SESSIONS.length]!,
          targetId: QUESTION_IDS[index % QUESTION_IDS.length]!,
          targetType: 'question',
          userId: 'u1',
          value: SCORES[(variant + index) % SCORES.length]! || 1,
        });
      }
      states.push({ questions: [], votes });
    }
  }
  return states;
}

// Voted targets: a present in-session id, a present cross-session id, and an absent id.
const TARGET_IDS = ['q1', 'q2', 'q3', 'absent'];

describe('§10.5 commuting diagram — voteUp × questionScore (INSERT × SUM)', () => {
  const result = deriveOptimistic(voteUpEffects, questionScoreShape);

  it('derives `inc score by 1`', () => {
    expectDerived(result);
    expect(result.program).toEqual({
      ops: [{ by: { kind: 'const', value: 1 }, op: 'inc', path: 'score' }],
      query: 'questionScore',
    });
  });

  it('patch(clientShape(s), i) ≡ clientShape(apply(effect, s, i)) over generated states', () => {
    expectDerived(result);
    let checked = 0;
    for (const state of voteStates()) {
      for (const targetId of TARGET_IDS) {
        const input: JsonValue = { id: 'vote-new', targetId };
        const before = clientShapeQuestionScore(state);
        const predicted = applyPatchProgram(before, input, result.program);
        const reconciled = clientShapeQuestionScore(applyEffects(state, input));
        expect(predicted).toEqual(reconciled);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(50);
  });
});

describe('§10.5 commuting diagram — voteUp × questionList (UPDATE × AGG, guarded exact-row)', () => {
  const result = deriveOptimistic(voteUpEffects, questionListShape);

  it('derives a guarded exact-row `score += 1` keyed by id', () => {
    expectDerived(result);
    expect(result.program).toEqual({
      ops: [
        {
          guard: 'find-or-noop',
          match: [{ column: 'id', value: { kind: 'param', path: 'targetId' } }],
          op: 'update-row',
          path: 'items',
          sets: {
            score: {
              kind: 'arith',
              left: { column: 'score', kind: 'col' },
              op: '+',
              right: { kind: 'const', value: 1 },
            },
          },
        },
      ],
      query: 'questionList',
    });
  });

  it('patch(clientShape(s), i) ≡ clientShape(apply(effect, s, i)) over generated states', () => {
    expectDerived(result);
    let checked = 0;
    for (const state of questionStates()) {
      for (const targetId of TARGET_IDS) {
        const input: JsonValue = { id: 'vote-new', targetId };
        const before = clientShapeQuestionList(state);
        const predicted = applyPatchProgram(before, input, result.program);
        const reconciled = clientShapeQuestionList(applyEffects(state, input));
        expect(predicted).toEqual(reconciled);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(100);
  });
});
