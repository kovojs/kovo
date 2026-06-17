// @kovojs-ir — lowered from examples/stackoverflow/src/components/question-list.tsx by @kovojs/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit-components`.
/** @jsxImportSource @kovojs/server */
import { escapeText } from '@kovojs/server/internal/html';
import { component } from '@kovojs/core';
import { Badge } from '@kovojs/ui/badge';
import { Button } from '@kovojs/ui/button';
import { Card } from '@kovojs/ui/card';

import { questionList, questionScore } from '../queries.js';
import type { QuestionListItem } from '../types.js';
import {
  freshId,
  parseTags,
  renderAuthor,
  renderSoShell,
  renderTags,
  voteButton,
} from '../components/chrome.js';
import { componentLiveTargetRenderer } from '@kovojs/server/internal/wire';


// Question list (route `/`). Reads the `questionList` rowset (id/title/score/
// answerCount — each a column the postQuestion / postAnswer / voteUp derived
// optimistic transforms patch) and the `questionScore` scalar (SUM over votes).
// SPEC.md §4.8: the query-backed component root derives its `kovo-fragment-target`
// in the generated module, so the voteUp / postQuestion mutationResponse can
// re-render this region with server-truth scores — no hand-authored target string.
//
// Restyled with @kovojs/ui (SPEC.md §6.1.1): each row is a Card, tags are Badges,
// the composer uses a Button, and authors get an Avatar byline. The presentational
// fields (authorName / tags / createdAt / excerpt) ride alongside the proven query
// columns — they are NOT part of the §10.5 query shape, so a fragment re-render
// that only has the bare query columns still renders cleanly (the helpers default).

export const QUESTION_LIST_TARGET = 'question-list-region';

// The query item plus optional presentational fields the render path enriches in.
// The fragment re-render from server truth supplies these too (interactive-app
// joins them on), but every field is optional so a bare query item still renders.
export interface QuestionRow extends QuestionListItem {
  authorName?: string;
  tags?: string;
  createdAt?: string;
  excerpt?: string;
}

export interface QuestionListPageData {
  questions: QuestionRow[];
  totalVotes: number;
}

type QuestionListQueryResult = Awaited<ReturnType<typeof questionList.load>>;
type QuestionScoreQueryResult = Awaited<ReturnType<typeof questionScore.load>>;

function renderQuestionRow(question: QuestionRow): string {
  const tags = parseTags(question.tags);
  const body = (
    <div class="so-row">
      {voteButton(question.id, question.score)}
      <div class="so-row-stat">
        <span class="so-row-stat-num tabular-nums">{escapeText(question.answerCount)}</span>
        <span class="so-row-stat-label">answers</span>
      </div>
      <div class="so-row-main">
        <a class="so-row-title" href={`/questions/${question.id}`}>
          {escapeText(question.title)}
        </a>
        {question.excerpt ? <p class="so-row-excerpt">{escapeText(question.excerpt)}</p> : ''}
        <div class="so-row-meta">
          {renderTags(tags)}
          {question.authorName
            ? renderAuthor(question.authorName, question.createdAt, 'asked')
            : ''}
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
  queries: { questionList, questionScore },
  render: ({
    questionList,
    questionScore,
  }: {
    questionList: QuestionListQueryResult;
    questionScore: QuestionScoreQueryResult;
  }) => {
    const questions = questionList.items as QuestionRow[];
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
        </form>

        <ul class="so-list">{questions.map(renderQuestionRow)}</ul>
      </div>
    );
  },
});
QuestionListRegion.name = "components/question-list/question-list-region";

export function renderQuestionListRegion({ questions, totalVotes }: QuestionListPageData): string {
  return QuestionListRegion.definition.render({
    questionList: { items: questions },
    questionScore: { score: totalVotes },
  });
}

export function renderQuestionListPage(data: QuestionListPageData): string {
  return renderSoShell(renderQuestionListRegion(data));
}

export const QuestionListRegion$liveTargetRenderer = componentLiveTargetRenderer({
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
});
