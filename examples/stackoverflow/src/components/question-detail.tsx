/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import { csrfField } from '@kovojs/server';
import * as style from '@kovojs/style';

import { postAnswerMutation, soCsrf } from '../mutations.js';
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
    <div style={detailStyles.post}>
      <div style={detailStyles.gutter}>{voteButton(question.id, question.score)}</div>
      <div style={detailStyles.postMain}>
        <p style={detailStyles.body}>{question.body}</p>
        <div style={detailStyles.postFooter}>
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
    <li kovo-key={answer.id} style={detailStyles.post}>
      <div style={detailStyles.gutter}>
        <span style={detailStyles.body} />
        {/* Answer scores are static in the demo (only questions are votable). */}
        {answer.accepted ? <span style={detailStyles.acceptMark}>&#10003;</span> : ''}
      </div>
      <div style={detailStyles.postMain}>
        {answer.accepted ? (
          <span style={detailStyles.acceptedNote}>
            <span>&#10003;</span> Accepted answer
          </span>
        ) : (
          ''
        )}
        <p style={detailStyles.body}>{answer.body}</p>
        <div style={detailStyles.postFooter}>
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
    const asked = question.createdAt ? relativeTime(question.createdAt) : 'recently';
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
        </div>
        <ul style={detailStyles.answerList}>{answers.map(renderAnswerPost)}</ul>

        {/* Native form; enhanced submissions refresh this whole region. */}
        <form
          enhance
          mutation={postAnswerMutation}
          id="your-answer"
          style={detailStyles.composer}
        >
          {/* Compiler-lowered form: add the CSRF field explicitly (see the note on
              the question-list composer). */}
          {slots.request ? csrfField(slots.request, soCsrf) : ''}
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
