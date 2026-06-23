/** @jsxImportSource @kovojs/server */
import { trustedHtml } from '@kovojs/browser';
import { component, FormError, type ComponentRenderSlots } from '@kovojs/core';
import * as style from '@kovojs/style';

import { postQuestionMutation } from '../mutations.js';
import { questionList, questionScore } from '../queries.js';
import { postQuestionForm, type QuestionListItem, type SoRequest } from '../model.js';
import { freshId } from '../components/chrome.js';
import { newestFirst, renderQuestionRow } from '../components/question-card.js';

// Palette inlined as a same-file literal (StyleX-style extraction resolves only
// same-file literals; SPEC §13.1). Mirrors the `so` palette in chrome.tsx.
const so = {
  bodyBg: '#f1f2f3',
  white: '#ffffff',
  border: '#e3e6e8',
  borderMed: '#d6d9dc',
  text: '#0c0d0e',
  textSecondary: '#232629',
  textMuted: '#525960',
  blue: '#0a95ff',
  blueHover: '#0074cc',
  blueText: '#ffffff',
} as const;

// Question list for `/`. It reads the question rowset and total vote score, then
// renders the KovOverflow "All Questions" header, the filter tabs, the question
// rows (stat rail + title + excerpt + tags + user card), and the ask composer.

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
    pageHead: {
      alignItems: 'center',
      display: 'flex',
      gap: 16,
      justifyContent: 'space-between',
      marginBlockEnd: 14,
    },
    pageTitle: { color: so.text, fontSize: 27, fontWeight: 400, margin: 0 },
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
    subHead: {
      alignItems: 'center',
      display: 'flex',
      flexWrap: 'wrap',
      gap: 12,
      justifyContent: 'space-between',
      marginBlockEnd: 14,
    },
    count: { color: so.textSecondary, fontSize: 17 },
    tabs: {
      borderColor: so.borderMed,
      borderRadius: 6,
      borderStyle: 'solid',
      borderWidth: 1,
      display: 'inline-flex',
      overflow: 'hidden',
    },
    tab: {
      borderInlineStartColor: so.borderMed,
      borderInlineStartStyle: 'solid',
      borderInlineStartWidth: 1,
      color: so.textMuted,
      fontSize: 13,
      paddingBlock: 8,
      paddingInline: 11,
      textDecoration: 'none',
      ':hover': { backgroundColor: '#f8f9f9', color: so.textSecondary },
    },
    tabFirst: { borderInlineStartWidth: 0 },
    tabActive: { backgroundColor: so.bodyBg, color: so.textSecondary },
    composer: {
      backgroundColor: so.white,
      borderColor: so.borderMed,
      borderRadius: 7,
      borderStyle: 'solid',
      borderWidth: 1,
      boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
      display: 'grid',
      gap: 10,
      marginBlockStart: 28,
      padding: 18,
    },
    composerTitle: { color: so.text, fontSize: 18, fontWeight: 600, margin: 0 },
    composerHint: { color: so.textMuted, fontSize: 13, marginBlock: 0 },
    label: { color: so.text, fontSize: 14, fontWeight: 600 },
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
    error: { color: '#c22e32', fontSize: 13 },
  },
  { namespace: 'list', source: 'components/question-list.tsx' },
);

const FILTER_TABS = ['Newest', 'Active', 'Bountied', 'Unanswered'] as const;

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
    const questions = newestFirst(questionList.items as QuestionListItem[]);
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
            {FILTER_TABS.map((tab) => (
              <a href="/" style={listStyles.tab}>
                {tab}
              </a>
            ))}
          </div>
        </div>

        <ul>
          {questions.map((question) =>
            trustedHtml(renderQuestionRow(question, { interactive: true })),
          )}
        </ul>

        {/* Native form; enhanced submissions refresh this whole region. */}
        <form enhance mutation={postQuestionMutation} id="ask-question" style={listStyles.composer}>
          <input type="hidden" name="id" value={freshId('q')} />
          <p style={listStyles.composerTitle}>Ask a public question</p>
          <p style={listStyles.composerHint}>
            {totalVotes.toLocaleString('en-US')} votes cast across the community — be specific and
            imagine you&rsquo;re asking another person.
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
            style={listStyles.input}
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
