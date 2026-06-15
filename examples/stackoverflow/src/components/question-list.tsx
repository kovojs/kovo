/** @jsxImportSource @jiso/server */
import type { QuestionListItem } from '../types.js';
import { renderSoShell, score } from './chrome.js';

// Question list (route `/`). Reads the `questionList` rowset (id/title/score/
// answerCount — each a column the postQuestion / postAnswer / voteUp derived
// optimistic transforms patch) and the `questionScore` scalar (SUM over votes).
// Each row links to its `/questions/:id` detail page.

export interface QuestionListPageData {
  questions: QuestionListItem[];
  totalVotes: number;
}

export function renderQuestionListPage({ questions, totalVotes }: QuestionListPageData): string {
  const body = (
    <div class="space-y-5">
      <div class="flex items-end justify-between">
        <div>
          <h1 class="text-2xl font-bold tracking-tight">Top questions</h1>
          <p class="mt-1 text-sm text-slate-600">
            {questions.length} questions · {totalVotes} votes cast
          </p>
        </div>
      </div>

      <ul class="divide-y divide-slate-200 overflow-hidden rounded-lg border border-slate-200 bg-white">
        {questions.map((question) => (
          <li class="flex items-start gap-4 p-4">
            {score(question.score)}
            <div class="flex w-16 shrink-0 flex-col items-center">
              <span class="text-base font-semibold tabular-nums text-slate-700">{question.answerCount}</span>
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

  return renderSoShell(body);
}
