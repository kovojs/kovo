// Public demo surface for the Stack Overflow clone: schema, queries, mutations,
// and the authored app graph helper. Generated artifacts stay compiler-owned.

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

export { createSoGraph, soGraphDeclarations } from './graph.js';
