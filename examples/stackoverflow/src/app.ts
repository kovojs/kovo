// Public demo surface for the Stack Overflow clone: schema, queries, and
// mutations. Generated graph artifacts stay compiler-owned.

export { createSoDb, type SoDb } from './db.js';
export {
  answer,
  question,
  type AnswerListResult,
  type PostAnswerInput,
  type PostQuestionInput,
  type QuestionListResult,
  type QuestionScoreResult,
  type SoRequest,
  vote,
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
