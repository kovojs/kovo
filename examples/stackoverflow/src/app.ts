// Public demo surface for the Stack Overflow clone: schema, queries, mutations,
// the app graph, and the compiler-generated optimistic transforms.

import { createSoGraph } from './graph.js';
import { soQueryDomains, soTouchGraph } from './generated/touch-graph.js';

export { createSoDb, type SoDb } from './db.js';
export {
  answer,
  postAnswerForm,
  postQuestionForm,
  question,
  type AnswerListResult,
  type PostAnswerInput,
  type PostQuestionInput,
  type QuestionListResult,
  type QuestionScoreResult,
  type SoRequest,
  vote,
  voteUpForm,
  type VoteUpInput,
} from './model.js';
export { answerList, questionList, questionScore } from './queries.js';
export {
  postAnswer,
  postAnswerMutation,
  postQuestion,
  postQuestionMutation,
  voteUp,
  voteUpMutation,
} from './mutations.js';

// SPEC.md §10.4: committed compiler-derived optimistic plans.
export { postAnswerDerivedOptimistic } from './generated/optimistic/post-answer.js';
export { postQuestionDerivedOptimistic } from './generated/optimistic/post-question.js';
export { voteUpDerivedOptimistic } from './generated/optimistic/vote-up.js';

export { soQueryDomains, soTouchGraph } from './generated/touch-graph.js';
export { createSoGraph, soGraphDeclarations } from './graph.js';

/** The committed Kovo graph used by the demo checks. */
export const soGraph = createSoGraph(soTouchGraph, soQueryDomains);
