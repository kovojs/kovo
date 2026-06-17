/** @jsxImportSource @kovojs/server */
import { postAnswerMutation } from '../mutations.js';
import type { AnswerListItem } from '../types.js';
import { freshId, renderSoShell, voteButton } from './chrome.js';

// Question detail (route `/questions/:id`). Shows the question and its answers
// (filtered from `answerList` by questionId), with the accepted answer flagged.
// This is the page the question list rows link into. The whole region is a
// `kovo-fragment-target` host so the voteUp / postAnswer mutationResponse can
// re-render it from server truth: upvoting the question and posting an answer
// both morph this region in place (SPEC.md §9.1).

export const QUESTION_DETAIL_TARGET = 'so-question-detail';

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

// The interactive region, rendered inside the page and as the voteUp / postAnswer
// fragment payload (target = QUESTION_DETAIL_TARGET).
export function renderQuestionDetailRegion({ question, answers }: QuestionDetailPageData): string {
  return (
    <div class="space-y-6" kovo-fragment-target={QUESTION_DETAIL_TARGET}>
      <a
        class="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900"
        href="/"
      >
        &larr; All questions
      </a>

      <article class="flex items-start gap-4 rounded-lg border border-slate-200 bg-white p-5">
        {voteButton(question.id, question.score)}
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
              <span class="flex w-12 shrink-0 flex-col items-center text-slate-500">
                <span class="text-xs leading-none">&#9650;</span>
                <span class="text-base font-semibold tabular-nums text-slate-700">
                  {answer.score}
                </span>
                <span class="text-[10px] uppercase tracking-wide">votes</span>
              </span>
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

        {/* SPEC.md §6.3: a no-JS "post answer" form. POSTs to the postAnswer
            mutation; the fragment re-renders this whole region so the new answer
            and bumped count appear and the composer resets (fresh id). */}
        <form
          enhance
          mutation={postAnswerMutation}
          class="mt-4 rounded-lg border border-slate-200 bg-white p-4"
        >
          <input type="hidden" name="id" value={freshId('a')} />
          <input type="hidden" name="questionId" value={question.id} />
          <input type="hidden" name="authorId" value="demo-viewer" />
          <label class="block text-sm font-semibold text-slate-700" for="answer-body">
            Your answer
          </label>
          <textarea
            id="answer-body"
            name="body"
            required
            rows="3"
            placeholder="Share what you know…"
            class="mt-2 w-full rounded-md border border-slate-300 p-2 text-sm"
          />
          <button
            type="submit"
            class="mt-2 rounded-md bg-orange-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-orange-600"
          >
            Post answer
          </button>
        </form>
      </section>
    </div>
  );
}

export function renderQuestionDetailPage(data: QuestionDetailPageData): string {
  return renderSoShell(renderQuestionDetailRegion(data));
}
