/** @jsxImportSource @kovojs/server */
import { postQuestionMutation } from '../mutations.js';
import type { QuestionListItem } from '../types.js';
import { freshId, renderSoShell, voteButton } from './chrome.js';

// Question list (route `/`). Reads the `questionList` rowset (id/title/score/
// answerCount — each a column the postQuestion / postAnswer / voteUp derived
// optimistic transforms patch) and the `questionScore` scalar (SUM over votes).
// Each row links to its `/questions/:id` detail page and carries an upvote form
// (SPEC.md §6.3): a no-JS POST to `/_m/voteUp` that the inline loader upgrades to
// the §9.1 fragment wire. The whole region is a `kovo-fragment-target` host so the
// voteUp mutationResponse can re-render it with server-truth scores.

export const QUESTION_LIST_TARGET = 'so-question-list';

export interface QuestionListPageData {
  questions: QuestionListItem[];
  totalVotes: number;
}

// The interactive region, rendered both inside the full page and as the voteUp /
// postQuestion fragment payload (target = QUESTION_LIST_TARGET).
export function renderQuestionListRegion({ questions, totalVotes }: QuestionListPageData): string {
  return (
    <div class="space-y-5" kovo-fragment-target={QUESTION_LIST_TARGET}>
      <div class="flex items-end justify-between">
        <div>
          <h1 class="text-2xl font-bold tracking-tight">Top questions</h1>
          <p class="mt-1 text-sm text-slate-600">
            {questions.length} questions ·{' '}
            <span class="font-semibold tabular-nums text-slate-700">{totalVotes}</span> votes cast
          </p>
        </div>
      </div>

      {/* SPEC.md §6.3: a no-JS "ask question" form. POSTs to the postQuestion
          mutation; the fragment re-renders this whole region so the new row
          appears and the composer resets (with a fresh id). The text primary key
          is minted at render time so each submission is unique. */}
      <form
        enhance
        mutation={postQuestionMutation}
        class="rounded-lg border border-slate-200 bg-white p-4"
      >
        <input type="hidden" name="id" value={freshId('q')} />
        <input type="hidden" name="authorId" value="demo-viewer" />
        <div class="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-start">
          <div class="grid gap-2">
            <input
              name="title"
              required
              placeholder="Question title"
              class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
            <textarea
              name="body"
              required
              rows="2"
              placeholder="What are the details?"
              class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <button
            type="submit"
            class="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700"
          >
            Ask question
          </button>
        </div>
      </form>

      <ul class="divide-y divide-slate-200 overflow-hidden rounded-lg border border-slate-200 bg-white">
        {questions.map((question) => (
          <li class="flex items-start gap-4 p-4">
            {voteButton(question.id, question.score)}
            <div class="flex w-16 shrink-0 flex-col items-center">
              <span class="text-base font-semibold tabular-nums text-slate-700">
                {question.answerCount}
              </span>
              <span class="text-[10px] uppercase tracking-wide text-slate-500">answers</span>
            </div>
            <div class="min-w-0 flex-1">
              <a
                class="font-medium text-sky-700 underline-offset-2 hover:underline"
                href={`/questions/${question.id}`}
              >
                {question.title}
              </a>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function renderQuestionListPage(data: QuestionListPageData): string {
  return renderSoShell(renderQuestionListRegion(data));
}
