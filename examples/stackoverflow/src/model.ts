import type { JsonValue } from '@kovojs/core';
import { domain } from '@kovojs/server';

// Shared demo facts: invalidation domains and query result shapes consumed across the
// interactive example. Mutation input and request types are inferred by the app contract.
export const question = domain();
export const answer = domain();
export const vote = domain();

export type QuestionListItem = {
  readonly [key: string]: JsonValue;
  authorId: string;
  authorName: string;
  body: string;
  createdAt: string;
  id: string;
  tags: string;
  score: number;
  answerCount: number;
  title: string;
};

export type QuestionListResult = {
  readonly [key: string]: JsonValue;
  items: QuestionListItem[];
};

export type QuestionDetailResult = {
  readonly [key: string]: JsonValue;
  id: string;
  title: string;
  body: string;
  authorId: string;
  score: number;
  answerCount: number;
  authorName?: string;
  tags?: string;
  createdAt?: string;
};

export type AnswerListItem = {
  readonly [key: string]: JsonValue;
  id: string;
  questionId: string;
  body: string;
  score: number;
};

export type AnswerListResult = {
  readonly [key: string]: JsonValue;
  items: AnswerListItem[];
};

export type QuestionAnswerDetail = AnswerListItem & {
  accepted: boolean;
  authorId: string;
  authorName?: string;
  createdAt?: string;
};

export type QuestionAnswersResult = QuestionAnswerDetail[];

export type QuestionScoreResult = {
  readonly [key: string]: JsonValue;
  score: number;
};
