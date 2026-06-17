/** @jsxImportSource @kovojs/server */
import { Badge } from '@kovojs/ui/badge';
import { Button } from '@kovojs/ui/button';
import { Card } from '@kovojs/ui/card';

import type { QuestionListItem } from '../types.js';
import { freshId, parseTags, renderAuthor, renderSoShell, renderTags, voteButton } from './chrome.js';

// Question list (route `/`). Reads the `questionList` rowset (id/title/score/
// answerCount — each a column the postQuestion / postAnswer / voteUp derived
// optimistic transforms patch) and the `questionScore` scalar (SUM over votes).
// Each row links to its `/questions/:id` detail page and carries an upvote form
// (SPEC.md §6.3): a no-JS POST to `/_m/voteUp` that the inline loader upgrades to
// the §9.1 fragment wire. The whole region is a `kovo-fragment-target` host so the
// voteUp mutationResponse can re-render it with server-truth scores.
//
// Restyled with @kovojs/ui (SPEC.md §6.1.1): each row is a Card, tags are Badges,
// the composer uses a Button, and authors get an Avatar byline. The presentational
// fields (authorName / tags / createdAt / excerpt) ride alongside the proven query
// columns — they are NOT part of the §10.5 query shape, so a fragment re-render
// that only has the bare query columns still renders cleanly (the helpers default).

export const QUESTION_LIST_TARGET = 'so-question-list';

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

function renderQuestionRow(question: QuestionRow): string {
  const tags = parseTags(question.tags);
  const body = (
    <div class="so-row">
      {voteButton(question.id, question.score)}
      <div class="so-row-stat">
        <span class="so-row-stat-num tabular-nums">{question.answerCount}</span>
        <span class="so-row-stat-label">answers</span>
      </div>
      <div class="so-row-main">
        <a class="so-row-title" href={`/questions/${question.id}`}>
          {question.title}
        </a>
        {question.excerpt ? <p class="so-row-excerpt">{question.excerpt}</p> : ''}
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
// postQuestion fragment payload (target = QUESTION_LIST_TARGET).
export function renderQuestionListRegion({ questions, totalVotes }: QuestionListPageData): string {
  const askButton = Button.definition.render({
    variant: 'primary',
    type: 'submit',
    children: 'Ask question',
  });
  return (
    <div class="so-stack" kovo-fragment-target={QUESTION_LIST_TARGET}>
      <div class="so-page-head">
        <div>
          <h1 class="so-page-title">Top questions</h1>
          <p class="so-page-sub">
            {questions.length} questions ·{' '}
            <span class="font-semibold tabular-nums text-slate-700">{totalVotes}</span> votes cast
          </p>
        </div>
        {Badge.definition.render({ variant: 'success', children: 'Newest' })}
      </div>

      {/* SPEC.md §6.3: a no-JS "ask question" form. POSTs to the postQuestion
          mutation; the fragment re-renders this whole region so the new row
          appears and the composer resets (with a fresh id). The text primary key
          is minted at render time so each submission is unique. */}
      {Card.definition.render({
        children: (
          <form
            method="post"
            action="/_m/postQuestion"
            enhance
            data-mutation="postQuestion"
            class="so-composer"
          >
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
        ),
      })}

      <ul class="so-list">{questions.map(renderQuestionRow)}</ul>
    </div>
  );
}

export function renderQuestionListPage(data: QuestionListPageData): string {
  return renderSoShell(renderQuestionListRegion(data));
}
