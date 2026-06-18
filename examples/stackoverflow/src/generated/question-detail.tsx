// @kovojs-ir — lowered from examples/stackoverflow/src/components/question-detail.tsx by @kovojs/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit-components`.
/** @jsxImportSource @kovojs/server */
import { escapeText } from '@kovojs/server/internal/html';
import { component } from '@kovojs/core';
import { csrfField } from '@kovojs/server';
import { Badge } from '@kovojs/ui/badge';
import { Button } from '@kovojs/ui/button';
import { Card } from '@kovojs/ui/card';
import { tokens } from '@kovojs/style';
import * as style from '@kovojs/style';

import { soCsrf } from '../mutations.js';
import { questionAnswers, questionDetail } from '../queries.js';
import type { QuestionAnswersResult, QuestionDetailResult, SoRequest } from '../model.js';
import { freshId, parseTags, renderAuthor, renderTags, voteButton } from '../components/chrome.js';
import { componentLiveTargetRenderer, registerGeneratedLiveTargetRenderer } from '@kovojs/server/internal/wire';


// Question detail for `/questions/:id`: the question, answers, and answer form.

const detailStyles = style.create(
  {
    acceptedAnswer: {
      backgroundColor: tokens.sys.color.tertiaryContainer,
      borderColor: tokens.sys.color.tertiary,
      borderLeftColor: tokens.sys.color.tertiary,
      borderLeftStyle: 'solid',
      borderLeftWidth: 4,
    },
    answerBody: {
      color: tokens.sys.color.onSurfaceVariant,
      fontSize: 15,
      lineHeight: 1.65,
      margin: 0,
    },
    answerList: {
      display: 'grid',
      gap: 14,
      listStyle: 'none',
      margin: 0,
      padding: 0,
    },
    answerVote: {
      alignItems: 'center',
      color: tokens.sys.color.outline,
      display: 'flex',
      flexDirection: 'column',
      flexShrink: 0,
      gap: 1,
      paddingTop: 2,
      width: 52,
    },
    back: {
      alignItems: 'center',
      color: tokens.sys.color.onSurfaceVariant,
      display: 'inline-flex',
      fontSize: 14,
      gap: 6,
      textDecoration: 'none',
      width: 'fit-content',
      ':hover': {
        color: tokens.sys.color.onSurface,
      },
    },
    badgeWrap: {
      marginBottom: 8,
    },
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
    detailBody: {
      color: tokens.sys.color.onSurfaceVariant,
      fontSize: 15,
      lineHeight: 1.65,
      marginBlockEnd: 0,
      marginBlockStart: 4,
    },
    detailTitle: {
      color: tokens.sys.color.onSurface,
      fontSize: 24,
      fontWeight: 800,
      letterSpacing: 0,
      lineHeight: 1.25,
      margin: 0,
    },
    head: {
      color: tokens.sys.color.onSurfaceVariant,
      fontSize: 15,
      fontWeight: 700,
      margin: 0,
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
    row: {
      alignItems: 'flex-start',
      display: 'flex',
      gap: 16,
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
    stack: {
      display: 'grid',
      gap: 20,
    },
    textarea: {
      lineHeight: 1.5,
      resize: 'vertical',
    },
    voteCaret: {
      fontSize: 11,
      lineHeight: 1,
    },
    voteLabel: {
      fontSize: 10,
      letterSpacing: '0.06em',
      textTransform: 'uppercase',
    },
    voteScore: {
      color: tokens.sys.color.onSurface,
      fontSize: 17,
      fontVariantNumeric: 'tabular-nums',
      fontWeight: 700,
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

function renderQuestionCard(question: QuestionDetailResult, request?: SoRequest): string {
  const tags = parseTags(question.tags);
  const body = (
    <div class="kv-so-question-detail-align-18i3ts kv-so-question-detail-d-1chols kv-so-question-detail-gap-vivniy" data-style-src="examples/stackoverflow/src/components/question-detail.tsx#row">
      {voteButton(question.id, question.score, request)}
      <div class="kv-so-question-detail-d-1hxerb kv-so-question-detail-flex-vyulks kv-so-question-detail-gap-guc295 kv-so-question-detail-min-mk1ffb" data-style-src="examples/stackoverflow/src/components/question-detail.tsx#rowMain">
        <h1 class="kv-so-question-detail-fg-g38551 kv-so-question-detail-font-1ea2fi kv-so-question-detail-font-133d4i kv-so-question-detail-letter-i06ve kv-so-question-detail-line-dhk5vm kv-so-question-detail-m-c8wetf" data-style-src="examples/stackoverflow/src/components/question-detail.tsx#detailTitle" data-bind="question.title">{question.title}</h1>
        <p class="kv-so-question-detail-fg-kzm69h kv-so-question-detail-font-52u89o kv-so-question-detail-line-1y0c3h kv-so-question-detail-m-orftde kv-so-question-detail-m-8fwh2b" data-style-src="examples/stackoverflow/src/components/question-detail.tsx#detailBody" data-bind="question.body">{question.body}</p>
        <div class="kv-so-question-detail-align-14xhag kv-so-question-detail-d-1chols kv-so-question-detail-flex-1ef6yx kv-so-question-detail-gap-uo3avz kv-so-question-detail-justify-wu0439" data-style-src="examples/stackoverflow/src/components/question-detail.tsx#rowMeta">
          {renderTags(tags)}
          {question.authorName
            ? renderAuthor(question.authorName, question.createdAt, 'asked')
            : ''}
        </div>
      </div>
    </div>
  );
  return Card.definition.render({ children: body });
}

function renderAnswerCard(answer: QuestionAnswersResult[number]): string {
  const acceptedBadge = answer.accepted
    ? Badge.definition.render({ children: '✓ Accepted answer', variant: 'success' })
    : '';
  const body = (
    <div class="kv-so-question-detail-align-18i3ts kv-so-question-detail-d-1chols kv-so-question-detail-gap-vivniy" data-style-src="examples/stackoverflow/src/components/question-detail.tsx#row">
      <div class="kv-so-question-detail-align-14xhag kv-so-question-detail-fg-700pqg kv-so-question-detail-d-1chols kv-so-question-detail-flex-g97f68 kv-so-question-detail-flex-11769t kv-so-question-detail-gap-15tc0z kv-so-question-detail-pad-15wid2 kv-so-question-detail-w-1shopf" data-style-src="examples/stackoverflow/src/components/question-detail.tsx#answerVote">
        <span class="kv-so-question-detail-font-ee2q2p kv-so-question-detail-line-1ml3f7" data-style-src="examples/stackoverflow/src/components/question-detail.tsx#voteCaret">&#9650;</span>
        <span class="kv-so-question-detail-fg-g38551 kv-so-question-detail-font-1tj2vd kv-so-question-detail-font-ymljg1 kv-so-question-detail-font-9md27q" data-style-src="examples/stackoverflow/src/components/question-detail.tsx#voteScore">{escapeText(answer.score)}</span>
        <span class="kv-so-question-detail-font-qwm14l kv-so-question-detail-letter-1qqi1u kv-so-question-detail-text-1l70zs" data-style-src="examples/stackoverflow/src/components/question-detail.tsx#voteLabel">votes</span>
      </div>
      <div class="kv-so-question-detail-d-1hxerb kv-so-question-detail-flex-vyulks kv-so-question-detail-gap-guc295 kv-so-question-detail-min-mk1ffb" data-style-src="examples/stackoverflow/src/components/question-detail.tsx#rowMain">
        {acceptedBadge ? <div class="kv-so-question-detail-m-128xxt" data-style-src="examples/stackoverflow/src/components/question-detail.tsx#badgeWrap">{acceptedBadge}</div> : ''}
        <p class="kv-so-question-detail-fg-kzm69h kv-so-question-detail-font-52u89o kv-so-question-detail-line-1y0c3h kv-so-question-detail-m-c8wetf" data-style-src="examples/stackoverflow/src/components/question-detail.tsx#answerBody">{escapeText(answer.body)}</p>
        {answer.authorName ? (
          <div class="kv-so-question-detail-align-14xhag kv-so-question-detail-d-1chols kv-so-question-detail-flex-1ef6yx kv-so-question-detail-gap-uo3avz kv-so-question-detail-justify-wu0439" data-style-src="examples/stackoverflow/src/components/question-detail.tsx#rowMeta">
            {renderAuthor(answer.authorName, answer.createdAt, 'answered')}
          </div>
        ) : (
          ''
        )}
      </div>
    </div>
  );
  const surface = Card.definition.render({
    children: body,
    ...(answer.accepted ? { style: detailStyles.acceptedAnswer } : {}),
  });
  // Keep the stable key on the repeated child that the fragment morphs.
  return (
    <li kovo-key={answer.id}>
      {surface}
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
        <div class="kv-so-question-detail-d-1hxerb kv-so-question-detail-gap-16fadp" data-style-src="examples/stackoverflow/src/components/question-detail.tsx#stack">
          <a class="kv-so-question-detail-align-14xhag kv-so-question-detail-fg-kzm69h kv-so-question-detail-d-hvcnob kv-so-question-detail-font-1tji11 kv-so-question-detail-gap-wnp2vs kv-so-question-detail-text-17zbfj kv-so-question-detail-w-17nh4y kv-so-question-detail-fg-1rg07n" data-style-src="examples/stackoverflow/src/components/question-detail.tsx#back" href="/">
            &larr; All questions
          </a>
          {Card.definition.render({
            children:
              '<h1>Question not found</h1><p>This question does not exist (it may have been a demo that reset).</p>',
          })}
        </div>
      );
    }

    const postButton = Button.definition.render({
      children: 'Post your answer',
      type: 'submit',
      variant: 'primary',
    });
    return (
      <div class="kv-so-question-detail-d-1hxerb kv-so-question-detail-gap-16fadp" data-style-src="examples/stackoverflow/src/components/question-detail.tsx#stack" kovo-c="question-detail-region" kovo-deps="answers question" kovo-fragment-target="question-detail-region" kovo-live-component="components/question-detail/question-detail-region" kovo-props={JSON.stringify({ questionId })}>
        <a class="kv-so-question-detail-align-14xhag kv-so-question-detail-fg-kzm69h kv-so-question-detail-d-hvcnob kv-so-question-detail-font-1tji11 kv-so-question-detail-gap-wnp2vs kv-so-question-detail-text-17zbfj kv-so-question-detail-w-17nh4y kv-so-question-detail-fg-1rg07n" data-style-src="examples/stackoverflow/src/components/question-detail.tsx#back" href="/">
          &larr; All questions
        </a>

        {renderQuestionCard(question, slots.request)}

        <section class="kv-so-question-detail-d-1hxerb kv-so-question-detail-gap-16fadp" data-style-src="examples/stackoverflow/src/components/question-detail.tsx#stack">
          <h2 class="kv-so-question-detail-fg-kzm69h kv-so-question-detail-font-52u89o kv-so-question-detail-font-9md27q kv-so-question-detail-m-c8wetf" data-style-src="examples/stackoverflow/src/components/question-detail.tsx#head">
            <span data-bind="question.answerCount">{question.answerCount}</span> {question.answerCount === 1 ? 'Answer' : 'Answers'}
          </h2>
          <ul class="kv-so-question-detail-d-1hxerb kv-so-question-detail-gap-1yj1y9 kv-so-question-detail-list-j3t69x kv-so-question-detail-m-c8wetf kv-so-question-detail-pad-1ofj5a" data-style-src="examples/stackoverflow/src/components/question-detail.tsx#answerList">{answers.map(renderAnswerCard)}</ul>

          {/* Native form; enhanced submissions refresh this whole region. */}
          <form enhance method="post" action="/_m/postAnswer" data-mutation="postAnswer" kovo-fragment-target="post-answer-mutation" class="kv-so-question-detail-d-1hxerb kv-so-question-detail-gap-vg2uwn" data-style-src="examples/stackoverflow/src/components/question-detail.tsx#composer">
            {slots.request ? csrfField(slots.request, soCsrf) : ''}
            <input type="hidden" name="id" value={freshId('a')} />
            <input type="hidden" name="questionId" value={questionId} />
            <input type="hidden" name="authorId" value="demo-viewer" />
            <label class="kv-so-question-detail-fg-g38551 kv-so-question-detail-font-52u89o kv-so-question-detail-font-1chcq6 kv-so-question-detail-m-c8wetf" data-style-src="examples/stackoverflow/src/components/question-detail.tsx#composerTitle" for="answer-body">
              Your answer
            </label>
            <textarea
              id="answer-body"
              name="body"
              required
              rows="3"
              placeholder="Share what you know — code and reasoning welcome…"
              class="kv-so-question-detail-bg-1n4aku kv-so-question-detail-bd-1u2qp7 kv-so-question-detail-bd-1oyuq7 kv-so-question-detail-bd-1qf6xu kv-so-question-detail-bd-1wna9r kv-so-question-detail-box-1gvzd3 kv-so-question-detail-fg-g38551 kv-so-question-detail-font-1tji11 kv-so-question-detail-pad-exa2mv kv-so-question-detail-pad-164yh0 kv-so-question-detail-w-lhhf6b kv-so-question-detail-bd-53k52n kv-so-question-detail-outline-405iyf kv-so-question-detail-line-1fg3ha kv-so-question-detail-resize-bvf20l" data-style-src="examples/stackoverflow/src/components/question-detail.tsx#input; examples/stackoverflow/src/components/question-detail.tsx#textarea"
            />
            <div class="kv-so-question-detail-d-1chols kv-so-question-detail-justify-m67bk5" data-style-src="examples/stackoverflow/src/components/question-detail.tsx#composerActions">{postButton}</div>
          </form>
        </section>
      </div>
    );
  },
});
QuestionDetailRegion.name = "components/question-detail/question-detail-region";

export const QuestionDetailRegion$liveTargetRenderer = registerGeneratedLiveTargetRenderer(componentLiveTargetRenderer({
  component: QuestionDetailRegion,
  componentId: "components/question-detail/question-detail-region",
}));
