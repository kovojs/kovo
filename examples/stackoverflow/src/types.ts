import { form } from '@kovojs/core';

// SPEC.md §6.3 / §10.4: typed mutation input shapes + their `form(...)` handles.
// The generated optimistic transforms are `OptimisticFor<typeof <form>>`, so the
// form's input type drives `$input` and the InvalidationSets/QueryRegistry
// augmentations (in generated/touch-graph.ts) drive the per-query transform shape.

// Type aliases (not interfaces): an object-literal type structurally satisfies
// `Record<string, JsonValue>`, which `form<Key, Input>` requires.
export type PostQuestionInput = {
  id: string;
  title: string;
  body: string;
  authorId: string;
};

export type PostAnswerInput = {
  id: string;
  questionId: string;
  body: string;
  authorId: string;
};

export type VoteUpInput = {
  id: string;
  targetId: string;
  userId: string;
};

export const postQuestionForm = form<'postQuestion', PostQuestionInput>('postQuestion');
export const postAnswerForm = form<'postAnswer', PostAnswerInput>('postAnswer');
export const voteUpForm = form<'voteUp', VoteUpInput>('voteUp');

// Query result shapes (the §10.5 algebraic shapes the deriver patches).
export interface QuestionListItem {
  id: string;
  title: string;
  score: number;
  answerCount: number;
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
