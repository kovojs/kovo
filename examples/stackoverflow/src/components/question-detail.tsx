/** @jsxImportSource @jiso/server */
import type { AnswerListItem } from '../types.js';
import { renderSoShell, score } from './chrome.js';

// Question detail (route `/questions/:id`). Shows the question and its answers
// (filtered from `answerList` by questionId), with the accepted answer flagged.
// This is the page the question list rows link into.

export interface QuestionDetail {
  id: string;
  title: string;
  body: string;
  authorId: string;
  score: number;
  answerCount: number;
}

export interface AnswerDetail extends AnswerListItem {
  accepted: boolean;
  authorId: string;
}

export interface QuestionDetailPageData {
  question: QuestionDetail;
  answers: AnswerDetail[];
}

export function renderQuestionDetailPage({ question, answers }: QuestionDetailPageData): string {
  const body = (
    <div class="space-y-6">
      <a
        class="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900"
        href="/"
      >
        &larr; All questions
      </a>

      <article class="flex items-start gap-4 rounded-lg border border-slate-200 bg-white p-5">
        {score(question.score)}
        <div class="min-w-0 flex-1">
          <h1 class="text-xl font-bold tracking-tight">{question.title}</h1>
          <p class="mt-2 text-sm leading-relaxed text-slate-700">{question.body}</p>
          <p class="mt-3 text-xs text-slate-400">asked by {question.authorId}</p>
        </div>
      </article>

      <section>
        <h2 class="mb-3 text-sm font-semibold text-slate-700">
          {question.answerCount} {question.answerCount === 1 ? 'Answer' : 'Answers'}
        </h2>
        <ul class="space-y-3">
          {answers.map((answer) => (
            <li
              class={`flex items-start gap-4 rounded-lg border bg-white p-5 ${
                answer.accepted ? 'border-emerald-300 ring-1 ring-emerald-100' : 'border-slate-200'
              }`}
            >
              {score(answer.score)}
              <div class="min-w-0 flex-1">
                {answer.accepted ? (
                  <p class="mb-1 inline-flex items-center gap-1 text-xs font-medium text-emerald-600">
                    &#10003; Accepted
                  </p>
                ) : (
                  ''
                )}
                <p class="text-sm leading-relaxed text-slate-700">{answer.body}</p>
                <p class="mt-3 text-xs text-slate-400">answered by {answer.authorId}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );

  return renderSoShell(body);
}
