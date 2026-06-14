// SPEC.md §10–§11: the public surface of the Stack Overflow clone — a FOCUSED
// data + derived-optimism example (schema, queries, mutations, the extracted fw
// graph, and the compiler-derived optimistic transforms). No TSX/app-shell/
// browser/static-export here (the commerce example owns the full-UI story).

import { createSoGraph } from './graph.js';
import { soTouchGraph } from './generated/touch-graph.js';

export { answer, question, vote } from './domains.js';
export { createSoDb, type SoDb } from './db.js';
export type { SoRequest } from './runtime.js';
export { answerList, questionList, questionScore } from './queries.js';
export {
  postAnswer,
  postAnswerMutation,
  postQuestion,
  postQuestionMutation,
  voteUp,
  voteUpMutation,
} from './mutations.js';
export {
  postAnswerForm,
  postQuestionForm,
  voteUpForm,
  type AnswerListResult,
  type PostAnswerInput,
  type PostQuestionInput,
  type QuestionListResult,
  type QuestionScoreResult,
  type VoteUpInput,
} from './types.js';

// SPEC.md §10.4: the committed, compiler-derived optimistic plans. Deleting a
// transform lets a hand-written override take the pair; regenerating restores
// derivation (the pair-by-pair §10.4 contract).
export { postAnswerDerivedOptimistic } from './generated/optimistic/post-answer.js';
export { postQuestionDerivedOptimistic } from './generated/optimistic/post-question.js';
export { voteUpDerivedOptimistic } from './generated/optimistic/vote-up.js';

export { soTouchGraph } from './generated/touch-graph.js';
export { createSoGraph, soGraphDeclarations } from './graph.js';

/** The committed FwExplainInput graph (declarations + the EXTRACTED touch graph). */
export const soGraph = createSoGraph(soTouchGraph);
