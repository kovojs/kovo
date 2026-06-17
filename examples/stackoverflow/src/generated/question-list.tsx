// @kovojs-ir — lowered from examples/stackoverflow/src/components/question-list.tsx by @kovojs/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit-components`.
/** @jsxImportSource @kovojs/server */
import { escapeText } from '@kovojs/server/internal/html';
import { component, FormError, type ComponentRenderSlots } from '@kovojs/core';
import { csrfField } from '@kovojs/server';
import { Badge } from '@kovojs/ui/badge';
import { Button } from '@kovojs/ui/button';
import { Card } from '@kovojs/ui/card';

import { soCsrf } from '../mutations.js';
import { questionList, questionScore } from '../queries.js';
import type { SoRequest } from '../runtime.js';
import { postQuestionForm, type QuestionListItem } from '../types.js';
import {
  freshId,
  parseTags,
  renderAuthor,
  renderTags,
  voteButton,
} from '../components/chrome.js';
import { componentLiveTargetRenderer, registerGeneratedLiveTargetRenderer } from '@kovojs/server/internal/wire';


// Question list (route `/`). Reads the full `questionList` rowset used by this
// UI and the `questionScore` scalar (SUM over votes).
// SPEC.md §4.8: the query-backed component root derives its `kovo-fragment-target`
// in the generated module, so generated enhanced refresh can re-render this
// region with server-truth scores — no hand-authored target string.
//
// Restyled with @kovojs/ui (SPEC.md §6.1.1): each row is a Card, tags are Badges,
// the composer uses a Button, and authors get an Avatar byline. The presentational
// The presentational fields (authorName / tags / createdAt / body) are part of
// the declared query shape, not a separate page loader, so generated enhanced
// refresh can rerender the list from query data alone (SPEC.md §10.2).

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
        <span class="so-row-stat-num tabular-nums">{escapeText(question.answerCount)}</span>
        <span class="so-row-stat-label">answers</span>
      </div>
      <div class="so-row-main">
        <a class="so-row-title" href={`/questions/${question.id}`}>
          {escapeText(question.title)}
        </a>
        {question.body ? <p class="so-row-excerpt">{escapeText(question.body)}</p> : ''}
        <div class="so-row-meta">
          {renderTags(tags)}
          {renderAuthor(question.authorName, question.createdAt, 'asked')}
        </div>
      </div>
    </div>
  );
  // `kovo-key` stays on the keyed child of the list fragment host (§9.1 morph);
  // the @kovojs/ui Card provides the surface inside it.
  return <li kovo-key={question.id}>{Card.definition.render({ children: body })}</li>;
}

// The interactive region, rendered both inside the full page and as the voteUp /
// postQuestion fragment payload. SPEC.md §4.8: the query-backed component root
// derives its `kovo-fragment-target` in the generated module.
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
      <div class="so-stack" kovo-c="question-list-region" kovo-deps="questionList questionScore" kovo-fragment-target="question-list-region" kovo-live-component="components/question-list/question-list-region">
        <div class="so-page-head">
          <div>
            <h1 class="so-page-title">Top questions</h1>
            <p class="so-page-sub">
              {escapeText(questions.length)} questions ·{' '}
              <span class="font-semibold tabular-nums text-slate-700">{totalVotes}</span> votes cast
            </p>
          </div>
          {Badge.definition.render({ children: 'Newest', variant: 'success' })}
        </div>

        {/* SPEC.md §6.3: a no-JS "ask question" form. POSTs to the postQuestion
          mutation; the fragment re-renders this whole region so the new row
          appears and the composer resets (with a fresh id). Authored directly in
          the component render (not wrapped in Card.definition.render) so the
          compiler lowers `mutation={...}` consistently; `so-composer` gives the
          card surface. */}
        <form enhance method="post" action="/_m/postQuestion" data-mutation="postQuestion" kovo-fragment-target="post-question-mutation" class="so-composer">
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
          {FormError({ "failure": slots.forms.postQuestion.failure, "code": "DUPLICATE_TITLE", "class": "so-form-error", "message": (failure: DuplicateTitleFailure) =>
              `A question titled "${failure.payload.title}" already exists.` })}
        </form>

        <ul class="so-list">
          {questions.map((question) => renderQuestionRow(question, slots.request))}
        </ul>
      </div>
    );
  },
});
QuestionListRegion.name = "components/question-list/question-list-region";

export const QuestionListRegion$liveTargetRenderer = registerGeneratedLiveTargetRenderer(componentLiveTargetRenderer({
  component: QuestionListRegion,
  componentId: "components/question-list/question-list-region",
  queries: [
    {
      name: "questionList",
      query: questionList,
    },
    {
      name: "questionScore",
      query: questionScore,
    },
  ],
}));
