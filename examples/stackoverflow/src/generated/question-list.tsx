// @kovojs-ir — lowered from examples/stackoverflow/src/components/question-list.tsx by @kovojs/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit-components`.
/** @jsxImportSource @kovojs/server */
import { escapeText } from '@kovojs/server/internal/html';
import { component, FormError, type ComponentRenderSlots } from '@kovojs/core';
import { csrfField } from '@kovojs/server';
import { Badge } from '@kovojs/ui/badge';
import { Button } from '@kovojs/ui/button';
import { Card } from '@kovojs/ui/card';
import { tokens } from '@kovojs/style';
import * as style from '@kovojs/style';

import { soCsrf } from '../mutations.js';
import { questionList, questionScore } from '../queries.js';
import { postQuestionForm, type QuestionListItem, type SoRequest } from '../model.js';
import { freshId, parseTags, renderAuthor, renderTags, voteButton } from '../components/chrome.js';
import { componentLiveTargetRenderer, registerGeneratedLiveTargetRenderer } from '@kovojs/server/internal/wire';


// Question list for `/`. It reads the question rowset and total vote score, then
// renders the ask form and question cards.

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
    composer: {
      display: 'grid',
      gap: 11,
    },
    composerActions: {
      display: 'flex',
      justifyContent: 'flex-end',
    },
    composerTitle: {
      color: tokens.sys.color.onSurface,
      fontSize: 15,
      fontWeight: 600,
      margin: 0,
    },
    error: {
      color: tokens.sys.color.error,
      fontSize: 14,
    },
    input: {
      backgroundColor: tokens.sys.color.surfaceContainerLowest,
      borderColor: tokens.sys.color.outline,
      borderRadius: tokens.sys.shape.cornerMedium,
      borderStyle: 'solid',
      borderWidth: 1,
      boxSizing: 'border-box',
      color: tokens.sys.color.onSurface,
      fontSize: 14,
      paddingBlock: 10,
      paddingInline: 13,
      width: '100%',
      ':focus': {
        borderColor: tokens.sys.color.primary,
        outline: 'none',
      },
    },
    list: {
      display: 'grid',
      gap: 14,
      listStyle: 'none',
      margin: 0,
      padding: 0,
    },
    pageHead: {
      alignItems: 'flex-end',
      display: 'flex',
      gap: 16,
      justifyContent: 'space-between',
    },
    pageSub: {
      color: tokens.sys.color.onSurfaceVariant,
      fontSize: 14,
      marginBlockEnd: 0,
      marginBlockStart: 6,
    },
    pageTitle: {
      color: tokens.sys.color.onSurface,
      fontSize: 26,
      fontWeight: 800,
      letterSpacing: 0,
      margin: 0,
    },
    row: {
      alignItems: 'flex-start',
      display: 'flex',
      gap: 16,
    },
    rowExcerpt: {
      color: tokens.sys.color.onSurfaceVariant,
      display: '-webkit-box',
      fontSize: 14,
      lineHeight: 1.5,
      margin: 0,
      overflow: 'hidden',
      WebkitBoxOrient: 'vertical',
      WebkitLineClamp: 2,
    },
    rowMain: {
      display: 'grid',
      flex: '1 1 0%',
      gap: 9,
      minWidth: 0,
    },
    rowMeta: {
      alignItems: 'center',
      display: 'flex',
      flexWrap: 'wrap',
      gap: 10,
      justifyContent: 'space-between',
    },
    rowStat: {
      alignItems: 'center',
      borderColor: tokens.sys.color.outlineVariant,
      borderRadius: tokens.sys.shape.cornerMedium,
      borderStyle: 'solid',
      borderWidth: 1,
      color: tokens.sys.color.onSurfaceVariant,
      display: 'flex',
      flexDirection: 'column',
      flexShrink: 0,
      gap: 2,
      paddingBlock: 6,
      width: 52,
    },
    rowStatLabel: {
      color: tokens.sys.color.outline,
      fontSize: 10,
      letterSpacing: '0.06em',
      textTransform: 'uppercase',
    },
    rowStatNum: {
      color: tokens.sys.color.onSurface,
      fontSize: 17,
      fontVariantNumeric: 'tabular-nums',
      fontWeight: 700,
    },
    rowTitle: {
      color: tokens.sys.color.primary,
      fontSize: 17,
      fontWeight: 600,
      lineHeight: 1.35,
      textDecoration: 'none',
      ':hover': {
        color: tokens.sys.color.primary,
        textDecoration: 'underline',
        textUnderlineOffset: 2,
      },
    },
    score: {
      color: tokens.sys.color.onSurface,
      fontVariantNumeric: 'tabular-nums',
      fontWeight: 600,
    },
    stack: {
      display: 'grid',
      gap: 20,
    },
    textarea: {
      lineHeight: 1.5,
      resize: 'vertical',
    },
  },
  { namespace: 'so-question-list', source: 'examples/stackoverflow/src/components/question-list.tsx' },
);

export const questionListStyleCss = style.emitAtomicCss(
  Object.values(listStyles).flatMap((entry) => entry.__rules ?? []),
);

function renderQuestionRow(question: QuestionListItem, request?: SoRequest): string {
  const tags = parseTags(question.tags);
  const body = (
    <div class="kv-so-question-list-align-18i3ts kv-so-question-list-d-1vmrf7 kv-so-question-list-gap-1hjykv" data-style-src="examples/stackoverflow/src/components/question-list.tsx#row">
      {voteButton(question.id, question.score, request)}
      <div class="kv-so-question-list-align-1er4hq kv-so-question-list-bd-61qb9v kv-so-question-list-bd-1oyuq7 kv-so-question-list-bd-1qf6xu kv-so-question-list-bd-1wna9r kv-so-question-list-fg-1h6rud kv-so-question-list-d-1vmrf7 kv-so-question-list-flex-18en05 kv-so-question-list-flex-11gt9o kv-so-question-list-gap-uka5eb kv-so-question-list-pad-zid8se kv-so-question-list-w-1j3sxz" data-style-src="examples/stackoverflow/src/components/question-list.tsx#rowStat">
        <span class="kv-so-question-list-fg-g38551 kv-so-question-list-font-17xal2 kv-so-question-list-font-19t8mp kv-so-question-list-font-458f7m" data-style-src="examples/stackoverflow/src/components/question-list.tsx#rowStatNum">{escapeText(question.answerCount)}</span>
        <span class="kv-so-question-list-fg-fqxw3u kv-so-question-list-font-1g7vip kv-so-question-list-letter-1i48h1 kv-so-question-list-text-sf89f5" data-style-src="examples/stackoverflow/src/components/question-list.tsx#rowStatLabel">answers</span>
      </div>
      <div class="kv-so-question-list-d-1v3mkp kv-so-question-list-flex-vyulks kv-so-question-list-gap-guc295 kv-so-question-list-min-mk1ffb" data-style-src="examples/stackoverflow/src/components/question-list.tsx#rowMain">
        <a class="kv-so-question-list-fg-18tio1 kv-so-question-list-font-17xal2 kv-so-question-list-font-1chcq6 kv-so-question-list-line-13uttg kv-so-question-list-text-r40zsj kv-so-question-list-fg-tv7v5c kv-so-question-list-text-oettav kv-so-question-list-text-1wsk5q" data-style-src="examples/stackoverflow/src/components/question-list.tsx#rowTitle" href={`/questions/${question.id}`}>
          {escapeText(question.title)}
        </a>
        {question.body ? <p class="kv-so-question-list-fg-1h6rud kv-so-question-list-d-xao6br kv-so-question-list-font-15gkjg kv-so-question-list-line-274ua4 kv-so-question-list-m-g14s1r kv-so-question-list-overflow-30ax7q kv-so-question-list--2pe3qp kv-so-question-list--nogayy" data-style-src="examples/stackoverflow/src/components/question-list.tsx#rowExcerpt">{escapeText(question.body)}</p> : ''}
        <div class="kv-so-question-list-align-1er4hq kv-so-question-list-d-1vmrf7 kv-so-question-list-flex-1ef6yx kv-so-question-list-gap-uo3avz kv-so-question-list-justify-fgu9ef" data-style-src="examples/stackoverflow/src/components/question-list.tsx#rowMeta">
          {renderTags(tags)}
          {renderAuthor(question.authorName, question.createdAt, 'asked')}
        </div>
      </div>
    </div>
  );
  // Keep the stable key on the repeated child that the fragment morphs.
  return <li kovo-key={question.id}>{Card.definition.render({ children: body })}</li>;
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
    const askButton = Button.definition.render({
      children: 'Ask question',
      type: 'submit',
      variant: 'primary',
    });

    return (
      <div class="kv-so-question-list-d-1v3mkp kv-so-question-list-gap-16fadp" data-style-src="examples/stackoverflow/src/components/question-list.tsx#stack" kovo-c="question-list-region" kovo-deps="questionList questionScore" kovo-fragment-target="question-list-region" kovo-live-component="components/question-list/question-list-region">
        <div class="kv-so-question-list-align-1whswe kv-so-question-list-d-1vmrf7 kv-so-question-list-gap-1hjykv kv-so-question-list-justify-fgu9ef" data-style-src="examples/stackoverflow/src/components/question-list.tsx#pageHead">
          <div>
            <h1 class="kv-so-question-list-fg-g38551 kv-so-question-list-font-3irx0r kv-so-question-list-font-1nnj9m kv-so-question-list-letter-11tfja kv-so-question-list-m-g14s1r" data-style-src="examples/stackoverflow/src/components/question-list.tsx#pageTitle">Top questions</h1>
            <p class="kv-so-question-list-fg-1h6rud kv-so-question-list-font-15gkjg kv-so-question-list-m-gqo026 kv-so-question-list-m-2q1io5" data-style-src="examples/stackoverflow/src/components/question-list.tsx#pageSub">
              {escapeText(questions.length)} questions ·{' '}
              <span class="kv-so-question-list-fg-g38551 kv-so-question-list-font-19t8mp kv-so-question-list-font-1chcq6" data-style-src="examples/stackoverflow/src/components/question-list.tsx#score">{totalVotes}</span> votes cast
            </p>
          </div>
          {Badge.definition.render({ children: 'Newest', variant: 'success' })}
        </div>

        {/* Native form; enhanced submissions refresh this whole region. */}
        <form enhance method="post" action="/_m/postQuestion" data-mutation="postQuestion" kovo-fragment-target="post-question-mutation" class="kv-so-question-list-d-1v3mkp kv-so-question-list-gap-vg2uwn" data-style-src="examples/stackoverflow/src/components/question-list.tsx#composer">
          {slots.request ? csrfField(slots.request, soCsrf) : ''}
          <input type="hidden" name="id" value={freshId('q')} />
          <input type="hidden" name="authorId" value="demo-viewer" />
          <p class="kv-so-question-list-fg-g38551 kv-so-question-list-font-ovyv2w kv-so-question-list-font-1chcq6 kv-so-question-list-m-g14s1r" data-style-src="examples/stackoverflow/src/components/question-list.tsx#composerTitle">Ask the community</p>
          <input
            name="title"
            required
            placeholder="What's your programming question? Be specific."
            class="kv-so-question-list-bg-1n4aku kv-so-question-list-bd-1u2qp7 kv-so-question-list-bd-1oyuq7 kv-so-question-list-bd-1qf6xu kv-so-question-list-bd-1wna9r kv-so-question-list-box-1gvzd3 kv-so-question-list-fg-g38551 kv-so-question-list-font-15gkjg kv-so-question-list-pad-exa2mv kv-so-question-list-pad-164yh0 kv-so-question-list-w-lhhf6b kv-so-question-list-bd-53k52n kv-so-question-list-outline-405iyf" data-style-src="examples/stackoverflow/src/components/question-list.tsx#input"
          />
          <textarea
            name="body"
            required
            rows="2"
            placeholder="Add the details that help others answer…"
            class="kv-so-question-list-bg-1n4aku kv-so-question-list-bd-1u2qp7 kv-so-question-list-bd-1oyuq7 kv-so-question-list-bd-1qf6xu kv-so-question-list-bd-1wna9r kv-so-question-list-box-1gvzd3 kv-so-question-list-fg-g38551 kv-so-question-list-font-15gkjg kv-so-question-list-pad-exa2mv kv-so-question-list-pad-164yh0 kv-so-question-list-w-lhhf6b kv-so-question-list-bd-53k52n kv-so-question-list-outline-405iyf kv-so-question-list-line-274ua4 kv-so-question-list-resize-bvf20l" data-style-src="examples/stackoverflow/src/components/question-list.tsx#input; examples/stackoverflow/src/components/question-list.tsx#textarea"
          />
          <div class="kv-so-question-list-d-1vmrf7 kv-so-question-list-justify-m67bk5" data-style-src="examples/stackoverflow/src/components/question-list.tsx#composerActions">{askButton}</div>
          {FormError({ "failure": slots.forms.postQuestion.failure, "code": "DUPLICATE_TITLE", "class": "kv-so-question-list-fg-4ldrhq kv-so-question-list-font-15gkjg", "data-style-src": "examples/stackoverflow/src/components/question-list.tsx#error", "message": (failure: DuplicateTitleFailure) =>
              `A question titled "${failure.payload.title}" already exists.` })}
        </form>

        <ul class="kv-so-question-list-d-1v3mkp kv-so-question-list-gap-m97kii kv-so-question-list-list-13bp8i kv-so-question-list-m-g14s1r kv-so-question-list-pad-18rrwl" data-style-src="examples/stackoverflow/src/components/question-list.tsx#list">
          {questions.map((question) => renderQuestionRow(question, slots.request))}
        </ul>
      </div>
    );
  },
});
QuestionListRegion.name = "components/question-list/question-list-region";

export const QuestionListRegion$liveTargetRenderer = registerGeneratedLiveTargetRenderer(componentLiveTargetRenderer({
  component: QuestionListRegion,
  componentId: "components/question-list/question-list-region",
}));
