// @kovojs-ir — lowered from examples/stackoverflow/src/components/question-detail.tsx by @kovojs/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit-components`.
/** @jsxImportSource @kovojs/server */
import { escapeText } from '@kovojs/server/internal/html';
import { component } from '@kovojs/core';
import { csrfField } from '@kovojs/server';
import * as style from '@kovojs/style';

import { soCsrf } from '../mutations.js';
import { questionAnswers, questionDetail } from '../queries.js';
import type { QuestionAnswersResult, QuestionDetailResult, SoRequest } from '../model.js';
import {
  compactCount,
  freshId,
  parseTags,
  relativeTime,
  renderTags,
  renderUserCard,
  viewsFor,
  voteButton,
} from '../components/chrome.js';
import { componentLiveTargetRenderer, registerGeneratedLiveTargetRenderer } from '@kovojs/server/internal/wire';


// Question detail for `/questions/:id`: the question post, its answers, and the
// answer composer — laid out like a Stack Overflow question page (vote gutter,
// post body, tags, user card, then the answer list and "Your Answer" form).

const detailStyles = style.create(
  {
    // ---- Question header -----------------------------------------------------
    header: {
      borderBottomColor: '#e3e6e8',
      borderBottomStyle: 'solid',
      borderBottomWidth: 1,
      paddingBlockEnd: 12,
    },
    titleRow: {
      alignItems: 'flex-start',
      display: 'flex',
      gap: 16,
      justifyContent: 'space-between',
    },
    detailTitle: {
      color: '#0c0d0e',
      fontSize: 27,
      fontWeight: 400,
      lineHeight: 1.3,
      margin: 0,
    },
    askButton: {
      backgroundColor: '#0a95ff',
      borderColor: '#0a95ff',
      borderRadius: 4,
      borderStyle: 'solid',
      borderWidth: 1,
      color: '#ffffff',
      flexShrink: 0,
      fontSize: 13,
      paddingBlock: 10,
      paddingInline: 11,
      textDecoration: 'none',
      ':hover': { backgroundColor: '#0074cc' },
    },
    metaRow: {
      color: '#525960',
      display: 'flex',
      flexWrap: 'wrap',
      fontSize: 13,
      gap: 16,
      marginBlockStart: 8,
    },
    metaLabel: { color: '#6a737c' },
    metaValue: { color: '#232629' },
    // ---- Post (question + answer) layout ------------------------------------
    post: {
      borderBottomColor: '#e3e6e8',
      borderBottomStyle: 'solid',
      borderBottomWidth: 1,
      display: 'flex',
      gap: 16,
      paddingBlock: 16,
    },
    gutter: {
      alignItems: 'center',
      display: 'flex',
      flexDirection: 'column',
      flexShrink: 0,
      gap: 2,
      width: 42,
    },
    acceptMark: {
      color: '#3d8b5f',
      fontSize: 28,
      lineHeight: 1,
      marginBlockStart: 4,
    },
    postMain: {
      display: 'grid',
      flex: '1 1 0%',
      gap: 14,
      minWidth: 0,
    },
    body: {
      color: '#0c0d0e',
      fontSize: 15,
      lineHeight: 1.65,
      margin: 0,
      whiteSpace: 'pre-wrap',
    },
    postFooter: {
      alignItems: 'flex-end',
      display: 'flex',
      flexWrap: 'wrap',
      gap: 12,
      justifyContent: 'space-between',
    },
    // ---- Answers -------------------------------------------------------------
    answersHead: {
      alignItems: 'center',
      display: 'flex',
      gap: 12,
      justifyContent: 'space-between',
      marginBlockStart: 24,
    },
    answersTitle: {
      color: '#0c0d0e',
      fontSize: 19,
      fontWeight: 400,
      margin: 0,
    },
    answerList: {
      listStyle: 'none',
      margin: 0,
      padding: 0,
    },
    acceptedNote: {
      alignItems: 'center',
      color: '#3d8b5f',
      display: 'inline-flex',
      fontSize: 13,
      fontWeight: 600,
      gap: 4,
    },
    // ---- Answer composer -----------------------------------------------------
    composer: {
      display: 'grid',
      gap: 12,
      marginBlockStart: 28,
    },
    composerTitle: {
      color: '#0c0d0e',
      fontSize: 19,
      fontWeight: 400,
      margin: 0,
    },
    input: {
      backgroundColor: '#ffffff',
      borderColor: '#d6d9dc',
      borderRadius: 4,
      borderStyle: 'solid',
      borderWidth: 1,
      boxSizing: 'border-box',
      color: '#0c0d0e',
      fontSize: 13,
      paddingBlock: 9,
      paddingInline: 11,
      width: '100%',
      ':focus': {
        borderColor: '#0a95ff',
        boxShadow: '0 0 0 4px rgba(10,149,255,0.15)',
        outline: 'none',
      },
    },
    textarea: {
      lineHeight: 1.5,
      resize: 'vertical',
    },
    composerActions: {
      display: 'flex',
      justifyContent: 'flex-start',
    },
    submitButton: {
      backgroundColor: '#0a95ff',
      borderColor: '#0a95ff',
      borderRadius: 4,
      borderStyle: 'solid',
      borderWidth: 1,
      color: '#ffffff',
      fontSize: 13,
      paddingBlock: 10,
      paddingInline: 11,
      ':hover': { backgroundColor: '#0074cc' },
    },
    // ---- Not-found ----------------------------------------------------------
    notFound: {
      color: '#525960',
      fontSize: 15,
      paddingBlock: 24,
    },
    back: {
      alignItems: 'center',
      color: '#0074cc',
      display: 'inline-flex',
      fontSize: 13,
      gap: 6,
      marginBlockEnd: 12,
      textDecoration: 'none',
      ':hover': { color: '#0a95ff' },
    },
  },
  {
    namespace: 'so-question-detail',
    source: 'examples/stackoverflow/src/components/question-detail.tsx',
  },
);

export const questionDetailStyleCss = style.emitAtomicCss(
  Object.values(detailStyles).flatMap((entry) => entry.__rules ?? []),
);

function renderQuestionPost(question: QuestionDetailResult): string {
  const tags = parseTags(question.tags);
  return (
    <div class="kv-so-question-detail-bd-kwhl8f kv-so-question-detail-bd-1vmam9 kv-so-question-detail-bd-1ejcbg kv-so-question-detail-d-jy75d0 kv-so-question-detail-gap-nmk0hq kv-so-question-detail-pad-obunk5" data-style-src="examples/stackoverflow/src/components/question-detail.tsx#post">
      <div class="kv-so-question-detail-align-2jhe1z kv-so-question-detail-d-jy75d0 kv-so-question-detail-flex-q7fd9t kv-so-question-detail-flex-1mn74f kv-so-question-detail-gap-18dfnj kv-so-question-detail-w-h0fjz8" data-style-src="examples/stackoverflow/src/components/question-detail.tsx#gutter">{voteButton(question.id, question.score)}</div>
      <div class="kv-so-question-detail-d-1dxv0v kv-so-question-detail-flex-1ynj25 kv-so-question-detail-gap-5g0s03 kv-so-question-detail-min-1fkr8a" data-style-src="examples/stackoverflow/src/components/question-detail.tsx#postMain">
        <p class="kv-so-question-detail-fg-nyp0a6 kv-so-question-detail-font-1pvhh9 kv-so-question-detail-line-1mgty7 kv-so-question-detail-m-y3y9fs kv-so-question-detail-white-pdgkgl" data-style-src="examples/stackoverflow/src/components/question-detail.tsx#body" data-bind="question.body">{question.body}</p>
        <div class="kv-so-question-detail-align-1d31i4 kv-so-question-detail-d-jy75d0 kv-so-question-detail-flex-105auz kv-so-question-detail-gap-1kzh7g kv-so-question-detail-justify-1itcj7" data-style-src="examples/stackoverflow/src/components/question-detail.tsx#postFooter">
          {renderTags(tags)}
          {question.authorName
            ? renderUserCard(question.authorName, question.createdAt, 'asked')
            : ''}
        </div>
      </div>
    </div>
  );
}

function renderAnswerPost(answer: QuestionAnswersResult[number]): string {
  return (
    <li kovo-key={answer.id} class="kv-so-question-detail-bd-kwhl8f kv-so-question-detail-bd-1vmam9 kv-so-question-detail-bd-1ejcbg kv-so-question-detail-d-jy75d0 kv-so-question-detail-gap-nmk0hq kv-so-question-detail-pad-obunk5" data-style-src="examples/stackoverflow/src/components/question-detail.tsx#post">
      <div class="kv-so-question-detail-align-2jhe1z kv-so-question-detail-d-jy75d0 kv-so-question-detail-flex-q7fd9t kv-so-question-detail-flex-1mn74f kv-so-question-detail-gap-18dfnj kv-so-question-detail-w-h0fjz8" data-style-src="examples/stackoverflow/src/components/question-detail.tsx#gutter">
        <span class="kv-so-question-detail-fg-nyp0a6 kv-so-question-detail-font-1pvhh9 kv-so-question-detail-line-1mgty7 kv-so-question-detail-m-y3y9fs kv-so-question-detail-white-pdgkgl" data-style-src="examples/stackoverflow/src/components/question-detail.tsx#body" />
        {/* Answer scores are static in the demo (only questions are votable). */}
        {answer.accepted ? <span class="kv-so-question-detail-fg-ljwovw kv-so-question-detail-font-f9z56h kv-so-question-detail-line-dda06t kv-so-question-detail-m-h0qmvb" data-style-src="examples/stackoverflow/src/components/question-detail.tsx#acceptMark">&#10003;</span> : ''}
      </div>
      <div class="kv-so-question-detail-d-1dxv0v kv-so-question-detail-flex-1ynj25 kv-so-question-detail-gap-5g0s03 kv-so-question-detail-min-1fkr8a" data-style-src="examples/stackoverflow/src/components/question-detail.tsx#postMain">
        {answer.accepted ? (
          <span class="kv-so-question-detail-align-2jhe1z kv-so-question-detail-fg-ljwovw kv-so-question-detail-d-qj87v1 kv-so-question-detail-font-1r07r6 kv-so-question-detail-font-1w39fe kv-so-question-detail-gap-1dksle" data-style-src="examples/stackoverflow/src/components/question-detail.tsx#acceptedNote">
            <span>&#10003;</span> Accepted answer
          </span>
        ) : (
          ''
        )}
        <p class="kv-so-question-detail-fg-nyp0a6 kv-so-question-detail-font-1pvhh9 kv-so-question-detail-line-1mgty7 kv-so-question-detail-m-y3y9fs kv-so-question-detail-white-pdgkgl" data-style-src="examples/stackoverflow/src/components/question-detail.tsx#body">{escapeText(answer.body)}</p>
        <div class="kv-so-question-detail-align-1d31i4 kv-so-question-detail-d-jy75d0 kv-so-question-detail-flex-105auz kv-so-question-detail-gap-1kzh7g kv-so-question-detail-justify-1itcj7" data-style-src="examples/stackoverflow/src/components/question-detail.tsx#postFooter">
          <span />
          {answer.authorName
            ? renderUserCard(answer.authorName, answer.createdAt, 'answered')
            : ''}
        </div>
      </div>
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
  render: (
    {
      answers,
      question,
      questionId,
    }: {
      answers: QuestionAnswersResult;
      question: QuestionDetailResult | null;
      questionId: string;
    },
    _state,
    slots: { request?: SoRequest | undefined } = {},
  ) => {
    if (!question) {
      return (
        <div>
          <a class="kv-so-question-detail-align-2jhe1z kv-so-question-detail-fg-1nfq4g kv-so-question-detail-d-qj87v1 kv-so-question-detail-font-1r07r6 kv-so-question-detail-gap-wnp2vs kv-so-question-detail-m-13jyn0 kv-so-question-detail-text-1tmi32 kv-so-question-detail-fg-1q8lbp" data-style-src="examples/stackoverflow/src/components/question-detail.tsx#back" href="/">
            &larr; All questions
          </a>
          <h1 class="kv-so-question-detail-fg-nyp0a6 kv-so-question-detail-font-16f4mn kv-so-question-detail-font-9f23sq kv-so-question-detail-line-2594qw kv-so-question-detail-m-y3y9fs" data-style-src="examples/stackoverflow/src/components/question-detail.tsx#detailTitle">Question not found</h1>
          <p class="kv-so-question-detail-fg-1jds7t kv-so-question-detail-font-1pvhh9 kv-so-question-detail-pad-qbrctf" data-style-src="examples/stackoverflow/src/components/question-detail.tsx#notFound">
            This question does not exist (it may have been a demo that reset).
          </p>
        </div>
      );
    }

    const views = viewsFor(question.id, question.score);
    const asked = question.createdAt ? relativeTime(question.createdAt) : 'recently';
    return (
      <div kovo-c="question-detail-region" kovo-deps="answers question" kovo-fragment-target="question-detail-region" kovo-live-component="components/question-detail/question-detail-region" kovo-props={JSON.stringify({ questionId })}>
        <div class="kv-so-question-detail-bd-kwhl8f kv-so-question-detail-bd-1vmam9 kv-so-question-detail-bd-1ejcbg kv-so-question-detail-pad-20gjt8" data-style-src="examples/stackoverflow/src/components/question-detail.tsx#header">
          <div class="kv-so-question-detail-align-16ko5n kv-so-question-detail-d-jy75d0 kv-so-question-detail-gap-nmk0hq kv-so-question-detail-justify-1itcj7" data-style-src="examples/stackoverflow/src/components/question-detail.tsx#titleRow">
            <h1 class="kv-so-question-detail-fg-nyp0a6 kv-so-question-detail-font-16f4mn kv-so-question-detail-font-9f23sq kv-so-question-detail-line-2594qw kv-so-question-detail-m-y3y9fs" data-style-src="examples/stackoverflow/src/components/question-detail.tsx#detailTitle" data-bind="question.title">{question.title}</h1>
            <a href="#your-answer" class="kv-so-question-detail-bg-nl1060 kv-so-question-detail-bd-12ru5p kv-so-question-detail-bd-sdq6l5 kv-so-question-detail-bd-1xrysw kv-so-question-detail-bd-17zwtb kv-so-question-detail-fg-1g4csz kv-so-question-detail-flex-1mn74f kv-so-question-detail-font-1r07r6 kv-so-question-detail-pad-1tf3mn kv-so-question-detail-pad-qqgusf kv-so-question-detail-text-1tmi32 kv-so-question-detail-bg-wz972k" data-style-src="examples/stackoverflow/src/components/question-detail.tsx#askButton">
              Ask Question
            </a>
          </div>
          <div class="kv-so-question-detail-fg-1jds7t kv-so-question-detail-d-jy75d0 kv-so-question-detail-flex-105auz kv-so-question-detail-font-1r07r6 kv-so-question-detail-gap-nmk0hq kv-so-question-detail-m-yf5rqr" data-style-src="examples/stackoverflow/src/components/question-detail.tsx#metaRow">
            <span>
              <span class="kv-so-question-detail-fg-11mxx3" data-style-src="examples/stackoverflow/src/components/question-detail.tsx#metaLabel">Asked</span>{' '}
              <span class="kv-so-question-detail-fg-13smdb" data-style-src="examples/stackoverflow/src/components/question-detail.tsx#metaValue">{asked}</span>
            </span>
            <span>
              <span class="kv-so-question-detail-fg-11mxx3" data-style-src="examples/stackoverflow/src/components/question-detail.tsx#metaLabel">Viewed</span>{' '}
              <span class="kv-so-question-detail-fg-13smdb" data-style-src="examples/stackoverflow/src/components/question-detail.tsx#metaValue">{`${compactCount(views)} times`}</span>
            </span>
          </div>
        </div>

        {renderQuestionPost(question)}

        <div class="kv-so-question-detail-align-2jhe1z kv-so-question-detail-d-jy75d0 kv-so-question-detail-gap-1kzh7g kv-so-question-detail-justify-1itcj7 kv-so-question-detail-m-1evyw8" data-style-src="examples/stackoverflow/src/components/question-detail.tsx#answersHead">
          <h2 class="kv-so-question-detail-fg-nyp0a6 kv-so-question-detail-font-52ufbn kv-so-question-detail-font-9f23sq kv-so-question-detail-m-y3y9fs" data-style-src="examples/stackoverflow/src/components/question-detail.tsx#answersTitle">
            <span data-bind="question.answerCount">{question.answerCount}</span> {question.answerCount === 1 ? 'Answer' : 'Answers'}
          </h2>
        </div>
        <ul class="kv-so-question-detail-list-j3t69x kv-so-question-detail-m-y3y9fs kv-so-question-detail-pad-1ofj5a" data-style-src="examples/stackoverflow/src/components/question-detail.tsx#answerList">{answers.map(renderAnswerPost)}</ul>

        {/* Native form; enhanced submissions refresh this whole region. */}
        <form
          enhance
          method="post" action="/_m/postAnswer" data-mutation="postAnswer" kovo-fragment-target="post-answer-mutation"
          id="your-answer"
          class="kv-so-question-detail-d-1dxv0v kv-so-question-detail-gap-1kzh7g kv-so-question-detail-m-1qc9py" data-style-src="examples/stackoverflow/src/components/question-detail.tsx#composer"
        >
          {/* Compiler-lowered form: add the CSRF field explicitly (see the note on
              the question-list composer). */}
          {slots.request ? csrfField(slots.request, soCsrf) : ''}
          <input type="hidden" name="id" value={freshId('a')} />
          <input type="hidden" name="questionId" value={questionId} />
          <input type="hidden" name="authorId" value="demo-viewer" />
          <h2 class="kv-so-question-detail-fg-nyp0a6 kv-so-question-detail-font-52ufbn kv-so-question-detail-font-9f23sq kv-so-question-detail-m-y3y9fs" data-style-src="examples/stackoverflow/src/components/question-detail.tsx#composerTitle">Your Answer</h2>
          <textarea
            id="answer-body"
            name="body"
            required
            rows="6"
            placeholder="Share what you know — code and reasoning welcome…"
            class="kv-so-question-detail-bg-1r5soy kv-so-question-detail-bd-v1fzj4 kv-so-question-detail-bd-sdq6l5 kv-so-question-detail-bd-1xrysw kv-so-question-detail-bd-17zwtb kv-so-question-detail-box-1gvzd3 kv-so-question-detail-fg-nyp0a6 kv-so-question-detail-font-1r07r6 kv-so-question-detail-pad-i3n451 kv-so-question-detail-pad-qqgusf kv-so-question-detail-w-lhhf6b kv-so-question-detail-bd-m5fnx7 kv-so-question-detail-box-1g9a2w kv-so-question-detail-outline-405iyf kv-so-question-detail-line-1fg3ha kv-so-question-detail-resize-bvf20l" data-style-src="examples/stackoverflow/src/components/question-detail.tsx#input; examples/stackoverflow/src/components/question-detail.tsx#textarea"
          />
          <div class="kv-so-question-detail-d-jy75d0 kv-so-question-detail-justify-12aoua" data-style-src="examples/stackoverflow/src/components/question-detail.tsx#composerActions">
            <button type="submit" class="kv-so-question-detail-bg-nl1060 kv-so-question-detail-bd-12ru5p kv-so-question-detail-bd-sdq6l5 kv-so-question-detail-bd-1xrysw kv-so-question-detail-bd-17zwtb kv-so-question-detail-fg-1g4csz kv-so-question-detail-font-1r07r6 kv-so-question-detail-pad-1tf3mn kv-so-question-detail-pad-qqgusf kv-so-question-detail-bg-wz972k" data-style-src="examples/stackoverflow/src/components/question-detail.tsx#submitButton">
              Post Your Answer
            </button>
          </div>
        </form>
      </div>
    );
  },
});
QuestionDetailRegion.name = "components/question-detail/question-detail-region";

export const QuestionDetailRegion$liveTargetRenderer = registerGeneratedLiveTargetRenderer(componentLiveTargetRenderer({
  component: QuestionDetailRegion,
  componentId: "components/question-detail/question-detail-region",
}));
