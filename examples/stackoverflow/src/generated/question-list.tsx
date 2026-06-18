// @kovojs-ir — lowered from examples/stackoverflow/src/components/question-list.tsx by @kovojs/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit-components`.
/** @jsxImportSource @kovojs/server */
import { escapeText } from '@kovojs/server/internal/html';
import { component, FormError, type ComponentRenderSlots } from '@kovojs/core';
import { csrfField } from '@kovojs/server';
import * as style from '@kovojs/style';

import { soCsrf } from '../mutations.js';
import { questionList, questionScore } from '../queries.js';
import { postQuestionForm, type QuestionListItem, type SoRequest } from '../model.js';
import {
  compactCount,
  freshId,
  parseTags,
  renderTags,
  renderUserCard,
  viewsFor,
  voteButton,
} from '../components/chrome.js';
import { componentLiveTargetRenderer, registerGeneratedLiveTargetRenderer } from '@kovojs/server/internal/wire';


// Question list for `/`. It reads the question rowset and total vote score, then
// renders the Stack Overflow "All Questions" header, the filter tabs, the
// question rows (stat rail + title + excerpt + tags + user card), and the
// ask-a-question composer.

type QuestionListQueryResult = Awaited<ReturnType<typeof questionList.load>>;
type QuestionScoreQueryResult = Awaited<ReturnType<typeof questionScore.load>>;
type QuestionListRenderSlots = ComponentRenderSlots<{ postQuestion: typeof postQuestionForm }> & {
  request?: SoRequest | undefined;
};
interface DuplicateTitleFailure {
  code: 'DUPLICATE_TITLE';
  payload: { title: string };
}

const defaultQuestionListRenderSlots: QuestionListRenderSlots = {
  forms: { postQuestion: { failure: null } },
};

const listStyles = style.create(
  {
    // ---- Page header ---------------------------------------------------------
    pageHead: {
      alignItems: 'center',
      display: 'flex',
      gap: 16,
      justifyContent: 'space-between',
      marginBlockEnd: 12,
    },
    pageTitle: {
      color: '#0c0d0e',
      fontSize: 27,
      fontWeight: 400,
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
    subHead: {
      alignItems: 'center',
      display: 'flex',
      flexWrap: 'wrap',
      gap: 12,
      justifyContent: 'space-between',
      marginBlockEnd: 16,
    },
    count: {
      color: '#232629',
      fontSize: 17,
    },
    // ---- Filter tabs ---------------------------------------------------------
    tabs: {
      borderColor: '#d6d9dc',
      borderRadius: 6,
      borderStyle: 'solid',
      borderWidth: 1,
      display: 'inline-flex',
      overflow: 'hidden',
    },
    tab: {
      borderInlineStartColor: '#d6d9dc',
      borderInlineStartStyle: 'solid',
      borderInlineStartWidth: 1,
      color: '#525960',
      fontSize: 13,
      paddingBlock: 8,
      paddingInline: 11,
      textDecoration: 'none',
      ':hover': { backgroundColor: '#f8f9f9', color: '#232629' },
    },
    tabFirst: {
      borderInlineStartWidth: 0,
    },
    tabActive: {
      backgroundColor: '#f1f2f3',
      color: '#232629',
    },
    // ---- Question rows -------------------------------------------------------
    list: {
      borderTopColor: '#e3e6e8',
      borderTopStyle: 'solid',
      borderTopWidth: 1,
      listStyle: 'none',
      margin: 0,
      padding: 0,
    },
    row: {
      borderBottomColor: '#e3e6e8',
      borderBottomStyle: 'solid',
      borderBottomWidth: 1,
      display: 'flex',
      gap: 16,
      paddingBlock: 16,
    },
    stats: {
      color: '#525960',
      display: 'flex',
      flexDirection: 'column',
      flexShrink: 0,
      fontSize: 13,
      gap: 8,
      paddingTop: 2,
      width: 90,
    },
    statVotes: {
      alignItems: 'center',
      display: 'flex',
      flexDirection: 'column',
      gap: 3,
    },
    statVotesLabel: {
      color: '#525960',
      fontSize: 13,
      lineHeight: 1,
    },
    statBox: {
      alignItems: 'center',
      borderColor: '#2f6f44',
      borderRadius: 4,
      borderStyle: 'solid',
      borderWidth: 1,
      color: '#2f6f44',
      display: 'flex',
      flexDirection: 'column',
      gap: 2,
      paddingBlock: 4,
      paddingInline: 6,
    },
    statBoxNum: {
      fontSize: 15,
      fontVariantNumeric: 'tabular-nums',
      fontWeight: 400,
      lineHeight: 1,
    },
    statBoxLabel: {
      fontSize: 12,
      lineHeight: 1,
    },
    statPlain: {
      alignItems: 'center',
      color: '#525960',
      display: 'flex',
      flexDirection: 'column',
      gap: 2,
      paddingBlock: 4,
    },
    statViews: {
      color: '#6a737c',
      fontSize: 12,
      textAlign: 'center',
    },
    rowMain: {
      display: 'grid',
      flex: '1 1 0%',
      gap: 6,
      minWidth: 0,
    },
    rowTitle: {
      color: '#0074cc',
      fontSize: 17,
      fontWeight: 400,
      lineHeight: 1.3,
      textDecoration: 'none',
      ':hover': { color: '#0a95ff' },
    },
    rowExcerpt: {
      color: '#525960',
      display: '-webkit-box',
      fontSize: 13,
      lineHeight: 1.5,
      margin: 0,
      overflow: 'hidden',
      WebkitBoxOrient: 'vertical',
      WebkitLineClamp: 2,
    },
    rowMeta: {
      alignItems: 'flex-end',
      columnGap: 12,
      display: 'flex',
      flexWrap: 'wrap',
      justifyContent: 'space-between',
      marginBlockStart: 4,
      rowGap: 8,
    },
    // ---- Ask composer --------------------------------------------------------
    composer: {
      backgroundColor: '#fdf7e3',
      borderColor: '#f1e5bc',
      borderRadius: 6,
      borderStyle: 'solid',
      borderWidth: 1,
      display: 'grid',
      gap: 10,
      marginBlockStart: 28,
      padding: 16,
    },
    composerTitle: {
      color: '#0c0d0e',
      fontSize: 15,
      fontWeight: 600,
      margin: 0,
    },
    composerHint: {
      color: '#525960',
      fontSize: 13,
      marginBlock: 0,
    },
    label: {
      color: '#0c0d0e',
      fontSize: 14,
      fontWeight: 600,
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
    error: {
      color: '#c22e32',
      fontSize: 13,
    },
  },
  { namespace: 'so-question-list', source: 'examples/stackoverflow/src/components/question-list.tsx' },
);

export const questionListStyleCss = style.emitAtomicCss(
  Object.values(listStyles).flatMap((entry) => entry.__rules ?? []),
);

function renderAnswerStat(answerCount: number): string {
  if (answerCount > 0) {
    return (
      <div class="kv-so-question-list-align-dow0hd kv-so-question-list-bd-z9lprh kv-so-question-list-bd-sdq6l5 kv-so-question-list-bd-1xrysw kv-so-question-list-bd-17zwtb kv-so-question-list-fg-2oulfq kv-so-question-list-d-suujph kv-so-question-list-flex-se7p8j kv-so-question-list-gap-1xqawc kv-so-question-list-pad-134lwd kv-so-question-list-pad-g3xfsf" data-style-src="examples/stackoverflow/src/components/question-list.tsx#statBox">
        <span class="kv-so-question-list-font-9vsq2l kv-so-question-list-font-1gvvc3 kv-so-question-list-font-c5751w kv-so-question-list-line-1k8e2e" data-style-src="examples/stackoverflow/src/components/question-list.tsx#statBoxNum">{answerCount}</span>
        <span class="kv-so-question-list-font-vriodq kv-so-question-list-line-1k8e2e" data-style-src="examples/stackoverflow/src/components/question-list.tsx#statBoxLabel">{answerCount === 1 ? 'answer' : 'answers'}</span>
      </div>
    );
  }
  return (
    <div class="kv-so-question-list-align-dow0hd kv-so-question-list-fg-19jegf kv-so-question-list-d-suujph kv-so-question-list-flex-se7p8j kv-so-question-list-gap-1xqawc kv-so-question-list-pad-134lwd" data-style-src="examples/stackoverflow/src/components/question-list.tsx#statPlain">
      <span class="kv-so-question-list-font-9vsq2l kv-so-question-list-font-1gvvc3 kv-so-question-list-font-c5751w kv-so-question-list-line-1k8e2e" data-style-src="examples/stackoverflow/src/components/question-list.tsx#statBoxNum">0</span>
      <span class="kv-so-question-list-font-vriodq kv-so-question-list-line-1k8e2e" data-style-src="examples/stackoverflow/src/components/question-list.tsx#statBoxLabel">answers</span>
    </div>
  );
}

function renderQuestionRow(question: QuestionListItem): string {
  const tags = parseTags(question.tags);
  const views = viewsFor(question.id, question.score);
  return (
    <li kovo-key={question.id} class="kv-so-question-list-bd-1mtk9b kv-so-question-list-bd-1ku9ml kv-so-question-list-bd-193fd6 kv-so-question-list-d-suujph kv-so-question-list-gap-1hjykv kv-so-question-list-pad-1b3ioz" data-style-src="examples/stackoverflow/src/components/question-list.tsx#row">
      <div class="kv-so-question-list-fg-19jegf kv-so-question-list-d-suujph kv-so-question-list-flex-se7p8j kv-so-question-list-flex-1mn74f kv-so-question-list-font-1r07r6 kv-so-question-list-gap-1tj6rf kv-so-question-list-pad-1rl1mi kv-so-question-list-w-lwaztp" data-style-src="examples/stackoverflow/src/components/question-list.tsx#stats">
        <div class="kv-so-question-list-align-dow0hd kv-so-question-list-d-suujph kv-so-question-list-flex-se7p8j kv-so-question-list-gap-1910oy" data-style-src="examples/stackoverflow/src/components/question-list.tsx#statVotes">
          {voteButton(question.id, question.score)}
          <span class="kv-so-question-list-fg-19jegf kv-so-question-list-font-1r07r6 kv-so-question-list-line-1k8e2e" data-style-src="examples/stackoverflow/src/components/question-list.tsx#statVotesLabel">votes</span>
        </div>
        {renderAnswerStat(question.answerCount)}
        <span class="kv-so-question-list-fg-2mobxg kv-so-question-list-font-vriodq kv-so-question-list-text-dkfmln" data-style-src="examples/stackoverflow/src/components/question-list.tsx#statViews">{`${compactCount(views)} views`}</span>
      </div>
      <div class="kv-so-question-list-d-7k5ll4 kv-so-question-list-flex-vyulks kv-so-question-list-gap-13r5ks kv-so-question-list-min-mk1ffb" data-style-src="examples/stackoverflow/src/components/question-list.tsx#rowMain">
        <a class="kv-so-question-list-fg-1837qt kv-so-question-list-font-xv03xf kv-so-question-list-font-c5751w kv-so-question-list-line-yriicd kv-so-question-list-text-1tmi32 kv-so-question-list-fg-1xz1yy" data-style-src="examples/stackoverflow/src/components/question-list.tsx#rowTitle" href={`/questions/${question.id}`}>
          {escapeText(question.title)}
        </a>
        {question.body ? <p class="kv-so-question-list-fg-19jegf kv-so-question-list-d-xao6br kv-so-question-list-font-1r07r6 kv-so-question-list-line-274ua4 kv-so-question-list-m-113xoj kv-so-question-list-overflow-1f3mmb kv-so-question-list--2pe3qp kv-so-question-list--nogayy" data-style-src="examples/stackoverflow/src/components/question-list.tsx#rowExcerpt">{escapeText(question.body)}</p> : ''}
        <div class="kv-so-question-list-align-1fvo3s kv-so-question-list-column-1191qg kv-so-question-list-d-suujph kv-so-question-list-flex-1scymt kv-so-question-list-justify-fgu9ef kv-so-question-list-m-s60ix5 kv-so-question-list-row-1x4q8m" data-style-src="examples/stackoverflow/src/components/question-list.tsx#rowMeta">
          {renderTags(tags)}
          {renderUserCard(question.authorName, question.createdAt, 'asked')}
        </div>
      </div>
    </li>
  );
}

// Interactive region rendered inside the full page and fragment responses.
export const QuestionListRegion = component({
  mutations: { postQuestion: postQuestionForm },
  queries: { questionList, questionScore },
  render: (
    {
      questionList,
      questionScore,
    }: {
      questionList: QuestionListQueryResult;
      questionScore: QuestionScoreQueryResult;
    },
    _state,
    slots: QuestionListRenderSlots = defaultQuestionListRenderSlots,
  ) => {
    const questions = questionList.items;
    const totalVotes = questionScore.score;

    return (
      <div kovo-c="question-list-region" kovo-deps="questionList questionScore" kovo-fragment-target="question-list-region" kovo-live-component="components/question-list/question-list-region">
        <div class="kv-so-question-list-align-dow0hd kv-so-question-list-d-suujph kv-so-question-list-gap-1hjykv kv-so-question-list-justify-fgu9ef kv-so-question-list-m-1hf0q0" data-style-src="examples/stackoverflow/src/components/question-list.tsx#pageHead">
          <h1 class="kv-so-question-list-fg-xnwxoc kv-so-question-list-font-akymas kv-so-question-list-font-c5751w kv-so-question-list-m-113xoj" data-style-src="examples/stackoverflow/src/components/question-list.tsx#pageTitle">All Questions</h1>
          <a href="#ask-question" class="kv-so-question-list-bg-nl1060 kv-so-question-list-bd-12ru5p kv-so-question-list-bd-sdq6l5 kv-so-question-list-bd-1xrysw kv-so-question-list-bd-17zwtb kv-so-question-list-fg-1g4csz kv-so-question-list-flex-1mn74f kv-so-question-list-font-1r07r6 kv-so-question-list-pad-1tf3mn kv-so-question-list-pad-qqgusf kv-so-question-list-text-1tmi32 kv-so-question-list-bg-wz972k" data-style-src="examples/stackoverflow/src/components/question-list.tsx#askButton">
            Ask Question
          </a>
        </div>
        <div class="kv-so-question-list-align-dow0hd kv-so-question-list-d-suujph kv-so-question-list-flex-1scymt kv-so-question-list-gap-1i7puk kv-so-question-list-justify-fgu9ef kv-so-question-list-m-1v15fb" data-style-src="examples/stackoverflow/src/components/question-list.tsx#subHead">
          <span class="kv-so-question-list-fg-1ecxq4 kv-so-question-list-font-xv03xf" data-style-src="examples/stackoverflow/src/components/question-list.tsx#count">
            {questions.length.toLocaleString('en-US')} questions
          </span>
          <div class="kv-so-question-list-bd-1fs11q kv-so-question-list-bd-1hxazk kv-so-question-list-bd-1xrysw kv-so-question-list-bd-17zwtb kv-so-question-list-d-o3p01s kv-so-question-list-overflow-1f3mmb" data-style-src="examples/stackoverflow/src/components/question-list.tsx#tabs">
            <a href="/" class="kv-so-question-list-bd-65jqli kv-so-question-list-bd-atzfi6 kv-so-question-list-font-1r07r6 kv-so-question-list-pad-nsmmd9 kv-so-question-list-pad-qqgusf kv-so-question-list-text-1tmi32 kv-so-question-list-bg-1hqvrl kv-so-question-list-fg-1szrun kv-so-question-list-bd-ew53ga kv-so-question-list-bg-t92jsj kv-so-question-list-fg-1ecxq4" data-style-src="examples/stackoverflow/src/components/question-list.tsx#tab; examples/stackoverflow/src/components/question-list.tsx#tabFirst; examples/stackoverflow/src/components/question-list.tsx#tabActive">
              Newest
            </a>
            <a href="/" class="kv-so-question-list-bd-65jqli kv-so-question-list-bd-atzfi6 kv-so-question-list-bd-nhyibz kv-so-question-list-fg-19jegf kv-so-question-list-font-1r07r6 kv-so-question-list-pad-nsmmd9 kv-so-question-list-pad-qqgusf kv-so-question-list-text-1tmi32 kv-so-question-list-bg-1hqvrl kv-so-question-list-fg-1szrun" data-style-src="examples/stackoverflow/src/components/question-list.tsx#tab">
              Active
            </a>
            <a href="/" class="kv-so-question-list-bd-65jqli kv-so-question-list-bd-atzfi6 kv-so-question-list-bd-nhyibz kv-so-question-list-fg-19jegf kv-so-question-list-font-1r07r6 kv-so-question-list-pad-nsmmd9 kv-so-question-list-pad-qqgusf kv-so-question-list-text-1tmi32 kv-so-question-list-bg-1hqvrl kv-so-question-list-fg-1szrun" data-style-src="examples/stackoverflow/src/components/question-list.tsx#tab">
              Bountied
            </a>
            <a href="/" class="kv-so-question-list-bd-65jqli kv-so-question-list-bd-atzfi6 kv-so-question-list-bd-nhyibz kv-so-question-list-fg-19jegf kv-so-question-list-font-1r07r6 kv-so-question-list-pad-nsmmd9 kv-so-question-list-pad-qqgusf kv-so-question-list-text-1tmi32 kv-so-question-list-bg-1hqvrl kv-so-question-list-fg-1szrun" data-style-src="examples/stackoverflow/src/components/question-list.tsx#tab">
              Unanswered
            </a>
          </div>
        </div>

        <ul class="kv-so-question-list-bd-93yw0a kv-so-question-list-bd-5emlhs kv-so-question-list-bd-1g9l04 kv-so-question-list-list-13bp8i kv-so-question-list-m-113xoj kv-so-question-list-pad-18rrwl" data-style-src="examples/stackoverflow/src/components/question-list.tsx#list">
          {questions.map((question) => renderQuestionRow(question))}
        </ul>

        {/* Native form; enhanced submissions refresh this whole region. */}
        <form
          enhance
          method="post" action="/_m/postQuestion" data-mutation="postQuestion" kovo-fragment-target="post-question-mutation"
          id="ask-question"
          class="kv-so-question-list-bg-13mapp kv-so-question-list-bd-g86ugw kv-so-question-list-bd-1hxazk kv-so-question-list-bd-1xrysw kv-so-question-list-bd-17zwtb kv-so-question-list-d-7k5ll4 kv-so-question-list-gap-y2fx34 kv-so-question-list-m-1qc9py kv-so-question-list-pad-1j0dfe" data-style-src="examples/stackoverflow/src/components/question-list.tsx#composer"
        >
          {/* This form is compiler-lowered, so the `mutation` prop is replaced by
              concrete attributes and the JSX runtime's automatic CSRF field is not
              emitted — unlike the runtime-rendered voteButton. Add it explicitly. */}
          {slots.request ? csrfField(slots.request, soCsrf) : ''}
          <input type="hidden" name="id" value={freshId('q')} />
          <input type="hidden" name="authorId" value="demo-viewer" />
          <p class="kv-so-question-list-fg-xnwxoc kv-so-question-list-font-9vsq2l kv-so-question-list-font-1chcq6 kv-so-question-list-m-113xoj" data-style-src="examples/stackoverflow/src/components/question-list.tsx#composerTitle">Ask a public question</p>
          <p class="kv-so-question-list-fg-19jegf kv-so-question-list-font-1r07r6 kv-so-question-list-m-fu5lgo" data-style-src="examples/stackoverflow/src/components/question-list.tsx#composerHint">
            {totalVotes} votes cast across the community — be specific and imagine you're asking
            another person.
          </p>
          <label class="kv-so-question-list-fg-xnwxoc kv-so-question-list-font-m89wix kv-so-question-list-font-1chcq6" data-style-src="examples/stackoverflow/src/components/question-list.tsx#label" for="ask-title">
            Title
          </label>
          <input
            id="ask-title"
            name="title"
            required
            placeholder="e.g. How do I center a div with flexbox?"
            class="kv-so-question-list-bg-1r5soy kv-so-question-list-bd-1fs11q kv-so-question-list-bd-sdq6l5 kv-so-question-list-bd-1xrysw kv-so-question-list-bd-17zwtb kv-so-question-list-box-1gvzd3 kv-so-question-list-fg-xnwxoc kv-so-question-list-font-1r07r6 kv-so-question-list-pad-i3n451 kv-so-question-list-pad-qqgusf kv-so-question-list-w-lhhf6b kv-so-question-list-bd-m5fnx7 kv-so-question-list-box-1g9a2w kv-so-question-list-outline-405iyf" data-style-src="examples/stackoverflow/src/components/question-list.tsx#input"
          />
          <label class="kv-so-question-list-fg-xnwxoc kv-so-question-list-font-m89wix kv-so-question-list-font-1chcq6" data-style-src="examples/stackoverflow/src/components/question-list.tsx#label" for="ask-body">
            Body
          </label>
          <textarea
            id="ask-body"
            name="body"
            required
            rows="3"
            placeholder="Include all the information someone would need to answer your question…"
            class="kv-so-question-list-bg-1r5soy kv-so-question-list-bd-1fs11q kv-so-question-list-bd-sdq6l5 kv-so-question-list-bd-1xrysw kv-so-question-list-bd-17zwtb kv-so-question-list-box-1gvzd3 kv-so-question-list-fg-xnwxoc kv-so-question-list-font-1r07r6 kv-so-question-list-pad-i3n451 kv-so-question-list-pad-qqgusf kv-so-question-list-w-lhhf6b kv-so-question-list-bd-m5fnx7 kv-so-question-list-box-1g9a2w kv-so-question-list-outline-405iyf kv-so-question-list-line-274ua4 kv-so-question-list-resize-bvf20l" data-style-src="examples/stackoverflow/src/components/question-list.tsx#input; examples/stackoverflow/src/components/question-list.tsx#textarea"
          />
          {FormError({ "failure": slots.forms.postQuestion.failure, "code": "DUPLICATE_TITLE", "class": "kv-so-question-list-fg-11kzz2 kv-so-question-list-font-1r07r6", "data-style-src": "examples/stackoverflow/src/components/question-list.tsx#error", "message": (failure: DuplicateTitleFailure) =>
              `A question titled "${failure.payload.title}" already exists.` })}
          <div class="kv-so-question-list-d-suujph kv-so-question-list-justify-12aoua" data-style-src="examples/stackoverflow/src/components/question-list.tsx#composerActions">
            <button type="submit" class="kv-so-question-list-bg-nl1060 kv-so-question-list-bd-12ru5p kv-so-question-list-bd-sdq6l5 kv-so-question-list-bd-1xrysw kv-so-question-list-bd-17zwtb kv-so-question-list-fg-1g4csz kv-so-question-list-font-1r07r6 kv-so-question-list-pad-1tf3mn kv-so-question-list-pad-qqgusf kv-so-question-list-bg-wz972k" data-style-src="examples/stackoverflow/src/components/question-list.tsx#submitButton">
              Post your question
            </button>
          </div>
        </form>
      </div>
    );
  },
});
QuestionListRegion.name = "components/question-list/question-list-region";

export const QuestionListRegion$liveTargetRenderer = registerGeneratedLiveTargetRenderer(componentLiveTargetRenderer({
  component: QuestionListRegion,
  componentId: "components/question-list/question-list-region",
}));
