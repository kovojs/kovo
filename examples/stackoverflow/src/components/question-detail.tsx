/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import * as style from '@kovojs/style';

import { postAnswerMutation } from '../mutations.js';
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

// Palette inlined as a same-file literal (StyleX-style extraction resolves only
// same-file literals; SPEC §13.1). Mirrors the `so` palette in chrome.tsx.
const so = {
  white: '#ffffff',
  border: '#e3e6e8',
  borderMed: '#d6d9dc',
  text: '#0c0d0e',
  textSecondary: '#232629',
  textMuted: '#525960',
  textLight: '#6a737c',
  link: '#0074cc',
  linkHover: '#0a95ff',
  blue: '#0a95ff',
  blueHover: '#0074cc',
  blueText: '#ffffff',
  acceptedText: '#3d8b5f',
} as const;

// Question detail for `/questions/:id`: the question post, its answers, and the
// answer composer — laid out like a Stack Overflow question page (vote gutter,
// post body, tags, user card, then the answer list and "Your Answer" form).

const detailStyles = style.create(
  {
    header: {
      borderBottomColor: so.border,
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
      color: so.text,
      fontSize: 26,
      fontWeight: 400,
      lineHeight: 1.3,
      margin: 0,
    },
    askButton: {
      backgroundColor: so.blue,
      borderColor: so.blue,
      borderRadius: 4,
      borderStyle: 'solid',
      borderWidth: 1,
      color: so.blueText,
      flexShrink: 0,
      fontSize: 13,
      paddingBlock: 10,
      paddingInline: 11,
      textDecoration: 'none',
      ':hover': { backgroundColor: so.blueHover },
    },
    metaRow: {
      color: so.textMuted,
      display: 'flex',
      flexWrap: 'wrap',
      fontSize: 13,
      gap: 16,
      marginBlockStart: 8,
    },
    metaLabel: { color: so.textLight },
    metaValue: { color: so.textSecondary },
    post: {
      borderBottomColor: so.border,
      borderBottomStyle: 'solid',
      borderBottomWidth: 1,
      display: 'flex',
      gap: 16,
      paddingBlock: 16,
      '@media (max-width: 600px)': { gap: 10 },
    },
    postAccepted: { backgroundColor: '#fbfdfb' },
    gutter: {
      alignItems: 'center',
      color: so.textLight,
      display: 'flex',
      flexDirection: 'column',
      flexShrink: 0,
      gap: 4,
      width: 42,
    },
    voteArrow: {
      alignItems: 'center',
      borderColor: so.borderMed,
      borderRadius: 1000,
      borderStyle: 'solid',
      borderWidth: 1,
      color: so.textLight,
      display: 'grid',
      fontSize: 11,
      height: 26,
      lineHeight: 1,
      placeItems: 'center',
      width: 26,
    },
    voteNum: {
      color: so.textSecondary,
      fontSize: 19,
      fontVariantNumeric: 'tabular-nums',
      fontWeight: 500,
      lineHeight: 1,
    },
    acceptCheck: {
      color: so.acceptedText,
      fontSize: 26,
      lineHeight: 1,
      marginBlockStart: 2,
    },
    postMain: { display: 'grid', flex: '1 1 0%', gap: 14, minWidth: 0 },
    body: {
      color: so.text,
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
    answersHead: {
      alignItems: 'center',
      display: 'flex',
      gap: 12,
      justifyContent: 'space-between',
      marginBlockStart: 24,
      marginBlockEnd: 4,
    },
    answersTitle: { color: so.text, fontSize: 19, fontWeight: 400, margin: 0 },
    sortControl: {
      borderColor: so.borderMed,
      borderRadius: 4,
      borderStyle: 'solid',
      borderWidth: 1,
      color: so.textMuted,
      fontSize: 12,
      paddingBlock: 5,
      paddingInline: 8,
    },
    answerList: { listStyle: 'none', margin: 0, padding: 0 },
    acceptedBadge: {
      alignItems: 'center',
      color: so.acceptedText,
      display: 'inline-flex',
      fontSize: 13,
      fontWeight: 600,
      gap: 5,
    },
    acceptedCheckSm: { fontSize: 15, lineHeight: 1 },
    composer: { display: 'grid', gap: 12, marginBlockStart: 28 },
    composerTitle: { color: so.text, fontSize: 19, fontWeight: 400, margin: 0 },
    input: {
      backgroundColor: so.white,
      borderColor: so.borderMed,
      borderRadius: 4,
      borderStyle: 'solid',
      borderWidth: 1,
      boxSizing: 'border-box',
      color: so.text,
      fontSize: 13,
      paddingBlock: 9,
      paddingInline: 11,
      width: '100%',
      ':focus': {
        borderColor: so.blue,
        boxShadow: '0 0 0 4px rgba(10,149,255,0.15)',
        outline: 'none',
      },
    },
    textarea: { lineHeight: 1.5, resize: 'vertical' },
    composerActions: { display: 'flex', justifyContent: 'flex-start' },
    submitButton: {
      backgroundColor: so.blue,
      borderColor: so.blue,
      borderRadius: 4,
      borderStyle: 'solid',
      borderWidth: 1,
      color: so.blueText,
      fontSize: 13,
      paddingBlock: 10,
      paddingInline: 11,
      ':hover': { backgroundColor: so.blueHover },
    },
    notFound: { color: so.textMuted, fontSize: 15, paddingBlock: 24 },
    back: {
      alignItems: 'center',
      color: so.link,
      display: 'inline-flex',
      fontSize: 13,
      gap: 6,
      marginBlockEnd: 12,
      textDecoration: 'none',
      ':hover': { color: so.linkHover },
    },
  },
  { namespace: 'detail', source: 'components/question-detail.tsx' },
);

function renderQuestionPost(question: QuestionDetailResult): string {
  const tags = parseTags(question.tags);
  return (
    <div style={detailStyles.post}>
      <div style={detailStyles.gutter}>{voteButton(question.id, question.score)}</div>
      <div style={detailStyles.postMain}>
        <p style={detailStyles.body}>{question.body}</p>
        <div style={detailStyles.postFooter}>
          {renderTags(tags)}
          {renderUserCard(question.authorId, question.authorName, question.createdAt, 'asked')}
        </div>
      </div>
    </div>
  );
}

function renderAnswerPost(answer: QuestionAnswersResult[number]): string {
  return (
    <li
      kovo-key={answer.id}
      style={answer.accepted ? [detailStyles.post, detailStyles.postAccepted] : detailStyles.post}
    >
      <div style={detailStyles.gutter}>
        <span style={detailStyles.voteArrow} aria-hidden="true">
          &#9650;
        </span>
        <span style={detailStyles.voteNum}>{answer.score}</span>
        <span style={detailStyles.voteArrow} aria-hidden="true">
          &#9660;
        </span>
        {answer.accepted ? (
          <span style={detailStyles.acceptCheck} aria-label="Accepted">
            &#10003;
          </span>
        ) : (
          ''
        )}
      </div>
      <div style={detailStyles.postMain}>
        {answer.accepted ? (
          <span style={detailStyles.acceptedBadge}>
            <span style={detailStyles.acceptedCheckSm}>&#10003;</span> Accepted answer
          </span>
        ) : (
          ''
        )}
        <p style={detailStyles.body}>{answer.body}</p>
        <div style={detailStyles.postFooter}>
          <span />
          {renderUserCard(answer.authorId, answer.authorName, answer.createdAt, 'answered')}
        </div>
      </div>
    </li>
  );
}

// Accepted answer first, then by score (desc) — Stack Overflow's default order.
function sortedAnswers(answers: QuestionAnswersResult): QuestionAnswersResult {
  return [...answers].sort((left, right) => {
    if (left.accepted !== right.accepted) return left.accepted ? -1 : 1;
    return right.score - left.score;
  });
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
    _slots: { request?: SoRequest | undefined } = {},
  ) => {
    if (!question) {
      return (
        <div>
          <a style={detailStyles.back} href="/">
            &larr; All questions
          </a>
          <h1 style={detailStyles.detailTitle}>Question not found</h1>
          <p style={detailStyles.notFound}>
            This question does not exist (it may have been a demo that reset).
          </p>
        </div>
      );
    }

    const views = viewsFor(question.id, question.score);
    const asked = relativeTime(question.createdAt);
    const ordered = sortedAnswers(answers);
    return (
      <div>
        <div style={detailStyles.header}>
          <div style={detailStyles.titleRow}>
            <h1 style={detailStyles.detailTitle}>{question.title}</h1>
            <a href="#your-answer" style={detailStyles.askButton}>
              Ask Question
            </a>
          </div>
          <div style={detailStyles.metaRow}>
            <span>
              <span style={detailStyles.metaLabel}>Asked</span>{' '}
              <span style={detailStyles.metaValue}>{asked}</span>
            </span>
            <span>
              <span style={detailStyles.metaLabel}>Viewed</span>{' '}
              <span style={detailStyles.metaValue}>{`${compactCount(views)} times`}</span>
            </span>
          </div>
        </div>

        {renderQuestionPost(question)}

        <div style={detailStyles.answersHead}>
          <h2 style={detailStyles.answersTitle}>
            {question.answerCount} {question.answerCount === 1 ? 'Answer' : 'Answers'}
          </h2>
          <span style={detailStyles.sortControl}>Sorted by: Highest score</span>
        </div>
        <ul style={detailStyles.answerList}>{ordered.map(renderAnswerPost)}</ul>

        {/* Native form; enhanced submissions refresh this whole region. */}
        <form enhance mutation={postAnswerMutation} id="your-answer" style={detailStyles.composer}>
          <input type="hidden" name="id" value={freshId('a')} />
          <input type="hidden" name="questionId" value={questionId} />
          <input type="hidden" name="authorId" value="demo-viewer" />
          <h2 style={detailStyles.composerTitle}>Your Answer</h2>
          <textarea
            id="answer-body"
            name="body"
            required
            rows="6"
            placeholder="Share what you know — code and reasoning welcome…"
            style={[detailStyles.input, detailStyles.textarea]}
          />
          <div style={detailStyles.composerActions}>
            <button type="submit" style={detailStyles.submitButton}>
              Post Your Answer
            </button>
          </div>
        </form>
      </div>
    );
  },
});
