/** @jsxImportSource @kovojs/server */
import { component, FormError, type ComponentRenderSlots } from '@kovojs/core';
import { csrfField } from '@kovojs/server';
import { Badge } from '@kovojs/ui/badge';
import { Button } from '@kovojs/ui/button';
import { Card } from '@kovojs/ui/card';

import { postQuestionMutation, soCsrf } from '../mutations.js';
import { questionList, questionScore } from '../queries.js';
import { postQuestionForm, type QuestionListItem, type SoRequest } from '../model.js';
import {
  freshId,
  parseTags,
  renderAuthor,
  renderTags,
  voteButton,
} from '../components/chrome.js';

// Question list for `/`. It reads the question rowset and total vote score, then
// renders the ask form and question cards.

type QuestionListQueryResult = Awaited<ReturnType<typeof questionList.load>>;
type QuestionScoreQueryResult = Awaited<ReturnType<typeof questionScore.load>>;
type QuestionListRenderSlots = ComponentRenderSlots<{ postQuestion: typeof postQuestionForm }> & {
  request?: SoRequest | undefined;
};
type DuplicateTitleFailure = Extract<
  NonNullable<QuestionListRenderSlots['forms']['postQuestion']['failure']>,
  { code: 'DUPLICATE_TITLE' }
>;

const defaultQuestionListRenderSlots: QuestionListRenderSlots = {
  forms: { postQuestion: { failure: null } },
};

function renderQuestionRow(question: QuestionListItem, request?: SoRequest): string {
  const tags = parseTags(question.tags);
  const body = (
    <div class="so-row">
      {voteButton(question.id, question.score, request)}
      <div class="so-row-stat">
        <span class="so-row-stat-num tabular-nums">{question.answerCount}</span>
        <span class="so-row-stat-label">answers</span>
      </div>
      <div class="so-row-main">
        <a class="so-row-title" href={`/questions/${question.id}`}>
          {question.title}
        </a>
        {question.body ? <p class="so-row-excerpt">{question.body}</p> : ''}
        <div class="so-row-meta">
          {renderTags(tags)}
          {renderAuthor(question.authorName, question.createdAt, 'asked')}
        </div>
      </div>
    </div>
  );
  // Keep the stable key on the repeated child that the fragment morphs.
  return <li kovo-key={question.id}>{Card.definition.render({ children: body })}</li>;
}

// Interactive region rendered inside the full page and fragment responses.
export const QuestionListRegion = component({
  mutations: { postQuestion: postQuestionForm },
  queries: { questionList, questionScore },
  render: ({
    questionList,
    questionScore,
  }: {
    questionList: QuestionListQueryResult;
    questionScore: QuestionScoreQueryResult;
  }, _state, slots: QuestionListRenderSlots = defaultQuestionListRenderSlots) => {
    const questions = questionList.items;
    const totalVotes = questionScore.score;
    const askButton = Button.definition.render({
      children: 'Ask question',
      type: 'submit',
      variant: 'primary',
    });

    return (
      <div class="so-stack">
        <div class="so-page-head">
          <div>
            <h1 class="so-page-title">Top questions</h1>
            <p class="so-page-sub">
              {questions.length} questions ·{' '}
              <span class="font-semibold tabular-nums text-slate-700">{totalVotes}</span> votes cast
            </p>
          </div>
          {Badge.definition.render({ children: 'Newest', variant: 'success' })}
        </div>

        {/* Native form; enhanced submissions refresh this whole region. */}
        <form enhance mutation={postQuestionMutation} class="so-composer">
          {slots.request ? csrfField(slots.request, soCsrf) : ''}
          <input type="hidden" name="id" value={freshId('q')} />
          <input type="hidden" name="authorId" value="demo-viewer" />
          <p class="so-composer-title">Ask the community</p>
          <input
            name="title"
            required
            placeholder="What's your programming question? Be specific."
            class="so-input"
          />
          <textarea
            name="body"
            required
            rows="2"
            placeholder="Add the details that help others answer…"
            class="so-input so-textarea"
          />
          <div class="so-composer-actions">{askButton}</div>
          <FormError
            code="DUPLICATE_TITLE"
            class="so-form-error"
            message={(failure: DuplicateTitleFailure) =>
              `A question titled "${failure.payload.title}" already exists.`
            }
          />
        </form>

        <ul class="so-list">
          {questions.map((question) => renderQuestionRow(question, slots.request))}
        </ul>
      </div>
    );
  },
});
