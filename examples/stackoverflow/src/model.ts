import { domain } from '@kovojs/server';

import type { SoDb } from './db.js';

// Shared demo facts: invalidation domains, typed mutation inputs, and the small
// request/result shapes consumed across the interactive example.
export const question = domain();
export const answer = domain();
export const vote = domain();

export interface PostQuestionInput {
  body: string;
  id: string;
  title: string;
}

export interface PostAnswerInput {
  body: string;
  id: string;
  questionId: string;
}

export interface VoteUpInput {
  id: string;
  targetId: string;
}

export interface SoRequest {
  db: SoDb;
  session?: {
    id?: string;
    user?: { id?: string; roles?: readonly string[] } | null;
  } | null;
}

export type QuestionListItem = {
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
  items: QuestionListItem[];
};

export type QuestionDetailResult = {
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
  id: string;
  questionId: string;
  body: string;
  score: number;
};

export type AnswerListResult = {
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
  score: number;
};
