// @kovojs-ir — lowered from examples/stackoverflow/src/components/question-list.tsx by @kovojs/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit-components`.
/** @jsxImportSource @kovojs/server */
import { renderMutationCsrfField as __kovoRenderMutationCsrfField } from '@kovojs/server/internal/csrf';
import { escapeText } from '@kovojs/server/internal/html';
import { component, FormError, type ComponentRenderSlots } from '@kovojs/core';
import * as style from '@kovojs/style';

import { postQuestionMutation } from '../mutations.js';
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

const listStyles = style.create({
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
});

export const questionListStyleCss = style.emitAtomicCss(
  Object.values(listStyles).flatMap((entry) => entry.__rules ?? []),
);

function renderAnswerStat(answerCount: number): string {
  if (answerCount > 0) {
    return (
      <div class="kv-list-align-dow0hd kv-list-bd-z9lprh kv-list-bd-sdq6l5 kv-list-bd-1xrysw kv-list-bd-17zwtb kv-list-fg-2oulfq kv-list-d-suujph kv-list-flex-se7p8j kv-list-gap-1xqawc kv-list-pad-134lwd kv-list-pad-g3xfsf" data-style-src="examples/stackoverflow/src/components/question-list.tsx#statBox">
        <span class="kv-list-font-9vsq2l kv-list-font-1gvvc3 kv-list-font-c5751w kv-list-line-1k8e2e" data-style-src="examples/stackoverflow/src/components/question-list.tsx#statBoxNum">{answerCount}</span>
        <span class="kv-list-font-vriodq kv-list-line-1k8e2e" data-style-src="examples/stackoverflow/src/components/question-list.tsx#statBoxLabel">{answerCount === 1 ? 'answer' : 'answers'}</span>
      </div>
    );
  }
  return (
    <div class="kv-list-align-dow0hd kv-list-fg-19jegf kv-list-d-suujph kv-list-flex-se7p8j kv-list-gap-1xqawc kv-list-pad-134lwd" data-style-src="examples/stackoverflow/src/components/question-list.tsx#statPlain">
      <span class="kv-list-font-9vsq2l kv-list-font-1gvvc3 kv-list-font-c5751w kv-list-line-1k8e2e" data-style-src="examples/stackoverflow/src/components/question-list.tsx#statBoxNum">0</span>
      <span class="kv-list-font-vriodq kv-list-line-1k8e2e" data-style-src="examples/stackoverflow/src/components/question-list.tsx#statBoxLabel">answers</span>
    </div>
  );
}

function renderQuestionRow(question: QuestionListItem): string {
  const tags = parseTags(question.tags);
  const views = viewsFor(question.id, question.score);
  return (
    <li kovo-key={question.id} class="kv-list-bd-1mtk9b kv-list-bd-1ku9ml kv-list-bd-193fd6 kv-list-d-suujph kv-list-gap-1hjykv kv-list-pad-1b3ioz" data-style-src="examples/stackoverflow/src/components/question-list.tsx#row">
      <div class="kv-list-fg-19jegf kv-list-d-suujph kv-list-flex-se7p8j kv-list-flex-1mn74f kv-list-font-1r07r6 kv-list-gap-1tj6rf kv-list-pad-1rl1mi kv-list-w-lwaztp" data-style-src="examples/stackoverflow/src/components/question-list.tsx#stats">
        <div class="kv-list-align-dow0hd kv-list-d-suujph kv-list-flex-se7p8j kv-list-gap-1910oy" data-style-src="examples/stackoverflow/src/components/question-list.tsx#statVotes">
          {voteButton(question.id, question.score)}
          <span class="kv-list-fg-19jegf kv-list-font-1r07r6 kv-list-line-1k8e2e" data-style-src="examples/stackoverflow/src/components/question-list.tsx#statVotesLabel">votes</span>
        </div>
        {renderAnswerStat(question.answerCount)}
        <span class="kv-list-fg-2mobxg kv-list-font-vriodq kv-list-text-dkfmln" data-style-src="examples/stackoverflow/src/components/question-list.tsx#statViews">{`${compactCount(views)} views`}</span>
      </div>
      <div class="kv-list-d-7k5ll4 kv-list-flex-vyulks kv-list-gap-13r5ks kv-list-min-mk1ffb" data-style-src="examples/stackoverflow/src/components/question-list.tsx#rowMain">
        <a class="kv-list-fg-1837qt kv-list-font-xv03xf kv-list-font-c5751w kv-list-line-yriicd kv-list-text-1tmi32 kv-list-fg-1xz1yy" data-style-src="examples/stackoverflow/src/components/question-list.tsx#rowTitle" href={`/questions/${question.id}`}>
          {escapeText(question.title)}
        </a>
        {question.body ? <p class="kv-list-fg-19jegf kv-list-d-xao6br kv-list-font-1r07r6 kv-list-line-274ua4 kv-list-m-113xoj kv-list-overflow-1f3mmb kv-list--2pe3qp kv-list--nogayy" data-style-src="examples/stackoverflow/src/components/question-list.tsx#rowExcerpt">{escapeText(question.body)}</p> : ''}
        <div class="kv-list-align-1fvo3s kv-list-column-1191qg kv-list-d-suujph kv-list-flex-1scymt kv-list-justify-fgu9ef kv-list-m-s60ix5 kv-list-row-1x4q8m" data-style-src="examples/stackoverflow/src/components/question-list.tsx#rowMeta">
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
    _slots: QuestionListRenderSlots = defaultQuestionListRenderSlots,
  ) => {
    const questions = questionList.items;
    const totalVotes = questionScore.score;

    return (
      <div kovo-c="question-list-region" kovo-deps="questionList questionScore" kovo-fragment-target="question-list-region" kovo-live-component="components/question-list/question-list-region">
        <div class="kv-list-align-dow0hd kv-list-d-suujph kv-list-gap-1hjykv kv-list-justify-fgu9ef kv-list-m-1hf0q0" data-style-src="examples/stackoverflow/src/components/question-list.tsx#pageHead">
          <h1 class="kv-list-fg-xnwxoc kv-list-font-akymas kv-list-font-c5751w kv-list-m-113xoj" data-style-src="examples/stackoverflow/src/components/question-list.tsx#pageTitle">All Questions</h1>
          <a href="#ask-question" class="kv-list-bg-nl1060 kv-list-bd-12ru5p kv-list-bd-sdq6l5 kv-list-bd-1xrysw kv-list-bd-17zwtb kv-list-fg-1g4csz kv-list-flex-1mn74f kv-list-font-1r07r6 kv-list-pad-1tf3mn kv-list-pad-qqgusf kv-list-text-1tmi32 kv-list-bg-wz972k" data-style-src="examples/stackoverflow/src/components/question-list.tsx#askButton">
            Ask Question
          </a>
        </div>
        <div class="kv-list-align-dow0hd kv-list-d-suujph kv-list-flex-1scymt kv-list-gap-1i7puk kv-list-justify-fgu9ef kv-list-m-1v15fb" data-style-src="examples/stackoverflow/src/components/question-list.tsx#subHead">
          <span class="kv-list-fg-1ecxq4 kv-list-font-xv03xf" data-style-src="examples/stackoverflow/src/components/question-list.tsx#count">{questions.length.toLocaleString('en-US')} questions</span>
          <div class="kv-list-bd-1fs11q kv-list-bd-1hxazk kv-list-bd-1xrysw kv-list-bd-17zwtb kv-list-d-o3p01s kv-list-overflow-1f3mmb" data-style-src="examples/stackoverflow/src/components/question-list.tsx#tabs">
            <a href="/" class="kv-list-bd-65jqli kv-list-bd-atzfi6 kv-list-font-1r07r6 kv-list-pad-nsmmd9 kv-list-pad-qqgusf kv-list-text-1tmi32 kv-list-bg-1hqvrl kv-list-fg-1szrun kv-list-bd-ew53ga kv-list-bg-t92jsj kv-list-fg-1ecxq4" data-style-src="examples/stackoverflow/src/components/question-list.tsx#tab; examples/stackoverflow/src/components/question-list.tsx#tabFirst; examples/stackoverflow/src/components/question-list.tsx#tabActive">
              Newest
            </a>
            <a href="/" class="kv-list-bd-65jqli kv-list-bd-atzfi6 kv-list-bd-nhyibz kv-list-fg-19jegf kv-list-font-1r07r6 kv-list-pad-nsmmd9 kv-list-pad-qqgusf kv-list-text-1tmi32 kv-list-bg-1hqvrl kv-list-fg-1szrun" data-style-src="examples/stackoverflow/src/components/question-list.tsx#tab">
              Active
            </a>
            <a href="/" class="kv-list-bd-65jqli kv-list-bd-atzfi6 kv-list-bd-nhyibz kv-list-fg-19jegf kv-list-font-1r07r6 kv-list-pad-nsmmd9 kv-list-pad-qqgusf kv-list-text-1tmi32 kv-list-bg-1hqvrl kv-list-fg-1szrun" data-style-src="examples/stackoverflow/src/components/question-list.tsx#tab">
              Bountied
            </a>
            <a href="/" class="kv-list-bd-65jqli kv-list-bd-atzfi6 kv-list-bd-nhyibz kv-list-fg-19jegf kv-list-font-1r07r6 kv-list-pad-nsmmd9 kv-list-pad-qqgusf kv-list-text-1tmi32 kv-list-bg-1hqvrl kv-list-fg-1szrun" data-style-src="examples/stackoverflow/src/components/question-list.tsx#tab">
              Unanswered
            </a>
          </div>
        </div>

        <ul class="kv-list-bd-93yw0a kv-list-bd-5emlhs kv-list-bd-1g9l04 kv-list-list-13bp8i kv-list-m-113xoj kv-list-pad-18rrwl" data-style-src="examples/stackoverflow/src/components/question-list.tsx#list">{questions.map((question) => renderQuestionRow(question))}</ul>

        {/* Native form; enhanced submissions refresh this whole region. */}
        <form enhance method="post" action="/_m/postQuestion" data-mutation="postQuestion" kovo-fragment-target="post-question-mutation" id="ask-question" class="kv-list-bg-13mapp kv-list-bd-g86ugw kv-list-bd-1hxazk kv-list-bd-1xrysw kv-list-bd-17zwtb kv-list-d-7k5ll4 kv-list-gap-y2fx34 kv-list-m-1qc9py kv-list-pad-1j0dfe" data-style-src="examples/stackoverflow/src/components/question-list.tsx#composer">
          <input type="hidden" name="id" value={freshId('q')} />
          <input type="hidden" name="authorId" value="demo-viewer" />
          <p class="kv-list-fg-xnwxoc kv-list-font-9vsq2l kv-list-font-1chcq6 kv-list-m-113xoj" data-style-src="examples/stackoverflow/src/components/question-list.tsx#composerTitle">Ask a public question</p>
          <p class="kv-list-fg-19jegf kv-list-font-1r07r6 kv-list-m-fu5lgo" data-style-src="examples/stackoverflow/src/components/question-list.tsx#composerHint">
            {totalVotes} votes cast across the community — be specific and imagine you're asking
            another person.
          </p>
          <label class="kv-list-fg-xnwxoc kv-list-font-m89wix kv-list-font-1chcq6" data-style-src="examples/stackoverflow/src/components/question-list.tsx#label" for="ask-title">
            Title
          </label>
          <input
            id="ask-title"
            name="title"
            required
            placeholder="e.g. How do I center a div with flexbox?"
            class="kv-list-bg-1r5soy kv-list-bd-1fs11q kv-list-bd-sdq6l5 kv-list-bd-1xrysw kv-list-bd-17zwtb kv-list-box-1gvzd3 kv-list-fg-xnwxoc kv-list-font-1r07r6 kv-list-pad-i3n451 kv-list-pad-qqgusf kv-list-w-lhhf6b kv-list-bd-m5fnx7 kv-list-box-1g9a2w kv-list-outline-405iyf" data-style-src="examples/stackoverflow/src/components/question-list.tsx#input"
          />
          <label class="kv-list-fg-xnwxoc kv-list-font-m89wix kv-list-font-1chcq6" data-style-src="examples/stackoverflow/src/components/question-list.tsx#label" for="ask-body">
            Body
          </label>
          <textarea
            id="ask-body"
            name="body"
            required
            rows="3"
            placeholder="Include all the information someone would need to answer your question…"
            class="kv-list-bg-1r5soy kv-list-bd-1fs11q kv-list-bd-sdq6l5 kv-list-bd-1xrysw kv-list-bd-17zwtb kv-list-box-1gvzd3 kv-list-fg-xnwxoc kv-list-font-1r07r6 kv-list-pad-i3n451 kv-list-pad-qqgusf kv-list-w-lhhf6b kv-list-bd-m5fnx7 kv-list-box-1g9a2w kv-list-outline-405iyf kv-list-line-274ua4 kv-list-resize-bvf20l" data-style-src="examples/stackoverflow/src/components/question-list.tsx#input; examples/stackoverflow/src/components/question-list.tsx#textarea"
          />
          {FormError({ "failure": _slots.forms.postQuestion.failure, "code": "DUPLICATE_TITLE", "class": "kv-list-fg-11kzz2 kv-list-font-1r07r6", "data-style-src": "examples/stackoverflow/src/components/question-list.tsx#error", "message": (failure: DuplicateTitleFailure) =>
              `A question titled "${failure.payload.title}" already exists.` })}
          <div class="kv-list-d-suujph kv-list-justify-12aoua" data-style-src="examples/stackoverflow/src/components/question-list.tsx#composerActions">
            <button type="submit" class="kv-list-bg-nl1060 kv-list-bd-12ru5p kv-list-bd-sdq6l5 kv-list-bd-1xrysw kv-list-bd-17zwtb kv-list-fg-1g4csz kv-list-font-1r07r6 kv-list-pad-1tf3mn kv-list-pad-qqgusf kv-list-bg-wz972k" data-style-src="examples/stackoverflow/src/components/question-list.tsx#submitButton">
              Post your question
            </button>
          </div>{__kovoRenderMutationCsrfField(postQuestionMutation)}
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
