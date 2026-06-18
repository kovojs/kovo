/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import { csrfField } from '@kovojs/server';
import { Badge } from '@kovojs/ui/badge';
import { Button } from '@kovojs/ui/button';
import { Card } from '@kovojs/ui/card';

import { postAnswerMutation, soCsrf } from '../mutations.js';
import { questionAnswers, questionDetail } from '../queries.js';
import type { SoRequest } from '../runtime.js';
import type { QuestionAnswersResult, QuestionDetailResult } from '../types.js';
import {
  freshId,
  parseTags,
  renderAuthor,
  renderTags,
  voteButton,
} from '../components/chrome.js';

// Question detail for `/questions/:id`: the question, answers, and answer form.

function renderQuestionCard(question: QuestionDetailResult, request?: SoRequest): string {
  const tags = parseTags(question.tags);
  const body = (
    <div class="so-row">
      {voteButton(question.id, question.score, request)}
      <div class="so-row-main">
        <h1 class="so-detail-title">{question.title}</h1>
        <p class="so-detail-body">{question.body}</p>
        <div class="so-row-meta">
          {renderTags(tags)}
          {question.authorName
            ? renderAuthor(question.authorName, question.createdAt, 'asked')
            : ''}
        </div>
      </div>
    </div>
  );
  return Card.definition.render({ children: body });
}

function renderAnswerCard(answer: QuestionAnswersResult[number]): string {
  const acceptedBadge = answer.accepted
    ? Badge.definition.render({ children: '✓ Accepted answer', variant: 'success' })
    : '';
  const body = (
    <div class="so-row">
      <div class="so-answer-vote">
        <span class="so-vote-caret">&#9650;</span>
        <span class="so-vote-score tabular-nums">{answer.score}</span>
        <span class="so-vote-label">votes</span>
      </div>
      <div class="so-row-main">
        {acceptedBadge ? <div class="mb-2">{acceptedBadge}</div> : ''}
        <p class="so-answer-body">{answer.body}</p>
        {answer.authorName ? (
          <div class="so-row-meta">
            {renderAuthor(answer.authorName, answer.createdAt, 'answered')}
          </div>
        ) : (
          ''
        )}
      </div>
    </div>
  );
  const surface = Card.definition.render({ children: body });
  // Keep the stable key on the repeated child that the fragment morphs.
  return (
    <li
      kovo-key={answer.id}
      class={answer.accepted ? 'so-answer so-answer--accepted' : 'so-answer'}
    >
      {surface}
    </li>
  );
}

// Interactive region rendered inside the full page and fragment responses.
export const QuestionDetailRegion = component({
  props: { questionId: String },
  queries: {
    answers: questionAnswers.args((props) => ({ questionId: props.questionId })),
    question: questionDetail.args((props) => ({ id: props.questionId })),
  },
  render: ({
    answers,
    question,
    questionId,
  }: {
    answers: QuestionAnswersResult;
    question: QuestionDetailResult | null;
    questionId: string;
  }, _state, slots: { request?: SoRequest | undefined } = {}) => {
    if (!question) {
      return (
        <div class="so-stack">
          <a class="so-back" href="/">
            &larr; All questions
          </a>
          {Card.definition.render({
            children:
              '<h1 class="so-detail-title">Question not found</h1><p class="so-detail-body">This question does not exist (it may have been a demo that reset).</p>',
          })}
        </div>
      );
    }

    const postButton = Button.definition.render({
      children: 'Post your answer',
      type: 'submit',
      variant: 'primary',
    });
    return (
      <div class="so-stack">
        <a class="so-back" href="/">
          &larr; All questions
        </a>

          {renderQuestionCard(question, slots.request)}

        <section class="so-stack">
          <h2 class="so-answers-head">
            <span>{question.answerCount}</span> {question.answerCount === 1 ? 'Answer' : 'Answers'}
          </h2>
          <ul class="so-answer-list">{answers.map(renderAnswerCard)}</ul>

          {/* Native form; enhanced submissions refresh this whole region. */}
          <form enhance mutation={postAnswerMutation} class="so-composer">
            {slots.request ? csrfField(slots.request, soCsrf) : ''}
            <input type="hidden" name="id" value={freshId('a')} />
            <input type="hidden" name="questionId" value={question.id} />
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
