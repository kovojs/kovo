// @kovojs-ir — lowered from examples/stackoverflow/src/components/question-detail.tsx by @kovojs/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit-components`.
/** @jsxImportSource @kovojs/server */
import { escapeText } from '@kovojs/server/internal/html';
import { derive } from '@kovojs/runtime/generated';

export const QuestionDetailRegion$input_value_derive = derive(["question"], (question) => question.id);

import { component } from '@kovojs/core';
import { Badge } from '@kovojs/ui/badge';
import { Button } from '@kovojs/ui/button';
import { Card } from '@kovojs/ui/card';

import { postAnswerMutation } from '../mutations.js';
import { answerList, questionList } from '../queries.js';
import type { AnswerListItem } from '../types.js';
import {
  freshId,
  parseTags,
  renderAuthor,
  renderSoShell,
  renderTags,
  voteButton,
} from '../components/chrome.js';

// Question detail (route `/questions/:id`). Shows the question and its answers
// (filtered from `answerList` by questionId), with the accepted answer flagged.
// SPEC.md §4.8: the query-backed component root derives its `kovo-fragment-target`
// in the generated module, so the voteUp / postAnswer mutationResponse can
// re-render this region from server truth — no hand-authored target string.
//
// Restyled with @kovojs/ui (SPEC.md §6.1.1): the question and each answer are
// Cards, tags + the accepted state are Badges, and the composer uses a Button.
// The accepted answer gets an accent left border via a token-driven class.

export const QUESTION_DETAIL_TARGET = 'question-detail-region';

export interface QuestionDetail {
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

export interface AnswerDetail extends AnswerListItem {
  accepted: boolean;
  authorId: string;
  authorName?: string;
  createdAt?: string;
}

export interface QuestionDetailPageData {
  question: QuestionDetail;
  answers: AnswerDetail[];
}

function renderQuestionCard(question: QuestionDetail): string {
  const tags = parseTags(question.tags);
  const body = (
    <div class="so-row">
      {voteButton(question.id, question.score)}
      <div class="so-row-main">
        <h1 class="so-detail-title" data-bind="question.title">{question.title}</h1>
        <p class="so-detail-body" data-bind="question.body">{question.body}</p>
        <div class="so-row-meta">
          {renderTags(tags)}
          {question.authorName ? renderAuthor(question.authorName, question.createdAt, 'asked') : ''}
        </div>
      </div>
    </div>
  );
  return Card.definition.render({ children: body });
}

function renderAnswerCard(answer: AnswerDetail): string {
  const acceptedBadge = answer.accepted
    ? Badge.definition.render({ children: '✓ Accepted answer', variant: 'success' })
    : '';
  const body = (
    <div class="so-row">
      <div class="so-answer-vote">
        <span class="so-vote-caret">&#9650;</span>
        <span class="so-vote-score tabular-nums">{escapeText(answer.score)}</span>
        <span class="so-vote-label">votes</span>
      </div>
      <div class="so-row-main">
        {acceptedBadge ? <div class="mb-2">{acceptedBadge}</div> : ''}
        <p class="so-answer-body">{escapeText(answer.body)}</p>
        {answer.authorName ? (
          <div class="so-row-meta">{renderAuthor(answer.authorName, answer.createdAt, 'answered')}</div>
        ) : (
          ''
        )}
      </div>
    </div>
  );
  const surface = Card.definition.render({ children: body });
  // Keyed child of the detail fragment host; accepted answers get the accent rail.
  return (
    <li kovo-key={answer.id} class={answer.accepted ? 'so-answer so-answer--accepted' : 'so-answer'}>
      {surface}
    </li>
  );
}

// The interactive region, rendered inside the page and as the voteUp / postAnswer
// fragment payload. SPEC.md §4.8: the query-backed component root derives its
// `kovo-fragment-target` in the generated module.
export const QuestionDetailRegion = component({
  queries: { answers: answerList, question: questionList },
  render: ({ question, answers }: QuestionDetailPageData) => {
    const postButton = Button.definition.render({
      children: 'Post your answer',
      type: 'submit',
      variant: 'primary',
    });
    return (
      <div class="so-stack" kovo-c="question-detail-region" kovo-deps="answers question" kovo-fragment-target="question-detail-region">
        <a class="so-back" href="/">
          &larr; All questions
        </a>

        {renderQuestionCard(question)}

        <section class="so-stack">
          <h2 class="so-answers-head">
            <span data-bind="question.answerCount">{question.answerCount}</span> {question.answerCount === 1 ? 'Answer' : 'Answers'}
          </h2>
          <ul class="so-answer-list">{answers.map(renderAnswerCard)}</ul>

          {/* SPEC.md §6.3: a no-JS "post answer" form. POSTs to the postAnswer
              mutation; the fragment re-renders this whole region so the new answer
              and bumped count appear and the composer resets (fresh id). Authored
              directly in the component render (not wrapped in Card.definition.render)
              so the compiler lowers `mutation={...}` consistently; `so-composer`
              gives the card surface. */}
          <form enhance method="post" action="/_m/postAnswer" data-mutation="postAnswer" kovo-fragment-target="post-answer-mutation" class="so-composer">
            <input type="hidden" name="id" value={freshId('a')} />
            <input type="hidden" name="questionId" data-derive="question.QuestionDetailRegion$input_value_derive" data-derive-attr="value" />
            <input type="hidden" name="authorId" value="demo-viewer" />
            <label class="so-composer-title" for="answer-body">
              Your answer
            </label>
            <textarea
              id="answer-body"
              name="body"
              required
              rows="3"
              placeholder="Share what you know — code and reasoning welcome…"
              class="so-input so-textarea"
            />
            <div class="so-composer-actions">{postButton}</div>
          </form>
        </section>
      </div>
    );
  },
});
QuestionDetailRegion.name = "components/question-detail/question-detail-region";

export function renderQuestionDetailRegion(data: QuestionDetailPageData): string {
  return QuestionDetailRegion.definition.render(data);
}

export function renderQuestionDetailPage(data: QuestionDetailPageData): string {
  return renderSoShell(renderQuestionDetailRegion(data));
}
