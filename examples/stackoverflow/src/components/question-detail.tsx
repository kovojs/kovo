/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import { csrfField } from '@kovojs/server';
import { Badge } from '@kovojs/ui/badge';
import { Button } from '@kovojs/ui/button';
import { Card } from '@kovojs/ui/card';
import { tokens } from '@kovojs/style';
import * as style from '@kovojs/style';

import { postAnswerMutation, soCsrf } from '../mutations.js';
import { questionAnswers, questionDetail } from '../queries.js';
import type { QuestionAnswersResult, QuestionDetailResult, SoRequest } from '../model.js';
import { freshId, parseTags, renderAuthor, renderTags, voteButton } from '../components/chrome.js';

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
    <div style={detailStyles.row}>
      {voteButton(question.id, question.score, request)}
      <div style={detailStyles.rowMain}>
        <h1 style={detailStyles.detailTitle}>{question.title}</h1>
        <p style={detailStyles.detailBody}>{question.body}</p>
        <div style={detailStyles.rowMeta}>
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
    <div style={detailStyles.row}>
      <div style={detailStyles.answerVote}>
        <span style={detailStyles.voteCaret}>&#9650;</span>
        <span style={detailStyles.voteScore}>{answer.score}</span>
        <span style={detailStyles.voteLabel}>votes</span>
      </div>
      <div style={detailStyles.rowMain}>
        {acceptedBadge ? <div style={detailStyles.badgeWrap}>{acceptedBadge}</div> : ''}
        <p style={detailStyles.answerBody}>{answer.body}</p>
        {answer.authorName ? (
          <div style={detailStyles.rowMeta}>
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
        <div style={detailStyles.stack}>
          <a style={detailStyles.back} href="/">
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
      <div style={detailStyles.stack}>
        <a style={detailStyles.back} href="/">
          &larr; All questions
        </a>

        {renderQuestionCard(question, slots.request)}

        <section style={detailStyles.stack}>
          <h2 style={detailStyles.head}>
            <span>{question.answerCount}</span> {question.answerCount === 1 ? 'Answer' : 'Answers'}
          </h2>
          <ul style={detailStyles.answerList}>{answers.map(renderAnswerCard)}</ul>

          {/* Native form; enhanced submissions refresh this whole region. */}
          <form enhance mutation={postAnswerMutation} style={detailStyles.composer}>
            {slots.request ? csrfField(slots.request, soCsrf) : ''}
            <input type="hidden" name="id" value={freshId('a')} />
            <input type="hidden" name="questionId" value={questionId} />
            <input type="hidden" name="authorId" value="demo-viewer" />
            <label style={detailStyles.composerTitle} for="answer-body">
              Your answer
            </label>
            <textarea
              id="answer-body"
              name="body"
              required
              rows="3"
              placeholder="Share what you know — code and reasoning welcome…"
              style={[detailStyles.input, detailStyles.textarea]}
            />
            <div style={detailStyles.composerActions}>{postButton}</div>
          </form>
        </section>
      </div>
    );
  },
});
