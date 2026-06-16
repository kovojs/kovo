/** @jsxImportSource @kovojs/server */
import type { QuestionListItem } from '../types.js';
import { renderSoShell, voteButton } from './chrome.js';

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
