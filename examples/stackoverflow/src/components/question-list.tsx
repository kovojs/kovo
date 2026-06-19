/** @jsxImportSource @kovojs/server */
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
  {
    namespace: 'so-question-list',
    source: 'examples/stackoverflow/src/components/question-list.tsx',
  },
);

export const questionListStyleCss = style.emitAtomicCss(
  Object.values(listStyles).flatMap((entry) => entry.__rules ?? []),
);

function renderAnswerStat(answerCount: number): string {
  if (answerCount > 0) {
    return (
      <div style={listStyles.statBox}>
        <span style={listStyles.statBoxNum}>{answerCount}</span>
        <span style={listStyles.statBoxLabel}>{answerCount === 1 ? 'answer' : 'answers'}</span>
      </div>
    );
  }
  return (
    <div style={listStyles.statPlain}>
      <span style={listStyles.statBoxNum}>0</span>
      <span style={listStyles.statBoxLabel}>answers</span>
    </div>
  );
}

function renderQuestionRow(question: QuestionListItem): string {
  const tags = parseTags(question.tags);
  const views = viewsFor(question.id, question.score);
  return (
    <li kovo-key={question.id} style={listStyles.row}>
      <div style={listStyles.stats}>
        <div style={listStyles.statVotes}>
          {voteButton(question.id, question.score)}
          <span style={listStyles.statVotesLabel}>votes</span>
        </div>
        {renderAnswerStat(question.answerCount)}
        <span style={listStyles.statViews}>{`${compactCount(views)} views`}</span>
      </div>
      <div style={listStyles.rowMain}>
        <a style={listStyles.rowTitle} href={`/questions/${question.id}`}>
          {question.title}
        </a>
        {question.body ? <p style={listStyles.rowExcerpt}>{question.body}</p> : ''}
        <div style={listStyles.rowMeta}>
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
      <div>
        <div style={listStyles.pageHead}>
          <h1 style={listStyles.pageTitle}>All Questions</h1>
          <a href="#ask-question" style={listStyles.askButton}>
            Ask Question
          </a>
        </div>
        <div style={listStyles.subHead}>
          <span style={listStyles.count}>{questions.length.toLocaleString('en-US')} questions</span>
          <div style={listStyles.tabs}>
            <a href="/" style={[listStyles.tab, listStyles.tabFirst, listStyles.tabActive]}>
              Newest
            </a>
            <a href="/" style={listStyles.tab}>
              Active
            </a>
            <a href="/" style={listStyles.tab}>
              Bountied
            </a>
            <a href="/" style={listStyles.tab}>
              Unanswered
            </a>
          </div>
        </div>

        <ul style={listStyles.list}>{questions.map((question) => renderQuestionRow(question))}</ul>

        {/* Native form; enhanced submissions refresh this whole region. */}
        <form enhance mutation={postQuestionMutation} id="ask-question" style={listStyles.composer}>
          <input type="hidden" name="id" value={freshId('q')} />
          <input type="hidden" name="authorId" value="demo-viewer" />
          <p style={listStyles.composerTitle}>Ask a public question</p>
          <p style={listStyles.composerHint}>
            {totalVotes} votes cast across the community — be specific and imagine you're asking
            another person.
          </p>
          <label style={listStyles.label} for="ask-title">
            Title
          </label>
          <input
            id="ask-title"
            name="title"
            required
            placeholder="e.g. How do I center a div with flexbox?"
            style={listStyles.input}
          />
          <label style={listStyles.label} for="ask-body">
            Body
          </label>
          <textarea
            id="ask-body"
            name="body"
            required
            rows="3"
            placeholder="Include all the information someone would need to answer your question…"
            style={[listStyles.input, listStyles.textarea]}
          />
          <FormError
            code="DUPLICATE_TITLE"
            style={listStyles.error}
            message={(failure: DuplicateTitleFailure) =>
              `A question titled "${failure.payload.title}" already exists.`
            }
          />
          <div style={listStyles.composerActions}>
            <button type="submit" style={listStyles.submitButton}>
              Post your question
            </button>
          </div>
        </form>
      </div>
    );
  },
});
