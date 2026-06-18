import { form, type FormInput } from '@kovojs/core';

// Form helpers and result shapes shared by the demo components and generated
// StackOverflow artifacts.

export const postQuestionForm = form('postQuestion');
export const postAnswerForm = form('postAnswer');
export const voteUpForm = form('voteUp');

export type PostQuestionInput = FormInput<typeof postQuestionForm>;
export type PostAnswerInput = FormInput<typeof postAnswerForm>;
export type VoteUpInput = FormInput<typeof voteUpForm>;

// Query result shapes (the §10.5 algebraic shapes the deriver patches).
export interface QuestionListItem {
  authorId: string;
  authorName: string;
  body: string;
  createdAt: string;
  id: string;
  tags: string;
  score: number;
  answerCount: number;
  title: string;
}
export interface QuestionListResult {
  items: QuestionListItem[];
}

export interface QuestionDetailResult {
  id: string;
  title: string;
  body: string;
  authorId: string;
  score: number;
  answerCount: number;
  authorName?: string;
  tags?: string;
  createdAt?: string;
}

export interface AnswerListItem {
  id: string;
  questionId: string;
  body: string;
  score: number;
}
export interface AnswerListResult {
  items: AnswerListItem[];
}

export interface QuestionAnswerDetail extends AnswerListItem {
  accepted: boolean;
  authorId: string;
  authorName?: string;
  createdAt?: string;
}
export type QuestionAnswersResult = QuestionAnswerDetail[];

export interface QuestionScoreResult {
  score: number;
}
