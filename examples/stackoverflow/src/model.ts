import { form, type FormInput } from '@kovojs/core';
import { domain } from '@kovojs/server';

import type { SoDb } from './db.js';

// Shared demo facts: invalidation domains, typed mutation forms, and the small
// request/result shapes consumed across the interactive example.
export const question = domain('question');
export const answer = domain('answer');
export const vote = domain('vote');

export const postQuestionForm = form('postQuestion');
export const postAnswerForm = form('postAnswer');
export const voteUpForm = form('voteUp');

export type PostQuestionInput = FormInput<typeof postQuestionForm>;
export type PostAnswerInput = FormInput<typeof postAnswerForm>;
export type VoteUpInput = FormInput<typeof voteUpForm>;

export interface SoRequest {
  db: SoDb;
  session?: {
    id?: string;
    user?: { id?: string; roles?: readonly string[] } | null;
  } | null;
}

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
