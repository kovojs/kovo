// Public demo surface for the Stack Overflow clone: schema, queries, and
// mutations. Generated graph artifacts stay compiler-owned.

export { createSoDb, type SoDb } from './db.js';
export {
  answer,
  question,
  type AnswerListResult,
  type QuestionListResult,
  type QuestionScoreResult,
  vote,
} from './model.js';
export { answerList, questionList, questionScore } from './queries.js';
export { postAnswerMutation, postQuestionMutation, voteUpMutation } from './mutations.js';
