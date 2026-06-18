// Public demo surface for the Stack Overflow clone: schema, queries, mutations,
// the app graph, and the compiler-generated optimistic transforms.

import { createSoGraph } from './graph.js';
import { soQueryDomains, soTouchGraph } from './generated/touch-graph.js';

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

// SPEC.md §10.4: committed compiler-derived optimistic plans.
export { postAnswerDerivedOptimistic } from './generated/optimistic/post-answer.js';
export { postQuestionDerivedOptimistic } from './generated/optimistic/post-question.js';
export { voteUpDerivedOptimistic } from './generated/optimistic/vote-up.js';

export { soQueryDomains, soTouchGraph } from './generated/touch-graph.js';
export { createSoGraph, soGraphDeclarations } from './graph.js';

/** The committed Kovo graph used by the demo checks. */
export const soGraph = createSoGraph(soTouchGraph, soQueryDomains);
